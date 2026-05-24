#!/usr/bin/env node
import { Command } from 'commander';
import { createInterface } from 'readline';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { loadConfig, saveConfig, getClient, readMarker, writeMarker, requireSlug } from './lib/config.js';
import * as api from './lib/api.js';
import { detect } from './lib/detect.js';
import { startWatch } from './lib/watch.js';
import { generateBash, generateZsh, generateFish, detectShell, installCompletions } from './lib/completions.js';

// ── ANSI colors ──────────────────────────────────────────────────────────────
const c = {
  green:  s => `\x1b[32m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  gray:   s => `\x1b[90m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
};

function ok(msg)   { console.log(c.green('✓') + ' ' + msg); }
function err(msg)  { console.error(c.red('✗') + ' ' + msg); }
function info(msg) { console.log(c.cyan('·') + ' ' + msg); }
function warn(msg) { console.log(c.yellow('!') + ' ' + msg); }
function added(msg){ console.log(c.green('  +') + ' ' + msg); }
function skip(msg) { console.log(c.gray('  ~') + ' ' + msg); }

// ── Prompts ──────────────────────────────────────────────────────────────────
function ask(question) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
  });
}

function askSecret(question) {
  return new Promise(resolve => {
    // Write question to stderr so it appears even when stdout is piped
    process.stderr.write(question);
    const rl = createInterface({ input: process.stdin, output: null, terminal: false });
    rl.once('line', line => { rl.close(); process.stderr.write('\n'); resolve(line.trim()); });
  });
}

async function confirm(question) {
  const answer = await ask(c.yellow('? ') + question + ' (y/N) ');
  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}

// ── Print helpers ─────────────────────────────────────────────────────────────
function printDetected(d) {
  const p = d.project;
  console.log('');
  console.log(c.bold('  Detected project info:'));
  console.log(c.gray('  ─────────────────────────────────────'));
  if (p.name)             console.log(`  name:            ${p.name}`);
  if (p.slug)             console.log(`  slug:            ${p.slug}`);
  if (p.repo_url)         console.log(`  repo_url:        ${p.repo_url}`);
  if (p.repo_path)        console.log(`  repo_path:       ${p.repo_path}`);
  if (p.package_manager)  console.log(`  package_manager: ${p.package_manager}`);
  if (p.default_branch)   console.log(`  default_branch:  ${p.default_branch}`);
  if (p.hosting_platform) console.log(`  hosting_platform:${p.hosting_platform}`);

  if (d.commands.length)  {
    console.log(c.gray('\n  Commands:'));
    d.commands.forEach(cmd => console.log(`    ${c.green(cmd.kind.padEnd(10))} ${cmd.name}  →  ${c.dim(cmd.command)}`));
  }
  if (d.ports.length) {
    console.log(c.gray('\n  Ports:'));
    d.ports.forEach(pt => console.log(`    :${String(pt.port).padEnd(8)} ${pt.label}  (${pt.local_url})`));
  }
  if (d.env_keys.length) {
    console.log(c.gray('\n  Env keys:'));
    d.env_keys.slice(0, 10).forEach(k => console.log(`    ${k.key_name}`));
    if (d.env_keys.length > 10) console.log(c.gray(`    … and ${d.env_keys.length - 10} more`));
  }
  if (d.docker.length) {
    console.log(c.gray('\n  Docker Compose:'));
    d.docker.forEach(dc => console.log(`    ${dc.compose_file_path}  services: ${dc.services || 'none detected'}`));
  }
  if (d.deployments.length) {
    console.log(c.gray('\n  Deployments:'));
    d.deployments.forEach(dep => console.log(`    ${dep.platform} / ${dep.environment}`));
  }
  console.log('');
}

// ── Push detected records into DB (additive) ──────────────────────────────────
async function pushDetected(sb, projectId, detected, existing = {}) {
  const existingCmds    = existing.commands    || [];
  const existingPorts   = existing.ports       || [];
  const existingEnvKeys = existing.env_keys    || [];
  const existingDocker  = existing.docker      || [];
  const existingDeploys = existing.deployments || [];

  for (const cmd of detected.commands) {
    if (existingCmds.find(c => c.kind === cmd.kind && c.name === cmd.name)) {
      skip(`command already exists: ${cmd.name}`); continue;
    }
    await api.insertRow(sb, 'command_profiles', { ...cmd, project_id: projectId });
    added(`command: ${cmd.name} (${cmd.kind})`);
  }
  for (const pt of detected.ports) {
    if (existingPorts.find(p => p.port === pt.port)) {
      skip(`port already exists: ${pt.port}`); continue;
    }
    await api.insertRow(sb, 'project_ports', { ...pt, project_id: projectId });
    added(`port: ${pt.port} — ${pt.label}`);
  }
  for (const k of detected.env_keys) {
    if (existingEnvKeys.find(e => e.key_name === k.key_name)) {
      skip(`env key already exists: ${k.key_name}`); continue;
    }
    await api.insertRow(sb, 'env_keys', { ...k, project_id: projectId });
    added(`env key: ${k.key_name}`);
  }
  for (const dc of detected.docker) {
    if (existingDocker.find(d => d.compose_file_path === dc.compose_file_path)) {
      skip(`docker config already exists: ${dc.compose_file_path}`); continue;
    }
    await api.insertRow(sb, 'docker_compose_configs', { ...dc, project_id: projectId });
    added(`docker: ${dc.compose_file_path}`);
  }
  for (const dep of detected.deployments) {
    if (existingDeploys.find(d => d.platform === dep.platform && d.environment === dep.environment)) {
      skip(`deployment already exists: ${dep.platform}/${dep.environment}`); continue;
    }
    await api.insertRow(sb, 'deployment_targets', { ...dep, project_id: projectId });
    added(`deployment: ${dep.platform} / ${dep.environment}`);
  }
}

