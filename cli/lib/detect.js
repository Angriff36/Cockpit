import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, basename, relative } from 'path';
import { execSync } from 'child_process';

function slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function run(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
  } catch { return null; }
}

function readText(filePath) {
  try { return readFileSync(filePath, 'utf8'); } catch { return null; }
}

/** Extract first matching port from a block of text */
function extractPort(text) {
  // Matches: --port 2221, --port=2221, -p 2221, PORT=2221, port: 2221
  const m = text.match(/(?:--port[= ]|-p\s+|PORT[= ]|port['":\s]+)(\d{4,5})/);
  return m ? parseInt(m[1]) : null;
}

// ── Framework database ─────────────────────────────────────────────────────
const FRAMEWORKS = [
  // dep key, default port, label, kind hint
  { dep: 'next',             port: 3000,  label: 'Next.js',     pm_script: 'dev' },
  { dep: 'nuxt',             port: 3000,  label: 'Nuxt',        pm_script: 'dev' },
  { dep: '@nuxt/kit',        port: 3000,  label: 'Nuxt',        pm_script: 'dev' },
  { dep: 'remix',            port: 3000,  label: 'Remix',       pm_script: 'dev' },
  { dep: '@remix-run/react', port: 3000,  label: 'Remix',       pm_script: 'dev' },
  { dep: 'vite',             port: 5173,  label: 'Vite',        pm_script: 'dev' },
  { dep: '@astrojs/core',    port: 4321,  label: 'Astro',       pm_script: 'dev' },
  { dep: 'astro',            port: 4321,  label: 'Astro',       pm_script: 'dev' },
  { dep: 'svelte',           port: 5173,  label: 'Svelte',      pm_script: 'dev' },
  { dep: '@sveltejs/kit',    port: 5173,  label: 'SvelteKit',   pm_script: 'dev' },
  { dep: 'express',          port: 3000,  label: 'Express',     pm_script: 'start' },
  { dep: 'fastify',          port: 3000,  label: 'Fastify',     pm_script: 'start' },
  { dep: 'hono',             port: 3000,  label: 'Hono',        pm_script: 'start' },
  { dep: 'nestjs',           port: 3000,  label: 'NestJS',      pm_script: 'start:dev' },
  { dep: '@nestjs/core',     port: 3000,  label: 'NestJS',      pm_script: 'start:dev' },
  { dep: 'koa',              port: 3000,  label: 'Koa',         pm_script: 'start' },
  { dep: 'strapi',           port: 1337,  label: 'Strapi',      pm_script: 'develop' },
  { dep: '@strapi/strapi',   port: 1337,  label: 'Strapi',      pm_script: 'develop' },
  { dep: 'payload',          port: 3000,  label: 'Payload CMS', pm_script: 'dev' },
];

// ── Script kind mapping ────────────────────────────────────────────────────
const SCRIPT_KIND_MAP = {
  dev: 'dev', develop: 'dev', 'dev:server': 'dev', 'start:dev': 'dev',
  start: 'start', serve: 'start',
  build: 'build', 'build:prod': 'build',
  test: 'test', 'test:unit': 'test', 'test:e2e': 'test',
  lint: 'lint', 'lint:fix': 'lint',
  migrate: 'migrate', 'db:migrate': 'migrate', 'migration:run': 'migrate',
  seed: 'seed', 'db:seed': 'seed',
  reset: 'reset', 'db:reset': 'reset', 'db:drop': 'reset',
  'type-check': 'lint', typecheck: 'lint',
  preview: 'start',
};

// Dirs to skip when walking for sub-packages
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt',
  '.svelte-kit', '.turbo', '.cache', 'coverage', '.vscode', '.idea',
  '__pycache__', '.pnpm-store', '.yarn', 'vendor', 'tmp', 'temp',
  'archive', 'backup', 'backups', 'legacy',
]);

// Commands worth surfacing from sub-packages — build/lint/typecheck/test
// are run via turbo from root and create noise if listed per-package
const SUB_PKG_KINDS = new Set(['dev', 'start', 'migrate', 'seed', 'reset']);

// ── Read port from framework config files ──────────────────────────────────
function detectConfigPort(cwd) {
  // vite.config.{ts,js,mts,mjs}
  for (const file of ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs']) {
    const content = readText(join(cwd, file));
    if (!content) continue;
    // Look for server: { port: XXXX } pattern
    const serverBlock = content.match(/server\s*:\s*\{([^}]+)\}/s);
    if (serverBlock) {
      const portMatch = serverBlock[1].match(/port\s*:\s*(\d{4,5})/);
      if (portMatch) return { port: parseInt(portMatch[1]), source: file };
    }
    // Looser pattern
    const loosePort = content.match(/port\s*:\s*(\d{4,5})/);
    if (loosePort) return { port: parseInt(loosePort[1]), source: file };
  }

  // astro.config.{mjs,ts,js}
  for (const file of ['astro.config.mjs', 'astro.config.ts', 'astro.config.js']) {
    const content = readText(join(cwd, file));
    if (!content) continue;
    const portMatch = content.match(/port\s*:\s*(\d{4,5})/);
    if (portMatch) return { port: parseInt(portMatch[1]), source: file };
  }

  // nuxt.config.{ts,js}
  for (const file of ['nuxt.config.ts', 'nuxt.config.js']) {
    const content = readText(join(cwd, file));
    if (!content) continue;
    const portMatch = content.match(/port\s*:\s*(\d{4,5})/);
    if (portMatch) return { port: parseInt(portMatch[1]), source: file };
  }

  // angular.json — look for serve.options.port
  const angularJson = readText(join(cwd, 'angular.json'));
  if (angularJson) {
    try {
      const a = JSON.parse(angularJson);
      const projects = a?.projects || {};
      for (const proj of Object.values(projects)) {
        const port = proj?.architect?.serve?.options?.port;
        if (port) return { port, source: 'angular.json' };
      }
    } catch {}
  }

  return null;
}

