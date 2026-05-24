// Mirrors src/lib/api.ts but accepts a Supabase client as first arg (no singleton)

async function check(res) {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export async function listProjects(sb) {
  return check(await sb.from('projects').select('*').order('name'));
}

export async function getProjectBySlug(sb, slug) {
  const { data, error } = await sb.from('projects').select('*').eq('slug', slug).single();
  if (error) return null;
  return data;
}

export async function createProject(sb, row) {
  return check(await sb.from('projects').insert(row).select().single());
}

export async function updateProject(sb, id, row) {
  return check(await sb.from('projects').update({ ...row, updated_at: new Date().toISOString() }).eq('id', id).select().single());
}

export async function deleteProject(sb, id) {
  return check(await sb.from('projects').delete().eq('id', id));
}

async function listBy(sb, table, projectId) {
  return check(await sb.from(table).select('*').eq('project_id', projectId));
}

export async function listNotes(sb, projectId) {
  return check(await sb.from('project_notes').select('*').eq('project_id', projectId)
    .order('pinned', { ascending: false }).order('updated_at', { ascending: false }));
}

export async function insertNote(sb, row) {
  return check(await sb.from('project_notes').insert(row).select().single());
}

export async function deleteNote(sb, id) {
  return check(await sb.from('project_notes').delete().eq('id', id));
}

export async function getProjectScope(sb, slug) {
  const project = await getProjectBySlug(sb, slug);
  if (!project) return null;
  const id = project.id;
  const [commands, ports, urls, deployments, env_keys, infisical_refs, docker, launch_groups, launch_group_steps, overridesArr, notes] = await Promise.all([
    listBy(sb, 'command_profiles', id),
    listBy(sb, 'project_ports', id),
    listBy(sb, 'project_urls', id),
    listBy(sb, 'deployment_targets', id),
    listBy(sb, 'env_keys', id),
    listBy(sb, 'infisical_refs', id),
    listBy(sb, 'docker_compose_configs', id),
    listBy(sb, 'launch_groups', id),
    check(await sb.from('launch_group_steps').select('*, launch_groups!inner(project_id)').eq('launch_groups.project_id', id).order('sort_order')).then(rows => (rows || []).map(r => { const { launch_groups: _, ...step } = r; return step; })),
    check(await sb.from('agent_context_overrides').select('*').eq('project_id', id)),
    listNotes(sb, id),
  ]);
  return {
    project,
    commands: commands || [],
    ports: ports || [],
    urls: urls || [],
    deployments: deployments || [],
    env_keys: env_keys || [],
    infisical_refs: infisical_refs || [],
    docker: docker || [],
    launch_groups: launch_groups || [],
    launch_group_steps: launch_group_steps || [],
    overrides: (overridesArr || [])[0] || null,
    notes: notes || [],
  };
}

// ── Agent Context Builder ────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  /\b(sk|pk|rk)_[A-Za-z0-9_-]{16,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]+/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /postgres(?:ql)?:\/\/[^:]+:[^@]+@/gi,
];

export function maskSecrets(text) {
  let out = text;
  for (const p of SECRET_PATTERNS) out = out.replace(p, '[masked]');
  return out;
}

function splitLines(text) {
  return (text || '').split('\n').map(s => s.trim()).filter(Boolean);
}