// ── Program ──────────────────────────────────────────────────────────────────
const program = new Command();
program
  .name('ldc')
  .description('Local Dev Cockpit CLI — manage project metadata from your terminal')
  .version('0.1.0');

// ── ldc login ─────────────────────────────────────────────────────────────────
program
  .command('login')
  .description('Authenticate with your Supabase project and save credentials')
  .action(async () => {
    console.log(c.bold('\nLocal Dev Cockpit — login\n'));
    const url      = await ask('Supabase URL:      ');
    const anonKey  = await askSecret('Supabase anon key: ');
    const email    = await ask('Email:             ');
    const password = await askSecret('Password:          ');

    const sb = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { err(error.message); process.exit(1); }

    saveConfig({
      url,
      anonKey,
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      userId: data.user.id,
      email: data.user.email,
    });
    ok(`Logged in as ${data.user.email}`);
    console.log(c.gray('  Credentials saved to ~/.ldc/config.json\n'));
  });

// ── ldc whoami ────────────────────────────────────────────────────────────────
program
  .command('whoami')
  .description('Show current login info')
  .action(() => {
    const cfg = loadConfig();
    if (!cfg) { err('Not logged in. Run: ldc login'); process.exit(1); }
    ok(`Logged in as ${cfg.email}`);
    console.log(c.gray(`  Supabase URL: ${cfg.url}`));
  });

// ── ldc init ──────────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Create a new project in Cockpit from the current directory')
  .option('--slug <slug>', 'Override the auto-detected project slug')
  .option('--dry-run', 'Show what would be created without writing anything')
  .action(async (opts) => {
    const sb = getClient();
    const cwd = process.cwd();

    info('Scanning current directory…');
    const detected = await detect(cwd);
    if (opts.slug) detected.project.slug = opts.slug;

    printDetected(detected);

    if (opts.dryRun) {
      warn('Dry run — nothing was written.');
      return;
    }

    const go = await confirm('Create this project in Cockpit?');
    if (!go) { warn('Aborted.'); return; }

    // Check for duplicate slug
    const existing = await api.getProjectBySlug(sb, detected.project.slug);
    if (existing) {
      err(`Project with slug "${detected.project.slug}" already exists.`);
      const override = await confirm('Update the existing project instead?');
      if (!override) { warn('Aborted.'); return; }
      await api.updateProject(sb, existing.id, { ...existing, ...detected.project });
      ok(`Updated project: ${existing.slug}`);
      await pushDetected(sb, existing.id, detected, await api.getProjectScope(sb, existing.slug));
      writeMarker(cwd, existing.slug);
      ok(`Linked to .ldc — slug: ${existing.slug}`);
      return;
    }

    const project = await api.createProject(sb, detected.project);
    ok(`Created project: ${project.slug}`);

    await pushDetected(sb, project.id, detected);
    writeMarker(cwd, project.slug);
    ok(`Linked to .ldc — slug: ${project.slug}`);
    console.log(c.gray('\n  Run `ldc sync` any time to refresh from this directory.\n'));
  });

// ── Webhook emit helper ──────────────────────────────────────────────────────
async function emitSyncWebhook(slug, projectName) {
  try {
    await fetch('http://127.0.0.1:7891/webhooks/emit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'sync.completed',
        project: { slug, name: projectName || slug },
        data: { source: 'cli' },
      }),
      signal: AbortSignal.timeout(2000),
    });
  } catch { /* best effort — daemon may not be running */ }
}

// ── ldc sync ──────────────────────────────────────────────────────────────────
program
  .command('sync')
  .description('Re-scan the current directory and push new info to Cockpit (additive only)')
  .option('--slug <slug>', 'Override project slug (default: from .ldc file)')
  .action(async (opts) => {
    const sb = getClient();
    const slug = requireSlug(opts);
    const cwd = process.cwd();

    info(`Syncing project: ${slug}`);
    const scope = await api.getProjectScope(sb, slug);
    if (!scope) { err(`Project not found: ${slug}`); process.exit(1); }

    info('Scanning current directory…');
    const detected = await detect(cwd);

    // Update top-level project fields that are currently empty
    const updates = {};
    const fields = ['repo_url', 'repo_path', 'package_manager', 'default_branch', 'hosting_platform', 'name'];
    for (const f of fields) {
      if (detected.project[f] && !scope.project[f]) updates[f] = detected.project[f];
    }
    if (Object.keys(updates).length) {
      await api.updateProject(sb, scope.project.id, { ...scope.project, ...updates });
      for (const [k, v] of Object.entries(updates)) added(`project.${k} = ${v}`);
    } else {
      skip('project fields already populated');
    }

    await pushDetected(sb, scope.project.id, detected, scope);
    ok('Sync complete');
    emitSyncWebhook(slug, scope.project.name);
  });