// ── Parse .env files for port and key names ────────────────────────────────
export function parseEnvFile(filePath) {
  const content = readText(filePath);
  if (!content) return { port: null, keys: [] };
  const keys = [];
  let port = null;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (/^[A-Z][A-Z0-9_]+$/.test(key)) {
      keys.push(key);
      if (key === 'PORT' && /^\d{4,5}$/.test(val)) port = parseInt(val);
    }
  }
  return { port, keys };
}

// ── Full docker-compose parser ─────────────────────────────────────────────
function parseDockerCompose(content, filename) {
  const result = { services: [], ports: [], envKeys: [] };

  // Parse services (top-level keys under `services:`)
  let inServices = false, inService = false, currentService = '';
  let serviceIndent = -1;

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.match(/^(\s*)/)[1].length;

    if (/^services\s*:/.test(line)) { inServices = true; serviceIndent = -1; continue; }
    if (inServices && serviceIndent === -1 && indent > 0) { serviceIndent = indent; }

    if (inServices && serviceIndent >= 0) {
      // Top-level service names (one indent level below `services:`)
      if (indent === serviceIndent && /^\s+\w/.test(line) && trimmed.endsWith(':')) {
        currentService = trimmed.replace(':', '').trim();
        if (currentService && !currentService.startsWith('_')) {
          result.services.push(currentService);
        }
        inService = true;
        continue;
      }
      // Exit services block if we hit a top-level key
      if (indent === 0 && trimmed.includes(':')) {
        inServices = false;
        continue;
      }
    }

    // Port mappings anywhere in the file: "HOST:CONTAINER" patterns
    // Covers: - "3000:3000", - 3000:3000, ports: ["3000:3000"]
    const portMatches = [...line.matchAll(/["']?(\d{1,5}):(\d{1,5})["']?/g)];
    for (const [, hostPort, containerPort] of portMatches) {
      const hp = parseInt(hostPort), cp = parseInt(containerPort);
      if (hp >= 80 && hp < 65536 && cp >= 80 && cp < 65536) {
        if (!result.ports.find(p => p.container === cp)) {
          result.ports.push({ host: hp, container: cp, service: currentService });
        }
      }
    }

    // Environment variable keys (inside environment: sections)
    // Matches: KEY=value  or  KEY: value  or  - KEY=value
    const envKeyMatch = line.match(/^\s+[-\s]*([A-Z][A-Z0-9_]{2,})\s*[=:]/);
    if (envKeyMatch && !result.envKeys.includes(envKeyMatch[1])) {
      const k = envKeyMatch[1];
      // Filter out YAML-ish words and common non-env patterns
      if (!['FROM', 'RUN', 'CMD', 'ENV', 'ARG', 'COPY', 'ADD', 'EXPOSE', 'WORKDIR'].includes(k)) {
        result.envKeys.push(k);
      }
    }
  }

  return result;
}

// ── Vercel CLI enrichment ──────────────────────────────────────────────────

/** Run `vercel project ls` once and return parsed rows + team slug */
function getVercelProjects(cwd) {
  const output = run('vercel project ls', cwd);
  if (!output) return null;
  const teamMatch = output.match(/Fetching projects in ([^\s\[]+)/);
  const teamSlug = teamMatch ? teamMatch[1] : null;
  const rows = [];
  for (const line of output.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('Vercel') || t.startsWith('>') || t.startsWith('─') || t.toLowerCase().includes('project name')) continue;
    const cols = t.split(/\s{2,}/);
    if (cols.length >= 2) {
      const name = cols[0].trim();
      const url = cols[1].trim();
      if (name && url.startsWith('https://')) rows.push({ name, url });
    }
  }
  return { teamSlug, rows };
}

/** Read .vercel/project.json and enrich with data from the cached project list */
function enrichVercelDeployment(dir, projectList) {
  const projJson = readText(join(dir, '.vercel', 'project.json'));
  if (!projJson) return null;
  let projectId, orgId, projectName;
  try { ({ projectId, orgId, projectName } = JSON.parse(projJson)); } catch { return null; }

  const info = { platform: 'vercel', environment: 'production', deploy_command: 'vercel --prod' };
  if (projectId) info.platform_project_id = projectId;
  if (projectName) info.platform_project_name = projectName;

  if (projectList) {
    const { teamSlug, rows } = projectList;
    if (teamSlug) info.team_or_org = teamSlug;

    // Match project row: exact name, or Vercel name ends with "-<localName>"
    const match = rows.find(r => r.name === projectName) ||
                  rows.find(r => r.name.endsWith(`-${projectName}`));
    if (match) {
      info.production_url = match.url;
      info.platform_project_name = match.name; // use real Vercel name
    }

    // Construct dashboard + logs URLs
    const team = teamSlug;
    const proj = info.platform_project_name;
    if (team && proj) {
      info.dashboard_url = `https://vercel.com/${team}/${proj}`;
      info.logs_url = `https://vercel.com/${team}/${proj}/deployments`;
    }
  }

  return info;
}

/** Run `vercel env ls` in a dir and return env key names */
function getVercelEnvKeys(dir) {
  const output = run('vercel env ls', dir);
  if (!output) return [];
  const keys = [];
  for (const line of output.split('\n')) {
    const m = line.match(/^\s+([A-Z][A-Z0-9_]{2,})\s/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

// ── Find all sub-packages (directories with package.json) ─────────────────
function findSubPackages(cwd, maxDepth = 2) {
  const subs = [];
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      const subDir = join(dir, entry.name);
      if (existsSync(join(subDir, 'package.json'))) subs.push(subDir);
      walk(subDir, depth + 1);
    }
  }
  walk(cwd, 0);
  return subs;
}

// ── Scan a single sub-package dir and return detected items ───────────────
function scanSubPkg(dir, relPath, pm, seenPorts, seenKeys, vercelProjectList) {
  const cmds = [], ports = [], envKeys = [], docker = [], deployments = [];

  // Package name for labeling
  let pkgName = basename(dir);
  let pkg = {};
  try { pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')); } catch {}
  // Strip npm scope from package name for labels (e.g. @acme/web → web)
  if (pkg.name) pkgName = pkg.name.replace(/^@[^/]+\//, '');

  const runPrefix = pm === 'npm' ? 'npm run' : pm;

  // Scripts → commands
  for (const [scriptName, scriptCmd] of Object.entries(pkg.scripts || {})) {
    const kind = SCRIPT_KIND_MAP[scriptName];
    if (!kind) continue;
    const inlinePort = extractPort(scriptCmd) || null;
    cmds.push({
      name: `${pkgName}: ${scriptName}`,
      kind,
      command: `${runPrefix} ${scriptName}`,
      working_dir: relPath,
      expected_port: inlinePort,
      health_url: '',
      must_confirm: ['migrate', 'reset', 'seed'].includes(kind),
      notes: `${relPath}/package.json scripts.${scriptName}`,
    });
    if (inlinePort && !seenPorts.has(inlinePort)) {
      seenPorts.add(inlinePort);
      ports.push({ label: `${pkgName} (${scriptName})`, port: inlinePort, protocol: 'http', local_url: `http://127.0.0.1:${inlinePort}`, health_url: '' });
    }
  }

  // Framework detection
  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  let fw = null;
  for (const f of FRAMEWORKS) {
    if (allDeps[f.dep]) { fw = f; break; }
  }

  // Config file port
  const configPort = detectConfigPort(dir);
  if (configPort && !seenPorts.has(configPort.port)) {
    seenPorts.add(configPort.port);
    ports.push({ label: `${pkgName} (${configPort.source})`, port: configPort.port, protocol: 'http', local_url: `http://127.0.0.1:${configPort.port}`, health_url: '' });
  }

  // Backfill expected_port on dev/start commands
  const devPort = configPort?.port || fw?.port || null;
  if (devPort) {
    for (const cmd of cmds) {
      if (!cmd.expected_port && ['dev', 'start'].includes(cmd.kind)) cmd.expected_port = devPort;
    }
  }

  // NOTE: no framework default port fallback for sub-packages — too many packages share
  // the same framework default (e.g. every Next.js app defaults to 3000) and guessing
  // wrong is worse than missing it. Port must be explicitly set via script arg, config
  // file, or .env in the sub-package directory.

  // .env files
  for (const envFile of ['.env', '.env.local', '.env.example', '.env.sample', '.env.development']) {
    const { port: envPort, keys } = parseEnvFile(join(dir, envFile));
    if (envPort && !seenPorts.has(envPort)) {
      seenPorts.add(envPort);
      ports.push({ label: `${pkgName} ${envFile} PORT`, port: envPort, protocol: 'http', local_url: `http://127.0.0.1:${envPort}`, health_url: '' });
    }
    for (const k of keys) {
      if (!seenKeys.has(k)) {
        seenKeys.add(k);
        envKeys.push({ key_name: k, purpose: '', classification: 'unknown', source_type: 'manual', infisical_path: '', env_scope: '', required: true });
      }
    }
  }

  // Docker compose
  for (const file of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
    const content = readText(join(dir, file));
    if (!content) continue;
    const { services, ports: dPorts, envKeys: dEnvKeys } = parseDockerCompose(content, file);
    for (const { host, container, service } of dPorts) {
      if (!seenPorts.has(container)) {
        seenPorts.add(container);
        ports.push({ label: `${pkgName}/${service || 'docker'} :${container}`, port: container, protocol: 'tcp', local_url: `http://127.0.0.1:${host}`, health_url: '' });
      }
    }
    for (const k of dEnvKeys) {
      if (!seenKeys.has(k)) {
        seenKeys.add(k);
        envKeys.push({ key_name: k, purpose: '', classification: 'unknown', source_type: 'manual', infisical_path: '', env_scope: '', required: false });
      }
    }
    docker.push({ compose_file_path: `${relPath}/${file}`, compose_project_name: pkgName, services: services.join(', '), notes: `${services.length} service(s): ${services.slice(0, 5).join(', ')}` });
    break;
  }

  // Vercel: .vercel/project.json + CLI project list
  const vercelCLI = enrichVercelDeployment(dir, vercelProjectList);
  if (vercelCLI) {
    deployments.push(vercelCLI);
    // Env keys from this sub-app's vercel project
    const vercelKeys = getVercelEnvKeys(dir);
    for (const k of vercelKeys) {
      if (!seenKeys.has(k)) {
        seenKeys.add(k);
        envKeys.push({ key_name: k, purpose: '', classification: 'unknown', source_type: 'vercel-env', infisical_path: '', env_scope: '', required: true });
      }
    }
  }

  return { cmds, ports, envKeys, docker, deployments };
}

function readInfisicalConfig(cwd) {
  const raw = readText(join(cwd, '.infisical.json'));
  if (!raw) return null;
  try {
    const cfg = JSON.parse(raw);
    const projectId = cfg.workspaceId || cfg.projectId || cfg.workspace_id || cfg.project_id || '';
    if (!projectId) return null;
    const env = cfg.defaultEnvironment || cfg.default_environment || 'dev';
    return {
      infisical_project_id: projectId,
      environment: env,
      secret_path: '/',
      run_command_pattern: `infisical run --env=${env} --path=/ -- `,
      notes: 'imported from .infisical.json',
    };
  } catch {
    return null;
  }
}

// ── Main detect function ───────────────────────────────────────────────────
export async function detect(cwd) {
  const result = {
    project: { repo_path: cwd },
    commands: [],
    ports: [],
    urls: [],
    deployments: [],
    env_keys: [],
    docker: [],
    infisical_refs: [],
  };

  // ── Vercel CLI: fetch project list once (used for root + all sub-packages) ─
  const vercelProjectList = getVercelProjects(cwd);

  // ── Package manager ──────────────────────────────────────────────────────
  let pm = 'npm';
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) pm = 'pnpm';
  else if (existsSync(join(cwd, 'bun.lockb'))) pm = 'bun';
  else if (existsSync(join(cwd, 'yarn.lock'))) pm = 'yarn';
  result.project.package_manager = pm;

  const infisical = readInfisicalConfig(cwd);
  if (infisical) result.infisical_refs.push(infisical);

  // ── package.json ─────────────────────────────────────────────────────────
  let pkg = {};
  const pkgFile = join(cwd, 'package.json');
  if (existsSync(pkgFile)) {
    try { pkg = JSON.parse(readFileSync(pkgFile, 'utf8')); } catch {}
  }

  const rawName = pkg.name || basename(cwd);
  result.project.name = rawName;
  result.project.slug = slugify(rawName);

  // Scripts → commands (root package only if it has real scripts)
  const runPrefix = pm === 'npm' ? 'npm run' : pm;
  for (const [scriptName, scriptCmd] of Object.entries(pkg.scripts || {})) {
    const kind = SCRIPT_KIND_MAP[scriptName];
    if (!kind) continue;
    // Port from inline script arg (e.g. --port 4000)
    const inlinePort = extractPort(scriptCmd) || null;
    result.commands.push({
      name: scriptName,
      kind,
      command: `${runPrefix} ${scriptName}`,
      working_dir: '',
      expected_port: inlinePort,
      health_url: '',
      must_confirm: ['migrate', 'reset', 'seed'].includes(kind),
      notes: `package.json scripts.${scriptName}`,
    });

    // Port from script command string
    const port = extractPort(scriptCmd);
    if (port && !result.ports.find(p => p.port === port)) {
      result.ports.push({
        label: `${scriptName} (script arg)`,
        port, protocol: 'http',
        local_url: `http://127.0.0.1:${port}`, health_url: '',
      });
    }
  }

  // ── Framework detection ──────────────────────────────────────────────────
  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

  let detectedFramework = null;
  for (const fw of FRAMEWORKS) {
    if (allDeps[fw.dep]) { detectedFramework = fw; break; }
  }

  // ── Config file port (vite.config, astro.config, etc.) ──────────────────
  const configPort = detectConfigPort(cwd);
  if (configPort && !result.ports.find(p => p.port === configPort.port)) {
    result.ports.push({
      label: `${detectedFramework?.label || 'Dev server'} (${configPort.source})`,
      port: configPort.port,
      protocol: 'http',
      local_url: `http://127.0.0.1:${configPort.port}`,
      health_url: '',
    });
  }

  // Backfill expected_port on dev/start commands using config file port or framework default
  const devPort = configPort?.port || detectedFramework?.port || null;
  if (devPort) {
    for (const cmd of result.commands) {
      if (!cmd.expected_port && ['dev', 'start'].includes(cmd.kind)) {
        cmd.expected_port = devPort;
      }
    }
  }

  // ── .env files for PORT= and key names ──────────────────────────────────
  const envFiles = ['.env', '.env.local', '.env.example', '.env.sample', '.env.development'];
  const seenKeys = new Set();

  for (const envFile of envFiles) {
    const { port: envPort, keys } = parseEnvFile(join(cwd, envFile));

    if (envPort && !result.ports.find(p => p.port === envPort)) {
      result.ports.push({
        label: `${envFile} PORT`,
        port: envPort, protocol: 'http',
        local_url: `http://127.0.0.1:${envPort}`, health_url: '',
      });
    }

    for (const k of keys) {
      if (!seenKeys.has(k)) {
        seenKeys.add(k);
        result.env_keys.push({
          key_name: k, purpose: '', classification: 'unknown',
          source_type: 'manual', infisical_path: '', env_scope: '', required: true,
        });
      }
    }
  }

  // Framework default port fallback (if no port found yet)
  if (detectedFramework && !result.ports.find(p => p.port === detectedFramework.port)) {
    result.ports.push({
      label: `${detectedFramework.label} (default)`,
      port: detectedFramework.port,
      protocol: 'http',
      local_url: `http://127.0.0.1:${detectedFramework.port}`,
      health_url: `http://127.0.0.1:${detectedFramework.port}`,
    });
    if (!result.project.hosting_platform && detectedFramework.dep === 'next') {
      result.project.hosting_platform = 'vercel';
    }
  }

  // ── Git ──────────────────────────────────────────────────────────────────
  const repoUrl = run('git remote get-url origin', cwd);
  if (repoUrl) result.project.repo_url = repoUrl;
  result.project.default_branch = run('git branch --show-current', cwd) || 'main';

  // ── Docker Compose (full parse) ──────────────────────────────────────────
  const seenPorts = new Set(result.ports.map(p => p.port));

  for (const file of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
    const composePath = join(cwd, file);
    const content = readText(composePath);
    if (!content) continue;

    const { services, ports: composePorts, envKeys } = parseDockerCompose(content, file);

    for (const { host, container, service } of composePorts) {
      if (!seenPorts.has(container)) {
        seenPorts.add(container);
        result.ports.push({
          label: `${service || 'docker'} (${container})`,
          port: container,
          protocol: 'tcp',
          local_url: `http://127.0.0.1:${host}`,
          health_url: '',
        });
      }
    }

    // Docker-sourced env keys
    for (const k of envKeys) {
      if (!seenKeys.has(k)) {
        seenKeys.add(k);
        result.env_keys.push({
          key_name: k, purpose: '', classification: 'unknown',
          source_type: 'manual', infisical_path: '', env_scope: '', required: false,
        });
      }
    }

    result.docker.push({
      compose_file_path: file,
      compose_project_name: basename(cwd),
      services: services.join(', '),
      notes: `${services.length} service(s): ${services.slice(0, 5).join(', ')}${services.length > 5 ? '…' : ''}`,
    });
    break;
  }

  // ── Dockerfile ───────────────────────────────────────────────────────────
  for (const file of ['Dockerfile', 'dockerfile']) {
    const content = readText(join(cwd, file));
    if (!content) continue;
    // EXPOSE declarations
    for (const [, port] of content.matchAll(/^EXPOSE\s+(\d{2,5})/gm)) {
      const p = parseInt(port);
      if (!seenPorts.has(p)) {
        seenPorts.add(p);
        result.ports.push({
          label: `Dockerfile EXPOSE ${p}`,
          port: p, protocol: 'http',
          local_url: `http://127.0.0.1:${p}`, health_url: '',
        });
      }
    }
    break;
  }

  // ── vercel.json + .vercel/project.json + CLI ─────────────────────────────
  const vercelJson = readText(join(cwd, 'vercel.json'));
  const vercelCLI = enrichVercelDeployment(cwd, vercelProjectList);

  if (vercelJson || vercelCLI) {
    let buildCommand = '';
    try { const v = JSON.parse(vercelJson || '{}'); buildCommand = v.buildCommand || ''; } catch {}
    const dep = {
      platform: 'vercel',
      environment: 'production',
      build_command: buildCommand,
      deploy_command: 'vercel --prod',
      production_url: '',
      notes: 'detected from vercel.json',
      ...(vercelCLI || {}),
    };
    result.deployments.push(dep);
    if (!result.project.hosting_platform) result.project.hosting_platform = 'vercel';

    // Pull env key names from Vercel
    const vercelKeys = getVercelEnvKeys(cwd);
    for (const k of vercelKeys) {
      if (!seenKeys.has(k)) {
        seenKeys.add(k);
        result.env_keys.push({ key_name: k, purpose: '', classification: 'unknown', source_type: 'vercel-env', infisical_path: '', env_scope: '', required: true });
      }
    }
  }

  // ── fly.toml ─────────────────────────────────────────────────────────────
  const flyToml = readText(join(cwd, 'fly.toml'));
  if (flyToml) {
    const appMatch = flyToml.match(/^app\s*=\s*["']?([^"'\s]+)/m);
    result.deployments.push({
      platform: 'fly',
      environment: 'production',
      platform_project_name: appMatch ? appMatch[1] : '',
      deploy_command: 'fly deploy',
      production_url: appMatch ? `https://${appMatch[1]}.fly.dev` : '',
      notes: 'detected from fly.toml',
    });
    if (!result.project.hosting_platform) result.project.hosting_platform = 'fly';
  }

  // ── render.yaml / railway.toml ───────────────────────────────────────────
  if (existsSync(join(cwd, 'render.yaml')) || existsSync(join(cwd, 'render.yml'))) {
    result.deployments.push({
      platform: 'render', environment: 'production',
      deploy_command: '', production_url: '',
      notes: 'detected from render.yaml',
    });
    if (!result.project.hosting_platform) result.project.hosting_platform = 'render';
  }

  if (existsSync(join(cwd, 'railway.toml')) || existsSync(join(cwd, 'railway.json'))) {
    result.deployments.push({
      platform: 'railway', environment: 'production',
      deploy_command: '', production_url: '',
      notes: 'detected from railway.toml',
    });
    if (!result.project.hosting_platform) result.project.hosting_platform = 'railway';
  }

  // ── Scan all sub-packages recursively (always, not just monorepos) ────────
  const subDirs = findSubPackages(cwd);
  const subSeenPorts = new Set(result.ports.map(p => p.port));
  const subSeenKeys = new Set(result.env_keys.map(k => k.key_name));

  const subPaths = [];
  for (const subDir of subDirs) {
    const relPath = relative(cwd, subDir).replace(/\\/g, '/');
    subPaths.push(relPath);
    const { cmds, ports, envKeys, docker, deployments } = scanSubPkg(subDir, relPath, pm, subSeenPorts, subSeenKeys, vercelProjectList);
    result.commands.push(...cmds);
    result.ports.push(...ports);
    result.env_keys.push(...envKeys);
    result.docker.push(...docker);
    result.deployments.push(...deployments);
  }

  if (subPaths.length > 0) {
    result.project.monorepo_paths = subPaths.join(', ');
  }

  return result;
}

// ── Scan all .env files and return keys per file (no values) ────────────
const ENV_FILE_NAMES = ['.env', '.env.local', '.env.example', '.env.sample', '.env.development', '.env.production', '.env.staging', '.env.test'];

export function scanEnvFiles(cwd) {
  const files = {};
  const allKeys = new Set();

  for (const name of ENV_FILE_NAMES) {
    const { keys } = parseEnvFile(join(cwd, name));
    if (keys.length > 0) {
      files[name] = keys;
      for (const k of keys) allKeys.add(k);
    }
  }

  return { files, all_keys: [...allKeys] };
}