export function buildAgentContext(scope) {
  const p = scope.project;
  const o = scope.overrides;
  return {
    project: {
      name: p.name, slug: p.slug, description: p.description,
      repo_path: p.repo_path, repo_url: p.repo_url,
      package_manager: p.package_manager, default_branch: p.default_branch,
      monorepo_paths: splitLines(p.monorepo_paths),
      tags: (p.tags || '').split(',').map(s => s.trim()).filter(Boolean),
      status: p.status, hosting_platform: p.hosting_platform,
    },
    start_commands: (scope.commands || []).filter(c => ['dev', 'start', 'build'].includes(c.kind)).map(c => ({
      name: c.name, kind: c.kind, command: c.command, working_dir: c.working_dir,
      expected_port: c.expected_port, must_confirm: c.must_confirm,
    })),
    recommended_commands: (scope.commands || []).map(c => ({ name: c.name, kind: c.kind, command: c.command })),
    ports: (scope.ports || []).map(pt => ({
      label: pt.label, port: pt.port, protocol: pt.protocol,
      local_url: pt.local_url, health_url: pt.health_url,
    })),
    urls: (scope.urls || []).map(u => ({ label: u.label, url: u.url, category: u.category, environment: u.environment })),
    deployments: (scope.deployments || []).map(d => ({
      platform: d.platform, project_name: d.platform_project_name, environment: d.environment,
      production_url: d.production_url, preview_url_pattern: d.preview_url_pattern,
      dashboard_url: d.dashboard_url, region: d.region, branch: d.branch,
      domains: (d.domains || '').split(',').map(s => s.trim()).filter(Boolean),
    })),
    env_keys_required: (scope.env_keys || []).map(e => ({
      key: e.key_name, purpose: e.purpose, classification: e.classification,
      source: e.source_type, env_scope: e.env_scope, infisical_path: e.infisical_path,
      required: e.required,
    })),
    infisical_refs: (scope.infisical_refs || []).map(i => ({
      project_id: i.infisical_project_id, workspace: i.workspace_name,
      environment: i.environment, secret_path: i.secret_path,
      run_command_pattern: i.run_command_pattern,
    })),
    docker_compose: (scope.docker || []).map(d => ({
      compose_file: d.compose_file_path, project_name: d.compose_project_name,
      services: (d.services || '').split(',').map(s => s.trim()).filter(Boolean),
    })),
    notes: p.notes,
    danger_notes: p.danger_notes,
    project_notes: (scope.notes || []).map(n => ({
      title: n.title, content: n.content, category: n.category,
      tags: (n.tags || '').split(',').map(s => s.trim()).filter(Boolean),
      pinned: n.pinned,
    })),
    database_notes: o?.database_notes || '',
    migration_notes: o?.migration_notes || '',
    danger_zones: splitLines(o?.danger_zones),
    gotchas: splitLines(o?.gotchas),
    must_confirm_commands: splitLines(o?.must_confirm_commands),
    safety: { raw_secrets_included: false, secret_references_only: true, bind_host: '127.0.0.1' },
  };
}

// ── Diff utility ─────────────────────────────────────────────────────────────

export function diffContexts(older, newer, prefix = '') {
  const diffs = [];
  const allKeys = new Set([...Object.keys(older), ...Object.keys(newer)]);
  for (const key of allKeys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const a = older[key];
    const b = newer[key];
    if (!(key in older)) {
      diffs.push({ path, type: 'added', newValue: b });
    } else if (!(key in newer)) {
      diffs.push({ path, type: 'removed', oldValue: a });
    } else if (typeof a === 'object' && a !== null && !Array.isArray(a) && typeof b === 'object' && b !== null && !Array.isArray(b)) {
      diffs.push(...diffContexts(a, b, path));
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      diffs.push({ path, type: 'changed', oldValue: a, newValue: b });
    }
  }
  return diffs;
}

// ── Agent Context Snapshots ──────────────────────────────────────────────────

export async function saveSnapshot(sb, projectId, contextJson, trigger = 'manual', label = '') {
  return check(await sb.from('agent_context_snapshots')
    .insert({ project_id: projectId, context_json: contextJson, trigger, label })
    .select().single());
}

export async function listSnapshots(sb, projectId) {
  return check(await sb.from('agent_context_snapshots')
    .select('id, project_id, label, trigger, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(50));
}

export async function getSnapshot(sb, id) {
  const { data, error } = await sb.from('agent_context_snapshots')
    .select('*').eq('id', id).single();
  if (error) return null;
  return data;
}

export async function deleteSnapshot(sb, id) {
  return check(await sb.from('agent_context_snapshots').delete().eq('id', id));
}

// ── CRUD helpers ─────────────────────────────────────────────────────────────

export async function insertRow(sb, table, row) {
  return check(await sb.from(table).insert(row).select().single());
}

export async function upsertRow(sb, table, row) {
  const op = row.id
    ? sb.from(table).update(row).eq('id', row.id).select().single()
    : sb.from(table).insert(row).select().single();
  return check(await op);
}

// ── Webhook API ─────────────────────────────────────────────────────────────

export async function listWebhooks(sb, projectId) {
  return check(await sb.from('webhook_configs').select('*').eq('project_id', projectId).order('created_at'));
}

export async function createWebhook(sb, row) {
  return check(await sb.from('webhook_configs').insert(row).select().single());
}

export async function updateWebhook(sb, id, row) {
  return check(await sb.from('webhook_configs').update({ ...row, updated_at: new Date().toISOString() }).eq('id', id).select().single());
}

export async function deleteWebhook(sb, id) {
  return check(await sb.from('webhook_configs').delete().eq('id', id));
}

export async function listWebhookDeliveries(sb, webhookConfigId, limit = 50) {
  return check(await sb.from('webhook_deliveries')
    .select('*')
    .eq('webhook_config_id', webhookConfigId)
    .order('created_at', { ascending: false })
    .limit(limit));
}