// ── ldc watch ─────────────────────────────────────────────────────────────────
program
  .command('watch')
  .description('Watch for file changes and auto-sync to Cockpit (additive only)')
  .option('--slug <slug>', 'Project slug (default: from .ldc file)')
  .option('--debounce <ms>', 'Debounce interval in milliseconds', '1500')
  .action(async (opts) => {
    const sb = getClient();
    const slug = requireSlug(opts);
    const cwd = process.cwd();

    const scope = await api.getProjectScope(sb, slug);
    if (!scope) { err(`Project not found: ${slug}`); process.exit(1); }

    let syncCount = 0;

    const watcher = startWatch(cwd, async (filename) => {
      syncCount++;
      info(`change detected: ${c.bold(filename)} — running sync (#${syncCount})…`);

      try {
        const detected = await detect(cwd);
        const freshScope = await api.getProjectScope(sb, slug);

        // Update top-level project fields that are currently empty
        const updates = {};
        const fields = ['repo_url', 'repo_path', 'package_manager', 'default_branch', 'hosting_platform', 'name'];
        for (const f of fields) {
          if (detected.project[f] && !freshScope.project[f]) updates[f] = detected.project[f];
        }
        if (Object.keys(updates).length) {
          await api.updateProject(sb, freshScope.project.id, { ...freshScope.project, ...updates });
          for (const [k, v] of Object.entries(updates)) added(`project.${k} = ${v}`);
        }

        await pushDetected(sb, freshScope.project.id, detected, freshScope);
        ok(`sync #${syncCount} complete`);
        emitSyncWebhook(slug, freshScope.project.name);
      } catch (e) {
        err(`sync failed: ${e.message}`);
      }
    }, {
      debounceMs: parseInt(opts.debounce),
      log: (msg) => info(msg),
    });

    console.log('');
    console.log(c.bold(`  Watching project: ${slug}`));
    console.log(c.gray(`  Directory: ${cwd}`));
    console.log(c.gray(`  Tracking ${watcher.fileCount} file(s) for changes`));
    console.log(c.gray(`  Debounce: ${opts.debounce}ms`));
    console.log(c.dim('  Press Ctrl+C to stop\n'));

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('');
      watcher.close();
      ok(`Stopped watching. ${syncCount} sync(s) performed.`);
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      watcher.close();
      process.exit(0);
    });

    // Keep process alive
    setInterval(() => {}, 60_000);
  });

// ── ldc set ───────────────────────────────────────────────────────────────────
program
  .command('set <field> <value>')
  .description(`Set a single top-level project field

  Fields: name, slug, description, repo-path, repo-url, package-manager,
          default-branch, monorepo-paths, tags, status, notes,
          danger-notes, hosting-platform
  Example: ldc set repo-url https://github.com/org/repo`)
  .option('--slug <slug>', 'Project slug (default: from .ldc file)')
  .action(async (field, value, opts) => {
    const sb = getClient();
    const slug = requireSlug(opts);

    const dbField = field.replace(/-/g, '_');
    const allowed = ['name', 'slug', 'description', 'repo_path', 'repo_url', 'package_manager',
                     'default_branch', 'monorepo_paths', 'tags', 'status', 'notes',
                     'danger_notes', 'hosting_platform'];
    if (!allowed.includes(dbField)) {
      err(`Unknown field: ${field}`);
      console.log(c.gray(`  Allowed: ${allowed.join(', ')}`));
      process.exit(1);
    }

    const project = await api.getProjectBySlug(sb, slug);
    if (!project) { err(`Project not found: ${slug}`); process.exit(1); }

    await api.updateProject(sb, project.id, { ...project, [dbField]: value });
    ok(`${slug} → ${dbField} = ${value}`);
  });

// ── ldc add ───────────────────────────────────────────────────────────────────
const add = new Command('add').description('Add a resource to the project');

add
  .command('command <name> <kind> <cmd>')
  .description('Add a command profile')
  .option('--slug <slug>', 'Project slug (default: from .ldc file)')
  .option('--port <port>', 'Expected port number')
  .option('--dir <dir>', 'Working directory')
  .option('--health <url>', 'Health check URL')
  .option('--confirm', 'Require confirmation before running')
  .action(async (name, kind, cmd, opts) => {
    const sb = getClient();
    const slug = requireSlug(opts);
    const project = await api.getProjectBySlug(sb, slug);
    if (!project) { err(`Project not found: ${slug}`); process.exit(1); }

    await api.insertRow(sb, 'command_profiles', {
      project_id: project.id,
      name,
      kind,
      command: cmd,
      working_dir: opts.dir || '',
      expected_port: opts.port ? parseInt(opts.port) : null,
      health_url: opts.health || '',
      must_confirm: !!opts.confirm,
    });
    ok(`Added command: ${name} (${kind}) → ${cmd}`);
  });

add
  .command('port <port>')
  .description('Add a port')
  .option('--slug <slug>', 'Project slug (default: from .ldc file)')
  .option('--label <label>', 'Label for this port')
  .option('--protocol <protocol>', 'Protocol: http, https, tcp, ws', 'http')
  .option('--health <url>', 'Health check URL')
  .action(async (port, opts) => {
    const sb = getClient();
    const slug = requireSlug(opts);
    const project = await api.getProjectBySlug(sb, slug);
    if (!project) { err(`Project not found: ${slug}`); process.exit(1); }

    const portNum = parseInt(port);
    await api.insertRow(sb, 'project_ports', {
      project_id: project.id,
      port: portNum,
      label: opts.label || `Port ${portNum}`,
      protocol: opts.protocol,
      local_url: `http://127.0.0.1:${portNum}`,
      health_url: opts.health || '',
    });
    ok(`Added port: ${portNum}`);
  });

add
  .command('url <url>')
  .description('Add a URL')
  .option('--slug <slug>', 'Project slug (default: from .ldc file)')
  .option('--label <label>', 'Label')
  .option('--category <category>', 'Category', 'other')
  .option('--env <environment>', 'Environment', '')
  .action(async (url, opts) => {
    const sb = getClient();
    const slug = requireSlug(opts);
    const project = await api.getProjectBySlug(sb, slug);
    if (!project) { err(`Project not found: ${slug}`); process.exit(1); }

    await api.insertRow(sb, 'project_urls', {
      project_id: project.id,
      url,
      label: opts.label || url,
      category: opts.category,
      environment: opts.env,
    });
    ok(`Added URL: ${url}`);
  });

add
  .command('env-key <KEY_NAME>')
  .description('Add an expected env key (name only, no value)')
  .option('--slug <slug>', 'Project slug (default: from .ldc file)')
  .option('--classification <class>', 'Classification', 'server-runtime')
  .option('--source <source>', 'Source type', 'infisical')
  .option('--purpose <purpose>', 'What this key is for')
  .option('--scope <scope>', 'Env scope (dev, prod, etc.)')
  .option('--optional', 'Mark as optional (default: required)')
  .action(async (keyName, opts) => {
    const sb = getClient();
    const slug = requireSlug(opts);
    const project = await api.getProjectBySlug(sb, slug);
    if (!project) { err(`Project not found: ${slug}`); process.exit(1); }

    await api.insertRow(sb, 'env_keys', {
      project_id: project.id,
      key_name: keyName,
      classification: opts.classification,
      source_type: opts.source,
      purpose: opts.purpose || '',
      env_scope: opts.scope || '',
      required: !opts.optional,
    });
    ok(`Added env key: ${keyName}`);
  });

add
  .command('deployment <platform> <environment>')
  .description('Add a deployment target')
  .option('--slug <slug>', 'Project slug (default: from .ldc file)')
  .option('--url <url>', 'Production URL')
  .option('--branch <branch>', 'Git branch')
  .option('--region <region>', 'Region')
  .option('--project-id <id>', 'Platform project ID')
  .option('--project-name <name>', 'Platform project name')
  .action(async (platform, environment, opts) => {
    const sb = getClient();
    const slug = requireSlug(opts);
    const project = await api.getProjectBySlug(sb, slug);
    if (!project) { err(`Project not found: ${slug}`); process.exit(1); }

    await api.insertRow(sb, 'deployment_targets', {
      project_id: project.id,
      platform,
      environment,
      production_url: opts.url || '',
      branch: opts.branch || '',
      region: opts.region || '',
      platform_project_id: opts.projectId || '',
      platform_project_name: opts.projectName || '',
    });
    ok(`Added deployment: ${platform} / ${environment}`);
  });

program.addCommand(add);

// ── ldc list ──────────────────────────────────────────────────────────────────
program
  .command('list')
  .description('List all projects in Cockpit')
  .action(async () => {
    const sb = getClient();
    const projects = await api.listProjects(sb);
    if (!projects.length) { info('No projects yet. Run `ldc init` from a project directory.'); return; }
    console.log('');
    for (const p of projects) {
      const marker = readMarker()?.slug === p.slug ? c.green(' ← current') : '';
      console.log(`  ${c.bold(p.slug.padEnd(28))} ${c.gray(p.name)}${marker}`);
    }
    console.log('');
  });

// ── ldc status ────────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show summary of the current project')
  .option('--slug <slug>', 'Project slug (default: from .ldc file)')
  .action(async (opts) => {
    const sb = getClient();
    const slug = requireSlug(opts);
    const scope = await api.getProjectScope(sb, slug);
    if (!scope) { err(`Project not found: ${slug}`); process.exit(1); }
    const p = scope.project;
    console.log('');
    console.log(c.bold(`  ${p.name}`), c.gray(`(${p.slug})`));
    console.log(c.gray('  ─────────────────────────────────────'));
    if (p.repo_url)  console.log(`  repo:        ${p.repo_url}`);
    if (p.repo_path) console.log(`  path:        ${p.repo_path}`);
    console.log(`  pm:          ${p.package_manager}`);
    console.log(`  branch:      ${p.default_branch}`);
    console.log(`  status:      ${p.status}`);
    console.log('');
    console.log(`  ${c.cyan(String(scope.commands.length).padStart(3))} commands    ${c.cyan(String(scope.ports.length).padStart(3))} ports`);
    console.log(`  ${c.cyan(String(scope.env_keys.length).padStart(3))} env keys    ${c.cyan(String(scope.urls.length).padStart(3))} URLs`);
    console.log(`  ${c.cyan(String(scope.deployments.length).padStart(3))} deployments ${c.cyan(String(scope.docker.length).padStart(3))} docker configs`);
    console.log(`  ${c.cyan(String((scope.notes || []).length).padStart(3))} notes`);
    console.log('');
  });

// ── ldc export ────────────────────────────────────────────────────────────────
program
  .command('export')
  .description('Export project data to JSON (stdout or --file)')
  .option('--slug <slug>', 'Project slug (default: from .ldc file)')
  .option('--file <path>', 'Write to file instead of stdout')
  .action(async (opts) => {
    const sb = getClient();
    const slug = requireSlug(opts);
    const scope = await api.getProjectScope(sb, slug);
    if (!scope) { err(`Project not found: ${slug}`); process.exit(1); }

    const json = JSON.stringify(scope, null, 2);
    if (opts.file) {
      writeFileSync(opts.file, json);
      ok(`Exported to ${opts.file}`);
    } else {
      process.stdout.write(json + '\n');
    }
  });

// ── ldc import ────────────────────────────────────────────────────────────────
program
  .command('import <file>')
  .description('Import project data from a JSON file (from `ldc export`)')
  .option('--overwrite', 'Overwrite existing records with the same ID')
  .action(async (file, opts) => {
    const sb = getClient();
    if (!existsSync(file)) { err(`File not found: ${file}`); process.exit(1); }
    let scope;
    try { scope = JSON.parse(readFileSync(file, 'utf8')); } catch { err('Invalid JSON file'); process.exit(1); }

    const { project, commands = [], ports = [], urls = [], deployments = [],
            env_keys = [], infisical_refs = [], docker = [] } = scope;

    if (!project?.slug) { err('JSON missing project.slug'); process.exit(1); }

    // Upsert project (strip id so it becomes insert if not exists, or update by slug)
    const existing = await api.getProjectBySlug(sb, project.slug);
    let projectId;
    if (existing) {
      await api.updateProject(sb, existing.id, project);
      projectId = existing.id;
      ok(`Updated project: ${project.slug}`);
    } else {
      const { id, created_at, updated_at, owner_id, ...rest } = project;
      const created = await api.createProject(sb, rest);
      projectId = created.id;
      ok(`Created project: ${project.slug}`);
    }

    const tables = [
      ['command_profiles', commands],
      ['project_ports', ports],
      ['project_urls', urls],
      ['deployment_targets', deployments],
      ['env_keys', env_keys],
      ['infisical_refs', infisical_refs],
      ['docker_compose_configs', docker],
    ];
    for (const [table, rows] of tables) {
      for (const row of rows) {
        const { id, owner_id, created_at, ...rest } = row;
        try {
          await api.insertRow(sb, table, { ...rest, project_id: projectId });
        } catch (e) {
          warn(`${table}: ${e.message}`);
        }
      }
      if (rows.length) added(`${table}: ${rows.length} record(s)`);
    }
    ok('Import complete');
  });

// ── ldc link ──────────────────────────────────────────────────────────────────
program
  .command('link <slug>')
  .description('Link the current directory to an existing project by slug')
  .action(async (slug) => {
    const sb = getClient();
    const project = await api.getProjectBySlug(sb, slug);
    if (!project) { err(`Project not found: ${slug}`); process.exit(1); }
    writeMarker(process.cwd(), slug);
    ok(`Linked to project: ${slug}`);
  });

// ── ldc agent-context ────────────────────────────────────────────────────────
program
  .command('agent-context')
  .description('Output the agent context JSON for a project (saves a snapshot)')
  .option('--slug <slug>', 'Project slug (default: from .ldc file)')
  .option('--no-snapshot', 'Do not save a snapshot')
  .action(async (opts) => {
    const sb = getClient();
    const slug = requireSlug(opts);
    const scope = await api.getProjectScope(sb, slug);
    if (!scope) { err(`Project not found: ${slug}`); process.exit(1); }
    const ctx = api.buildAgentContext(scope);
    process.stdout.write(JSON.stringify(ctx, null, 2) + '\n');
    if (opts.snapshot !== false) {
      try {
        await api.saveSnapshot(sb, scope.project.id, ctx, 'cli');
      } catch { /* best-effort */ }
    }
  });

// ── ldc context-versions ─────────────────────────────────────────────────────
program
  .command('context-versions')
  .description('List agent context version history')
  .option('--slug <slug>', 'Project slug (default: from .ldc file)')
  .action(async (opts) => {
    const sb = getClient();
    const slug = requireSlug(opts);
    const project = await api.getProjectBySlug(sb, slug);
    if (!project) { err(`Project not found: ${slug}`); process.exit(1); }
    const snapshots = await api.listSnapshots(sb, project.id);
    if (!snapshots.length) { info('No context snapshots yet. Run `ldc agent-context` to create one.'); return; }
    console.log('');
    snapshots.forEach((snap, i) => {
      const ver = `v${snapshots.length - i}`;
      const date = new Date(snap.created_at).toLocaleString();
      const trigger = snap.trigger ? c.gray(`[${snap.trigger}]`) : '';
      const label = snap.label ? c.dim(` ${snap.label}`) : '';
      console.log(`  ${c.cyan(ver.padEnd(6))} ${date}  ${trigger}${label}  ${c.dim(snap.id.slice(0, 8))}`);
    });
    console.log('');
  });

// ── ldc context-diff ─────────────────────────────────────────────────────────
program
  .command('context-diff')
  .description('Diff two agent context versions (or a version vs. current)')
  .argument('[version1]', 'First snapshot ID (or "latest")')
  .argument('[version2]', 'Second snapshot ID (omit for current)')
  .option('--slug <slug>', 'Project slug (default: from .ldc file)')
  .action(async (v1, v2, opts) => {
    const sb = getClient();
    const slug = requireSlug(opts);
    const project = await api.getProjectBySlug(sb, slug);
    if (!project) { err(`Project not found: ${slug}`); process.exit(1); }
    const snapshots = await api.listSnapshots(sb, project.id);
    if (!snapshots.length) { err('No context snapshots. Run `ldc agent-context` first.'); process.exit(1); }

    // Resolve snapshot IDs
    function resolve(ref) {
      if (!ref || ref === 'latest') return snapshots[0];
      // Match by short or full ID
      return snapshots.find(s => s.id.startsWith(ref));
    }

    const snap1 = resolve(v1);
    if (!snap1) { err(`Snapshot not found: ${v1}`); process.exit(1); }
    const full1 = await api.getSnapshot(sb, snap1.id);
    if (!full1) { err('Failed to load snapshot'); process.exit(1); }

    let olderCtx, newerCtx, label;
    if (v2) {
      const snap2 = resolve(v2);
      if (!snap2) { err(`Snapshot not found: ${v2}`); process.exit(1); }
      const full2 = await api.getSnapshot(sb, snap2.id);
      if (!full2) { err('Failed to load snapshot'); process.exit(1); }
      // Determine order by date
      if (new Date(full1.created_at) < new Date(full2.created_at)) {
        olderCtx = full1.context_json; newerCtx = full2.context_json;
        label = `${new Date(full1.created_at).toLocaleString()} → ${new Date(full2.created_at).toLocaleString()}`;
      } else {
        olderCtx = full2.context_json; newerCtx = full1.context_json;
        label = `${new Date(full2.created_at).toLocaleString()} → ${new Date(full1.created_at).toLocaleString()}`;
      }
    } else {
      // Compare snapshot vs. current
      const scope = await api.getProjectScope(sb, slug);
      const currentCtx = api.buildAgentContext(scope);
      olderCtx = full1.context_json;
      newerCtx = currentCtx;
      label = `${new Date(full1.created_at).toLocaleString()} → current`;
    }

    const diffs = api.diffContexts(olderCtx, newerCtx);
    console.log('');
    console.log(c.bold(`  Diff: ${label}`));
    console.log(c.gray('  ─────────────────────────────────────'));
    if (!diffs.length) {
      ok('No changes');
    } else {
      for (const d of diffs) {
        const sym = d.type === 'added' ? c.green('+') : d.type === 'removed' ? c.red('-') : c.yellow('~');
        console.log(`  ${sym} ${d.path}`);
        if (d.type === 'changed') {
          console.log(c.red(`    - ${JSON.stringify(d.oldValue)}`));
          console.log(c.green(`    + ${JSON.stringify(d.newValue)}`));
        } else if (d.type === 'added') {
          console.log(c.green(`    + ${JSON.stringify(d.newValue)}`));
        } else if (d.type === 'removed') {
          console.log(c.red(`    - ${JSON.stringify(d.oldValue)}`));
        }
      }
      console.log('');
      info(`${diffs.length} change${diffs.length !== 1 ? 's' : ''}`);
    }
    console.log('');
  });

// ── ldc notes ─────────────────────────────────────────────────────────────────
const notes = new Command('notes').description('Manage project notes and gotchas');

notes
  .command('list')
  .description('List all notes for the current project')
  .option('--slug <slug>', 'Project slug (default: from .ldc file)')
  .option('--category <cat>', 'Filter by category (general, gotcha, tip, bug, database, setup)')
  .action(async (opts) => {
    const sb = getClient();
    const slug = requireSlug(opts);
    const project = await api.getProjectBySlug(sb, slug);
    if (!project) { err(`Project not found: ${slug}`); process.exit(1); }
    const notesList = await api.listNotes(sb, project.id);
    const filtered = opts.category ? notesList.filter(n => n.category === opts.category) : notesList;
    if (!filtered.length) { info('No notes yet. Run `ldc notes add` to create one.'); return; }
    console.log('');
    for (const n of filtered) {
      const pin = n.pinned ? c.green(' [pinned]') : '';
      const cat = c.gray(`[${n.category}]`);
      const tags = n.tags ? c.dim(` #${n.tags.split(',').map(s => s.trim()).filter(Boolean).join(' #')}`) : '';
      console.log(`  ${c.bold(n.title)}  ${cat}${pin}${tags}`);
      if (n.content) {
        const preview = n.content.split('\n')[0].slice(0, 80);
        console.log(c.gray(`    ${preview}${n.content.length > 80 ? '…' : ''}`));
      }
    }
    console.log('');
  });

notes
  .command('add <title>')
  .description('Add a new note')
  .option('--slug <slug>', 'Project slug (default: from .ldc file)')
  .option('--category <cat>', 'Category (general, gotcha, tip, bug, database, setup)', 'general')
  .option('--content <text>', 'Note content')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--pinned', 'Pin this note')
  .action(async (title, opts) => {
    const sb = getClient();
    const slug = requireSlug(opts);
    const project = await api.getProjectBySlug(sb, slug);
    if (!project) { err(`Project not found: ${slug}`); process.exit(1); }

    await api.insertNote(sb, {
      project_id: project.id,
      title,
      content: opts.content || '',
      category: opts.category,
      tags: opts.tags || '',
      pinned: !!opts.pinned,
    });
    ok(`Added note: ${title}`);
  });

notes
  .command('remove <title>')
  .description('Remove a note by title (exact match)')
  .option('--slug <slug>', 'Project slug (default: from .ldc file)')
  .action(async (title, opts) => {
    const sb = getClient();
    const slug = requireSlug(opts);
    const project = await api.getProjectBySlug(sb, slug);
    if (!project) { err(`Project not found: ${slug}`); process.exit(1); }
    const notesList = await api.listNotes(sb, project.id);
    const match = notesList.find(n => n.title === title);
    if (!match) { err(`Note not found: "${title}"`); process.exit(1); }
    await api.deleteNote(sb, match.id);
    ok(`Removed note: ${title}`);
  });

program.addCommand(notes);

// ── ldc webhooks ──────────────────────────────────────────────────────────────
const webhooks = new Command('webhooks').description('Manage webhook notifications for project events');

webhooks
  .command('list')
  .description('List all webhooks for the current project')
  .option('--slug <slug>', 'Project slug (default: from .ldc file)')
  .action(async (opts) => {
    const sb = getClient();
    const slug = requireSlug(opts);
    const project = await api.getProjectBySlug(sb, slug);
    if (!project) { err(`Project not found: ${slug}`); process.exit(1); }

    const hooks = await api.listWebhooks(sb, project.id);
    if (!hooks.length) { info('No webhooks configured. Run `ldc webhooks add <url>` to add one.'); return; }
    console.log('');
    for (const h of hooks) {
      const status = h.enabled ? c.green('on') : c.red('off');
      const label = h.label ? c.gray(` (${h.label})`) : '';
      console.log(`  ${c.bold(h.url)}  ${status}${label}`);
      console.log(c.gray(`    events: ${h.events}    id: ${h.id.slice(0, 8)}`));
    }
    console.log('');
  });

webhooks
  .command('add <url>')
  .description('Add a webhook URL')
  .option('--slug <slug>', 'Project slug (default: from .ldc file)')
  .option('--label <label>', 'Label for this webhook')
  .option('--events <events>', 'Comma-separated event types', 'daemon.start,daemon.stop,deploy.triggered,deploy.completed,port.health_failure,sync.completed')
  .option('--secret <secret>', 'HMAC-SHA256 secret for payload signing')
  .option('--disabled', 'Create as disabled')
  .action(async (url, opts) => {
    const sb = getClient();
    const slug = requireSlug(opts);
    const project = await api.getProjectBySlug(sb, slug);
    if (!project) { err(`Project not found: ${slug}`); process.exit(1); }

    await api.createWebhook(sb, {
      project_id: project.id,
      url,
      label: opts.label || '',
      events: opts.events,
      secret: opts.secret || '',
      enabled: !opts.disabled,
    });
    ok(`Added webhook: ${url}`);
    info(`Events: ${opts.events}`);
  });

webhooks
  .command('remove <url>')
  .description('Remove a webhook by URL (or prefix)')
  .option('--slug <slug>', 'Project slug (default: from .ldc file)')
  .action(async (url, opts) => {
    const sb = getClient();
    const slug = requireSlug(opts);
    const project = await api.getProjectBySlug(sb, slug);
    if (!project) { err(`Project not found: ${slug}`); process.exit(1); }

    const hooks = await api.listWebhooks(sb, project.id);
    const match = hooks.find(h => h.url === url || h.url.startsWith(url));
    if (!match) { err(`Webhook not found: ${url}`); process.exit(1); }

    await api.deleteWebhook(sb, match.id);
    ok(`Removed webhook: ${match.url}`);
  });

webhooks
  .command('test <url>')
  .description('Send a test webhook to a URL')
  .option('--secret <secret>', 'HMAC-SHA256 secret')
  .option('--event <event>', 'Event type to send', 'test')
  .action(async (url, opts) => {
    info(`Sending test webhook to ${url}…`);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const payload = {
        event: opts.event,
        timestamp: new Date().toISOString(),
        project: { slug: 'test-project', name: 'Test Project' },
        data: { message: 'Test webhook from ldc CLI' },
      };
      const body = JSON.stringify(payload);

      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'ldc-webhook/0.1.0',
        'X-Webhook-Event': opts.event,
      };

      if (opts.secret) {
        const { createHmac } = await import('crypto');
        const sig = createHmac('sha256', opts.secret).update(body).digest('hex');
        headers['X-Webhook-Signature'] = `sha256=${sig}`;
      }

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        ok(`Webhook delivered — HTTP ${res.status}`);
      } else {
        err(`Webhook failed — HTTP ${res.status} ${res.statusText}`);
      }
    } catch (e) {
      err(`Webhook delivery error: ${e.message}`);
    }
  });

program.addCommand(webhooks);

// ── ldc daemon ────────────────────────────────────────────────────────────────
program
  .command('daemon')
  .description('Start the local HTTP bridge daemon (lets the web UI control processes)')
  .option('--port <port>', 'Port to listen on', '7891')
  .option('--dir <directory>', 'Start daemon in specific project directory')
  .action(async (opts) => {
    const { startDaemon } = await import('./lib/daemon.js');
    // Change to specified directory if provided
    if (opts.dir) {
      const { chdir } = await import('node:process');
      chdir(opts.dir);
      console.log(`\x1b[36m➜\x1b[0m Starting daemon in directory: ${opts.dir}`);
    }
    startDaemon(parseInt(opts.port));
  });

// ── ldc completions ──────────────────────────────────────────────────────────
const completionsCmd = new Command('completions').description('Generate or install shell completion scripts');

completionsCmd
  .command('bash')
  .description('Output bash completion script to stdout')
  .action(() => { process.stdout.write(generateBash()); });

completionsCmd
  .command('zsh')
  .description('Output zsh completion script to stdout')
  .action(() => { process.stdout.write(generateZsh()); });

completionsCmd
  .command('fish')
  .description('Output fish completion script to stdout')
  .action(() => { process.stdout.write(generateFish()); });

completionsCmd
  .command('install')
  .description('Auto-install completions for the current shell')
  .option('--shell <shell>', 'Shell to install for (bash, zsh, fish)')
  .action((opts) => {
    const shell = opts.shell || detectShell();
    if (!shell) {
      err('Could not detect shell. Use --shell bash|zsh|fish');
      process.exit(1);
    }
    info(`Installing completions for ${shell}…`);
    const result = installCompletions(shell);
    if (!result.success) {
      err(result.error);
      process.exit(1);
    }
    ok(`Completion script written to ${result.targetPath}`);
    if (result.rcUpdated) {
      ok(`Added source line to ${result.rcFile}`);
      info('Restart your shell or run:');
      if (shell === 'bash') console.log(c.gray(`  source ${result.rcFile}`));
      if (shell === 'zsh')  console.log(c.gray(`  source ${result.rcFile}`));
    } else if (result.rcFile) {
      skip(`${result.rcFile} already configured`);
    }
    if (shell === 'fish') {
      info('Fish will auto-load completions on next shell start.');
    }
  });

program.addCommand(completionsCmd);

// ── ldc tui ──────────────────────────────────────────────────────────────────
program
  .command('tui')
  .description('Launch interactive terminal dashboard (TUI mode)')
  .option('--daemon-port <port>', 'Daemon port to connect to', '7891')
  .action(async (opts) => {
    const cfg = loadConfig();
    if (!cfg) { err('Not logged in. Run: ldc login'); process.exit(1); }

    const sb = getClient();
    const daemonPort = parseInt(opts.daemonPort);

    // Check if daemon is reachable
    let daemonOk = false;
    try {
      const res = await fetch(`http://127.0.0.1:${daemonPort}/health`);
      daemonOk = res.ok;
    } catch {}

    if (!daemonOk) {
      warn('Daemon not running — process/port/log features will be unavailable.');
      info(`Start it in another terminal: ldc daemon --port ${daemonPort}`);
      console.log('');
    }

    const { startTui } = await import('./tui/App.js');
    const instance = startTui({ daemonPort, supabase: sb });
    await instance.waitUntilExit();
  });

program.parse();
