import { supabase } from './supabase';
import type {
  Project, CommandProfile, ProjectPort, ProjectUrl, DeploymentTarget,
  EnvKey, InfisicalRef, DockerComposeConfig, LaunchGroup, LaunchGroupStep, AgentContextOverride,
  AgentContextSnapshot, ContextShareLink, ProjectScope, ProjectTemplate, SshConfig, Machine, MachineOverride, ProjectNote,
  DangerZoneCommand, DangerZoneExecution, GitHubToken, DeploymentHistoryEntry, PortConflict, ActivityLogEntry,
  CommandRunHistory, Runbook, RunbookStep, DashboardLayout, LayoutSection
} from './types';
import { cacheProjects, getCachedProjects, cacheScope, getCachedScope } from './cache';

/** Result wrapper that includes cache metadata when data came from IndexedDB */
export type CachedResult<T> = { data: T; fromCache: boolean; cachedAt: number | null; error?: boolean };

export async function listProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('pinned', { ascending: false })
    .order('pin_order')
    .order('name');
  if (error) throw error;
  const projects = data || [];
  // Write-through to cache on success
  cacheProjects(projects).catch(() => {});
  return projects;
}

/**
 * Cache-aware version: tries Supabase first, falls back to IndexedDB.
 * Returns data + metadata about whether it came from cache.
 */
export async function listProjectsCached(): Promise<CachedResult<Project[]>> {
  try {
    const projects = await listProjects();
    return { data: projects, fromCache: false, cachedAt: null };
  } catch {
    const cached = await getCachedProjects();
    if (cached) return { data: cached.data, fromCache: true, cachedAt: cached.cachedAt };
    return { data: [], fromCache: false, cachedAt: null, error: true };
  }
}

export async function getProjectBySlug(slug: string): Promise<Project | null> {
  const { data, error } = await supabase.from('projects').select('*').eq('slug', slug).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createProject(p: Partial<Project>): Promise<Project> {
  const { data, error } = await supabase.from('projects').insert(p).select().single();
  if (error) throw error;
  return data;
}

/**
 * Creates a new project from a template, pre-populating commands, ports, env keys,
 * URLs, deployments, and docker configs from the template definition.
 */
export async function createProjectFromTemplate(
  template: ProjectTemplate,
  p: { name: string; slug: string; repo_path?: string },
): Promise<Project> {
  // 1. Create the project itself
  const project = await createProject({
    name: p.name,
    slug: p.slug,
    repo_path: p.repo_path ?? '',
    package_manager: template.package_manager,
    hosting_platform: template.hosting_platform,
    tags: template.tags,
  });

  const pid = project.id;

  // 2. Insert all template entities in parallel where possible
  const inserts: Promise<unknown>[] = [];

  for (const cmd of template.commands) {
    inserts.push(upsertRow<CommandProfile>('command_profiles', { ...cmd, project_id: pid }));
  }
  for (const port of template.ports) {
    inserts.push(upsertRow<ProjectPort>('project_ports', { ...port, project_id: pid }));
  }
  for (const env of template.env_keys) {
    inserts.push(upsertRow<EnvKey>('env_keys', { ...env, project_id: pid }));
  }
  for (const url of template.urls) {
    inserts.push(upsertRow<ProjectUrl>('project_urls', { ...url, project_id: pid }));
  }
  for (const dep of template.deployments) {
    inserts.push(upsertRow<DeploymentTarget>('deployment_targets', { ...dep, project_id: pid }));
  }
  for (const d of template.docker) {
    inserts.push(upsertRow<DockerComposeConfig>('docker_compose_configs', { ...d, project_id: pid }));
  }

  await Promise.all(inserts);

  // 3. Log the creation event
  await insertActivityLog({
    project_id: pid,
    event_type: 'project_created_from_template',
    category: 'lifecycle',
    title: 'Project created from template',
    detail: `Created from "${template.name}" template`,
    metadata: { template_id: template.id },
    source: 'cockpit',
  });

  return project;
}

export async function updateProject(id: string, p: Partial<Project>): Promise<void> {
  const { error } = await supabase.from('projects').update({ ...p, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
}

// ── Project Pinning ──────────────────────────────────────────────────────────

/**
 * Toggles the pinned state for a project.
 * When pinning, assigns the next pin_order so it appears at the end of pinned projects.
 * When unpinning, resets pin_order to 0.
 */
export async function toggleProjectPin(projectId: string, pinned: boolean): Promise<void> {
  let pin_order = 0;
  if (pinned) {
    // Get the max pin_order among currently pinned projects
    const { data } = await supabase
      .from('projects')
      .select('pin_order')
      .eq('pinned', true)
      .order('pin_order', { ascending: false })
      .limit(1);
    pin_order = (data && data.length > 0 ? data[0].pin_order : 0) + 1;
  }
  const { error } = await supabase
    .from('projects')
    .update({ pinned, pin_order, updated_at: new Date().toISOString() })
    .eq('id', projectId);
  if (error) throw error;
}

/**
 * Reorders pinned projects by setting pin_order for each project.
 * Accepts an array of project IDs in the desired order.
 */
export async function reorderPinnedProjects(orderedIds: string[]): Promise<void> {
  await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from('projects').update({ pin_order: index }).eq('id', id)
    )
  );
}

async function listBy<T>(table: string, project_id: string): Promise<T[]> {
  const { data, error } = await supabase.from(table).select('*').eq('project_id', project_id);
  if (error) throw error;
  return (data || []) as T[];
}

export const listCommands = (pid: string) => listBy<CommandProfile>('command_profiles', pid);
export const listPorts = (pid: string) => listBy<ProjectPort>('project_ports', pid);
export const listUrls = (pid: string) => listBy<ProjectUrl>('project_urls', pid);
export const listDeployments = (pid: string) => listBy<DeploymentTarget>('deployment_targets', pid);
export const listEnvKeys = (pid: string) => listBy<EnvKey>('env_keys', pid);
export const listInfisical = (pid: string) => listBy<InfisicalRef>('infisical_refs', pid);
export const listDocker = (pid: string) => listBy<DockerComposeConfig>('docker_compose_configs', pid);
export const listLaunchGroups = (pid: string) => listBy<LaunchGroup>('launch_groups', pid);
export async function listLaunchGroupSteps(projectId: string): Promise<LaunchGroupStep[]> {
  // Steps don't have project_id directly — join through launch_groups
  const { data, error } = await supabase
    .from('launch_group_steps')
    .select('*, launch_groups!inner(project_id)')
    .eq('launch_groups.project_id', projectId)
    .order('sort_order');
  if (error) throw error;
  return (data || []).map((row: any) => {
    const { launch_groups: _, ...step } = row;
    return step as LaunchGroupStep;
  });
}
export const listSshConfigs = (pid: string) => listBy<SshConfig>('project_ssh_configs', pid);
export const listDangerZoneCommands = (pid: string) => listBy<DangerZoneCommand>('danger_zone_commands', pid);

// ── Danger Zone Executions ──────────────────────────────────────────────────

export async function listDangerZoneExecutions(pid: string): Promise<DangerZoneExecution[]> {
  const { data, error } = await supabase
    .from('danger_zone_executions')
    .select('*')
    .eq('project_id', pid)
    .order('executed_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data || []) as DangerZoneExecution[];
}

export async function insertDangerZoneExecution(entry: Partial<DangerZoneExecution>): Promise<DangerZoneExecution> {
  const { data, error } = await supabase.from('danger_zone_executions').insert(entry).select().single();
  if (error) throw error;
  return data as DangerZoneExecution;
}

export async function listDeploymentHistory(pid: string): Promise<DeploymentHistoryEntry[]> {
  const { data, error } = await supabase
    .from('deployment_history')
    .select('*')
    .eq('project_id', pid)
    .order('started_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data || []) as DeploymentHistoryEntry[];
}

export async function insertDeploymentHistory(entry: Partial<DeploymentHistoryEntry>): Promise<DeploymentHistoryEntry> {
  const { data, error } = await supabase.from('deployment_history').insert(entry).select().single();
  if (error) throw error;
  return data as DeploymentHistoryEntry;
}

export async function updateDeploymentHistory(id: string, updates: Partial<DeploymentHistoryEntry>): Promise<void> {
  const { error } = await supabase.from('deployment_history').update(updates).eq('id', id);
  if (error) throw error;
}

// ── Activity Log ─────────────────────────────────────────────────────────────

export async function listActivityLog(pid: string, limit = 200): Promise<ActivityLogEntry[]> {
  const { data, error } = await supabase
    .from('project_activity_log')
    .select('*')
    .eq('project_id', pid)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as ActivityLogEntry[];
}

export async function listActivityLogPaged(
  pid: string,
  offset: number,
  limit: number
): Promise<{ data: ActivityLogEntry[]; hasMore: boolean }> {
  // Fetch one extra row to determine if more data exists
  const { data, error } = await supabase
    .from('project_activity_log')
    .select('*')
    .eq('project_id', pid)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit);
  if (error) throw error;
  const rows = (data || []) as ActivityLogEntry[];
  const hasMore = rows.length > limit;
  return { data: hasMore ? rows.slice(0, limit) : rows, hasMore };
}

export async function insertActivityLog(entry: Partial<ActivityLogEntry>): Promise<ActivityLogEntry> {
  const { data, error } = await supabase.from('project_activity_log').insert(entry).select().single();
  if (error) throw error;
  return data as ActivityLogEntry;
}

export async function deleteActivityLogEntry(id: string): Promise<void> {
  const { error } = await supabase.from('project_activity_log').delete().eq('id', id);
  if (error) throw error;
}

export async function clearActivityLog(projectId: string): Promise<void> {
  const { error } = await supabase.from('project_activity_log').delete().eq('project_id', projectId);
  if (error) throw error;
}

// ── Command Run History ──────────────────────────────────────────────────────

export async function listCommandRunHistory(pid: string, limit = 200): Promise<CommandRunHistory[]> {
  const { data, error } = await supabase
    .from('command_run_history')
    .select('*')
    .eq('project_id', pid)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as CommandRunHistory[];
}

export async function listCommandRunsForCommand(commandId: string, limit = 10): Promise<CommandRunHistory[]> {
  const { data, error } = await supabase
    .from('command_run_history')
    .select('*')
    .eq('command_id', commandId)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as CommandRunHistory[];
}

export async function insertCommandRun(entry: Partial<CommandRunHistory>): Promise<CommandRunHistory> {
  const { data, error } = await supabase.from('command_run_history').insert(entry).select().single();
  if (error) throw error;
  return data as CommandRunHistory;
}

export async function updateCommandRun(id: string, updates: Partial<CommandRunHistory>): Promise<void> {
  const { error } = await supabase.from('command_run_history').update(updates).eq('id', id);
  if (error) throw error;
}

export async function clearCommandRunHistory(projectId: string): Promise<void> {
  const { error } = await supabase.from('command_run_history').delete().eq('project_id', projectId);
  if (error) throw error;
}

export async function listNotes(pid: string): Promise<ProjectNote[]> {
  const { data, error } = await supabase
    .from('project_notes')
    .select('*')
    .eq('project_id', pid)
    .order('pinned', { ascending: false })
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []) as ProjectNote[];
}

export async function searchNotes(query: string): Promise<(ProjectNote & { project_slug?: string })[]> {
  const { data, error } = await supabase
    .from('project_notes')
    .select('*, projects!inner(slug)')
    .or(`title.ilike.%${query}%,content.ilike.%${query}%,tags.ilike.%${query}%`);
  if (error) throw error;
  return (data || []).map((row: any) => ({
    ...row,
    project_slug: row.projects?.slug,
    projects: undefined,
  }));
}

export async function getOverrides(pid: string): Promise<AgentContextOverride | null> {
  const { data, error } = await supabase.from('agent_context_overrides').select('*').eq('project_id', pid).maybeSingle();
  if (error) throw error;
  return data;
}

// ── Runbooks ─────────────────────────────────────────────────────────────────

export async function listRunbooks(pid: string): Promise<Runbook[]> {
  const { data, error } = await supabase
    .from('runbooks')
    .select('*')
    .eq('project_id', pid)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as Runbook[];
}

export async function listRunbookSteps(runbookId: string): Promise<RunbookStep[]> {
  const { data, error } = await supabase
    .from('runbook_steps')
    .select('*')
    .eq('runbook_id', runbookId)
    .order('sort_order');
  if (error) throw error;
  return (data || []) as RunbookStep[];
}

export async function listAllRunbookSteps(pid: string): Promise<RunbookStep[]> {
  const runbooks = await listRunbooks(pid);
  if (runbooks.length === 0) return [];
  const ids = runbooks.map(r => r.id);
  const { data, error } = await supabase
    .from('runbook_steps')
    .select('*')
    .in('runbook_id', ids)
    .order('sort_order');
  if (error) throw error;
  return (data || []) as RunbookStep[];
}

export async function upsertRow<T>(table: string, row: Partial<T> & { id?: string }): Promise<T> {
  if (row.id) {
    const { id, ...rest } = row as any;
    const { data, error } = await supabase.from(table).update(rest).eq('id', id).select().single();
    if (error) throw error;
    return data as T;
  }
  const { data, error } = await supabase.from(table).insert(row).select().single();
  if (error) throw error;
  return data as T;
}

export async function deleteRow(table: string, id: string): Promise<void> {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
}

export async function getProjectScope(slug: string): Promise<ProjectScope | null> {
  const project = await getProjectBySlug(slug);
  if (!project) return null;
  const [commands, ports, urls, deployments, env_keys, infisical_refs, docker, launch_groups, launch_group_steps, overrides, ssh_configs, machine_overrides, notes, runbooks, runbook_steps, danger_zone_commands, danger_zone_executions, deployment_history, activity_log, command_run_history] =
    await Promise.all([
      listCommands(project.id),
      listPorts(project.id),
      listUrls(project.id),
      listDeployments(project.id),
      listEnvKeys(project.id),
      listInfisical(project.id),
      listDocker(project.id),
      listLaunchGroups(project.id),
      listLaunchGroupSteps(project.id),
      getOverrides(project.id),
      listSshConfigs(project.id),
      listMachineOverrides(project.id),
      listNotes(project.id),
      listRunbooks(project.id),
      listAllRunbookSteps(project.id),
      listDangerZoneCommands(project.id),
      listDangerZoneExecutions(project.id),
      listDeploymentHistory(project.id),
      listActivityLog(project.id),
      listCommandRunHistory(project.id),
    ]);
  const scope = { project, commands, ports, urls, deployments, env_keys, infisical_refs, docker, launch_groups, launch_group_steps, overrides, ssh_configs, machine_overrides, notes, runbooks, runbook_steps, danger_zone_commands, danger_zone_executions, deployment_history, activity_log, command_run_history, webhook_configs: [] as import('./types').WebhookConfig[] };
  // Write-through to cache
  cacheScope(slug, scope).catch(() => {});
  return scope;
}

/**
 * Cache-aware version: tries Supabase first, falls back to IndexedDB.
 */
export async function getProjectScopeCached(slug: string): Promise<CachedResult<ProjectScope | null>> {
  try {
    const scope = await getProjectScope(slug);
    return { data: scope, fromCache: false, cachedAt: null };
  } catch {
    const cached = await getCachedScope(slug);
    if (cached) return { data: cached.data, fromCache: true, cachedAt: cached.cachedAt };
    return { data: null, fromCache: false, cachedAt: null, error: true };
  }
}

const SECRET_PATTERNS = [
  /\b(sk|pk|rk)_[A-Za-z0-9_-]{16,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]+/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /postgres(?:ql)?:\/\/[^:]+:[^@]+@/gi,
];

export function maskSecrets(text: string): string {
  let out = text;
  for (const p of SECRET_PATTERNS) out = out.replace(p, '[masked]');
  return out;
}

// ── Agent Context Snapshots ──────────────────────────────────────────────────

export async function saveSnapshot(
  projectId: string,
  contextJson: Record<string, unknown>,
  trigger: string = 'manual',
  label: string = '',
): Promise<AgentContextSnapshot> {
  const { data, error } = await supabase
    .from('agent_context_snapshots')
    .insert({ project_id: projectId, context_json: contextJson, trigger, label })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listSnapshots(projectId: string): Promise<AgentContextSnapshot[]> {
  const { data, error } = await supabase
    .from('agent_context_snapshots')
    .select('id, project_id, label, trigger, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data || []) as AgentContextSnapshot[];
}

export async function getSnapshot(id: string): Promise<AgentContextSnapshot | null> {
  const { data, error } = await supabase
    .from('agent_context_snapshots')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function deleteSnapshot(id: string): Promise<void> {
  const { error } = await supabase.from('agent_context_snapshots').delete().eq('id', id);
  if (error) throw error;
}

export type DiffEntry = {
  path: string;
  type: 'added' | 'removed' | 'changed';
  oldValue?: unknown;
  newValue?: unknown;
};

export function diffContexts(
  older: Record<string, unknown>,
  newer: Record<string, unknown>,
  prefix = '',
): DiffEntry[] {
  const diffs: DiffEntry[] = [];
  const allKeys = new Set([...Object.keys(older), ...Object.keys(newer)]);

  for (const key of allKeys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const a = older[key];
    const b = newer[key];

    if (!(key in older)) {
      diffs.push({ path, type: 'added', newValue: b });
    } else if (!(key in newer)) {
      diffs.push({ path, type: 'removed', oldValue: a });
    } else if (
      typeof a === 'object' && a !== null && !Array.isArray(a) &&
      typeof b === 'object' && b !== null && !Array.isArray(b)
    ) {
      diffs.push(...diffContexts(a as Record<string, unknown>, b as Record<string, unknown>, path));
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      diffs.push({ path, type: 'changed', oldValue: a, newValue: b });
    }
  }
  return diffs;
}

// ── Context Share Links ──────────────────────────────────────────────────────

export async function createShareLink(
  projectId: string,
  contextJson: Record<string, unknown>,
  options: {
    label?: string;
    expiresInHours?: number;
    maxAccessCount?: number;
  } = {},
): Promise<ContextShareLink> {
  const row: Record<string, unknown> = {
    project_id: projectId,
    context_json: contextJson,
    label: options.label || '',
  };
  if (options.expiresInHours) {
    row.expires_at = new Date(Date.now() + options.expiresInHours * 3600_000).toISOString();
  }
  if (options.maxAccessCount) {
    row.max_access_count = options.maxAccessCount;
  }
  const { data, error } = await supabase
    .from('context_share_links')
    .insert(row)
    .select('id, project_id, token, label, expires_at, max_access_count, access_count, last_accessed_at, context_json, created_at')
    .single();
  if (error) throw error;
  return data as ContextShareLink;
}

export async function listShareLinks(projectId: string): Promise<ContextShareLink[]> {
  const { data, error } = await supabase
    .from('context_share_links')
    .select('id, project_id, token, label, expires_at, max_access_count, access_count, last_accessed_at, context_json, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as ContextShareLink[];
}

export async function deleteShareLink(id: string): Promise<void> {
  const { error } = await supabase.from('context_share_links').delete().eq('id', id);
  if (error) throw error;
}

export async function getShareLinkByToken(token: string): Promise<ContextShareLink | null> {
  const { data, error } = await supabase
    .from('context_share_links')
    .select('id, project_id, token, label, expires_at, max_access_count, access_count, last_accessed_at, context_json, created_at')
    .eq('token', token)
    .maybeSingle();
  if (error) throw error;
  return data as ContextShareLink | null;
}

export function isShareLinkExpired(link: ContextShareLink): boolean {
  if (!link.expires_at) return false;
  return new Date(link.expires_at) < new Date();
}

export function isShareLinkExhausted(link: ContextShareLink): boolean {
  if (link.max_access_count == null) return false;
  return link.access_count >= link.max_access_count;
}

// ── Machines ─────────────────────────────────────────────────────────────────

export async function listMachines(): Promise<Machine[]> {
  const { data, error } = await supabase.from('machines').select('*').order('label');
  if (error) throw error;
  return data || [];
}

export async function upsertMachine(machine: Partial<Machine> & { id?: string }): Promise<Machine> {
  return upsertRow<Machine>('machines', machine);
}

export async function deleteMachine(id: string): Promise<void> {
  await deleteRow('machines', id);
}

export async function registerMachine(hostname: string, os: string, arch: string): Promise<Machine> {
  // Try to find existing machine by hostname
  const { data: existing } = await supabase
    .from('machines')
    .select('*')
    .eq('hostname', hostname)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from('machines')
      .update({ os, arch, last_seen_at: new Date().toISOString(), is_current: true, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    // Clear is_current on other machines
    await supabase.from('machines').update({ is_current: false }).neq('id', existing.id);
    return data;
  }

  // Create new machine
  const { data, error } = await supabase
    .from('machines')
    .insert({ hostname, label: hostname, os, arch, is_current: true })
    .select()
    .single();
  if (error) throw error;
  // Clear is_current on other machines
  await supabase.from('machines').update({ is_current: false }).neq('id', data.id);
  return data;
}

// ── Machine Overrides ────────────────────────────────────────────────────────

export const listMachineOverrides = (pid: string) => listBy<MachineOverride>('machine_overrides', pid);

export async function upsertMachineOverride(override: Partial<MachineOverride> & { id?: string }): Promise<MachineOverride> {
  return upsertRow<MachineOverride>('machine_overrides', override);
}

export async function deleteMachineOverride(id: string): Promise<void> {
  await deleteRow('machine_overrides', id);
}

// ── Effective Repo Path ─────────────────────────────────────────────────────

/**
 * Returns the repo path for the current machine, falling back to the project default.
 * Looks up the current machine's override from `scope.machine_overrides` and returns
 * its `repo_path` if set, otherwise returns `scope.project.repo_path`.
 */
export function getEffectiveRepoPath(scope: ProjectScope, currentMachine: Machine | null | undefined): string {
  if (!currentMachine) return scope.project.repo_path;
  const override = scope.machine_overrides.find(o => o.machine_id === currentMachine.id);
  return (override?.repo_path || scope.project.repo_path);
}

/**
 * Fetches the machine marked `is_current=true` for the authenticated user.
 * Returns null if no machine is registered as current.
 */
export async function getCurrentMachine(): Promise<Machine | null> {
  const { data, error } = await supabase
    .from('machines')
    .select('*')
    .eq('is_current', true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Fetches all machine overrides for a specific machine, keyed by project_id.
 * Used by the Dashboard to resolve effective paths without loading full ProjectScope.
 */
export async function listOverridesForMachine(machineId: string): Promise<Record<string, MachineOverride>> {
  const { data, error } = await supabase
    .from('machine_overrides')
    .select('*')
    .eq('machine_id', machineId);
  if (error) throw error;
  const map: Record<string, MachineOverride> = {};
  for (const o of data || []) map[o.project_id] = o;
  return map;
}

// ── Dashboard Metrics ────────────────────────────────────────────────────────

export type DashboardMetrics = {
  /** Set of project IDs that have at least one configured port */
  projectsWithPorts: Set<string>;
  /** Set of project IDs that have pending/in-progress deployments */
  projectsWithPendingDeploys: Set<string>;
};

/**
 * Fetches cross-project aggregate data for the dashboard summary bar.
 * Runs queries in parallel for speed.
 */
export async function fetchDashboardMetrics(): Promise<DashboardMetrics> {
  const [ports, deploys] = await Promise.all([
    supabase.from('project_ports').select('project_id').then(r => r.data || []),
    supabase
      .from('deployment_history')
      .select('project_id')
      .in('status', ['pending', 'in_progress', 'deploying'])
      .then(r => r.data || []),
  ]);

  const projectsWithPorts = new Set(ports.map((p: any) => p.project_id as string));
  const projectsWithPendingDeploys = new Set(deploys.map((d: any) => d.project_id as string));

  return { projectsWithPorts, projectsWithPendingDeploys };
}

// ── Agent Context Builder ───────────────────────────────────────────────────

// ── GitHub OAuth ─────────────────────────────────────────────────────────────

export async function getGitHubToken(): Promise<GitHubToken | null> {
  const { data, error } = await supabase
    .from('github_tokens')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertGitHubToken(
  accessToken: string,
  username: string = '',
  avatarUrl: string = '',
  scopes: string = '',
): Promise<GitHubToken> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Try update first, then insert (upsert on owner_id unique constraint)
  const { data: existing } = await supabase
    .from('github_tokens')
    .select('id')
    .eq('owner_id', user.id)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from('github_tokens')
      .update({
        access_token: accessToken,
        github_username: username,
        github_avatar_url: avatarUrl,
        scopes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('github_tokens')
    .insert({
      access_token: accessToken,
      github_username: username,
      github_avatar_url: avatarUrl,
      scopes,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteGitHubToken(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { error } = await supabase
    .from('github_tokens')
    .delete()
    .eq('owner_id', user.id);
  if (error) throw error;
}

export async function signInWithGitHub(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      scopes: 'read:user repo',
      redirectTo: window.location.origin,
    },
  });
  if (error) throw error;
}

// ── Agent Context Builder ───────────────────────────────────────────────────

export function buildAgentContext(scope: ProjectScope, currentMachine?: Machine | null): Record<string, unknown> {
  const p = scope.project;
  const o = scope.overrides;
  const effectiveRepoPath = getEffectiveRepoPath(scope, currentMachine);
  return {
    project: {
      name: p.name,
      slug: p.slug,
      description: p.description,
      repo_path: effectiveRepoPath,
      repo_url: p.repo_url,
      package_manager: p.package_manager,
      default_branch: p.default_branch,
      monorepo_paths: p.monorepo_paths.split('\n').map(s => s.trim()).filter(Boolean),
      tags: p.tags.split(',').map(s => s.trim()).filter(Boolean),
      status: p.status,
      hosting_platform: p.hosting_platform,
    },
    start_commands: scope.commands.filter(c => ['dev', 'start', 'build'].includes(c.kind)).map(c => ({
      name: c.name, kind: c.kind, command: c.command, working_dir: c.working_dir,
      expected_port: c.expected_port, must_confirm: c.must_confirm,
    })),
    recommended_commands: scope.commands.map(c => ({ name: c.name, kind: c.kind, command: c.command })),
    ports: scope.ports.map(pt => ({
      label: pt.label, port: pt.port, protocol: pt.protocol,
      local_url: pt.local_url, health_url: pt.health_url,
    })),
    urls: scope.urls.map(u => ({ label: u.label, url: u.url, category: u.category, environment: u.environment })),
    deployments: scope.deployments.map(d => ({
      platform: d.platform, project_name: d.platform_project_name, environment: d.environment,
      production_url: d.production_url, preview_url_pattern: d.preview_url_pattern,
      dashboard_url: d.dashboard_url, region: d.region, branch: d.branch,
      domains: d.domains.split(',').map(s => s.trim()).filter(Boolean),
    })),
    env_keys_required: scope.env_keys.map(e => ({
      key: e.key_name, purpose: e.purpose, classification: e.classification,
      source: e.source_type, env_scope: e.env_scope, infisical_path: e.infisical_path,
      required: e.required,
    })),
    infisical_refs: scope.infisical_refs.map(i => ({
      project_id: i.infisical_project_id, workspace: i.workspace_name,
      environment: i.environment, secret_path: i.secret_path,
      run_command_pattern: i.run_command_pattern,
    })),
    docker_compose: scope.docker.map(d => ({
      compose_file: d.compose_file_path, project_name: d.compose_project_name,
      services: d.services.split(',').map(s => s.trim()).filter(Boolean),
    })),
    notes: p.notes,
    danger_notes: p.danger_notes,
    project_notes: (scope.notes || []).map(n => ({
      title: n.title,
      content: n.content,
      category: n.category,
      tags: n.tags.split(',').map(s => s.trim()).filter(Boolean),
      pinned: n.pinned,
    })),
    database_notes: o?.database_notes || '',
    migration_notes: o?.migration_notes || '',
    danger_zones: (o?.danger_zones || '').split('\n').map(s => s.trim()).filter(Boolean),
    gotchas: (o?.gotchas || '').split('\n').map(s => s.trim()).filter(Boolean),
    must_confirm_commands: (o?.must_confirm_commands || '').split('\n').map(s => s.trim()).filter(Boolean),
    danger_zone_commands: (scope.danger_zone_commands || []).map(d => ({
      command: d.command,
      label: d.label,
      risk_level: d.risk_level,
      description: d.description,
      requires_confirmation: d.requires_confirmation,
      environment: d.environment || undefined,
    })),
    safety: {
      raw_secrets_included: false,
      secret_references_only: true,
      bind_host: '127.0.0.1',
    },
  };
}

// ── Project Archiving ────────────────────────────────────────────────────────

/**
 * Archives a project: sets status to 'archived', stores a snapshot of the
 * current project scope, and records the archive timestamp.
 */
export async function archiveProject(projectId: string, slug: string): Promise<void> {
  // Build a snapshot of the full project scope for export
  const scope = await getProjectScope(slug);
  const snapshot = scope ? buildAgentContext(scope) : {};

  const { error } = await supabase
    .from('projects')
    .update({
      status: 'archived',
      archived_at: new Date().toISOString(),
      archive_snapshot: snapshot,
      updated_at: new Date().toISOString(),
    })
    .eq('id', projectId);
  if (error) throw error;
}

/**
 * Restores an archived project back to active status.
 * Clears the archived_at timestamp but preserves the snapshot for reference.
 */
export async function restoreProject(projectId: string): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({
      status: 'active',
      archived_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', projectId);
  if (error) throw error;
}

/**
 * Permanently deletes an archived project and all its related data.
 * Only works on projects that have been archived first (safety gate).
 */
export async function permanentlyDeleteProject(projectId: string): Promise<void> {
  // Verify project is archived before allowing permanent deletion
  const { data: project, error: fetchError } = await supabase
    .from('projects')
    .select('status')
    .eq('id', projectId)
    .single();
  if (fetchError) throw fetchError;
  if (project.status !== 'archived') throw new Error('Only archived projects can be permanently deleted');

  await deleteProject(projectId);
}

/**
 * Exports the archive snapshot as a downloadable JSON blob.
 */
export function downloadArchiveSnapshot(project: { name: string; slug: string; archive_snapshot: Record<string, unknown> | null }): void {
  const data = project.archive_snapshot || {};
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.slug}-archive-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Bulk Operations ─────────────────────────────────────────────────────────

/**
 * Archive multiple projects at once.
 * Skips any projects that are already archived.
 */
export async function bulkArchiveProjects(projectIds: string[], projects: Project[]): Promise<void> {
  const toArchive = projects.filter(p => projectIds.includes(p.id) && p.status !== 'archived');
  await Promise.all(toArchive.map(p => archiveProject(p.id, p.slug)));
}

/**
 * Delete multiple archived projects permanently.
 * Only works on projects that are already archived (safety gate enforced by permanentlyDeleteProject).
 */
export async function bulkDeleteProjects(projectIds: string[]): Promise<void> {
  await Promise.all(projectIds.map(id => permanentlyDeleteProject(id)));
}

/**
 * Add tags to multiple projects (appends, deduplicates).
 */
export async function bulkAddTags(projectIds: string[], newTags: string[], projects: Project[]): Promise<void> {
  await Promise.all(
    projects
      .filter(p => projectIds.includes(p.id))
      .map(p => {
        const existing = p.tags ? p.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
        const merged = [...new Set([...existing, ...newTags])];
        return updateProject(p.id, { tags: merged.join(', ') });
      })
  );
}

/**
 * Rename a tag across all projects that use it.
 */
export async function renameTag(oldName: string, newName: string, projects: Project[]): Promise<void> {
  await Promise.all(
    projects
      .filter(p => {
        const tags = p.tags ? p.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
        return tags.includes(oldName);
      })
      .map(p => {
        const tags = p.tags.split(',').map(t => t.trim()).filter(Boolean);
        const updated = tags.map(t => t === oldName ? newName : t);
        return updateProject(p.id, { tags: updated.join(', ') });
      })
  );
}

/**
 * Delete a tag from all projects that use it.
 */
export async function deleteTag(tagName: string, projects: Project[]): Promise<void> {
  await Promise.all(
    projects
      .filter(p => {
        const tags = p.tags ? p.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
        return tags.includes(tagName);
      })
      .map(p => {
        const tags = p.tags.split(',').map(t => t.trim()).filter(Boolean);
        const updated = tags.filter(t => t !== tagName);
        return updateProject(p.id, { tags: updated.join(', ') });
      })
  );
}

/**
 * Replace a tag with multiple new tags across all projects.
 */
export async function replaceTag(oldTag: string, newTags: string[], projects: Project[]): Promise<void> {
  await Promise.all(
    projects
      .filter(p => {
        const tags = p.tags ? p.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
        return tags.includes(oldTag);
      })
      .map(p => {
        const tags = p.tags.split(',').map(t => t.trim()).filter(Boolean);
        const updated = [...tags.filter(t => t !== oldTag), ...newTags];
        const deduped = [...new Set(updated)];
        return updateProject(p.id, { tags: deduped.join(', ') });
      })
  );
}

/**
 * Get aggregated tag data: unique tag names with project counts.
 */
export function getTagAggregates(projects: Project[]): Map<string, { count: number; projects: Project[] }> {
  const map = new Map<string, { count: number; projects: Project[] }>();
  for (const p of projects) {
    const tags = p.tags ? p.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    for (const tag of tags) {
      const existing = map.get(tag);
      if (existing) {
        existing.count++;
        existing.projects.push(p);
      } else {
        map.set(tag, { count: 1, projects: [p] });
      }
    }
  }
  return map;
}

// ── Tag Color Storage (localStorage) ────────────────────────────────────────

const TAG_COLORS_KEY = 'cockpit:tag-colors';

export function getTagColors(): Record<string, string> {
  try {
    const raw = localStorage.getItem(TAG_COLORS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveTagColors(colors: Record<string, string>): void {
  try {
    localStorage.setItem(TAG_COLORS_KEY, JSON.stringify(colors));
  } catch { /* noop */ }
}

export function setTagColor(tagName: string, color: string): void {
  const colors = getTagColors();
  colors[tagName] = color;
  saveTagColors(colors);
}

/**
 * Export multiple projects as a single JSON download.
 */
export function bulkExportProjects(projects: Project[]): void {
  const data = projects.map(p => ({
    name: p.name,
    slug: p.slug,
    description: p.description,
    repo_path: p.repo_path,
    repo_url: p.repo_url,
    package_manager: p.package_manager,
    default_branch: p.default_branch,
    tags: p.tags,
    status: p.status,
    hosting_platform: p.hosting_platform,
    archive_snapshot: p.archive_snapshot,
  }));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cockpit-export-${projects.length}-projects-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Project Cloning ─────────────────────────────────────────────────────────

export type CloneOptions = {
  /** New project name */
  name: string;
  /** New project slug (must be unique) */
  slug: string;
  /** New repo path (optional, defaults to empty) */
  repoPath?: string;
  /** Which entity groups to clone (defaults to all) */
  include?: {
    commands?: boolean;
    ports?: boolean;
    urls?: boolean;
    deployments?: boolean;
    env_keys?: boolean;
    infisical_refs?: boolean;
    docker?: boolean;
    launch_groups?: boolean;
    notes?: boolean;
    ssh_configs?: boolean;
    danger_zone_commands?: boolean;
    agent_context_overrides?: boolean;
  };
};

/**
 * Clones an existing project's configuration into a new project.
 * Copies all selected child entities with fresh IDs.
 * Does NOT clone history/audit data (activity log, command runs, deployment history, executions).
 */
export async function cloneProject(sourceSlug: string, options: CloneOptions): Promise<Project> {
  const scope = await getProjectScope(sourceSlug);
  if (!scope) throw new Error(`Source project "${sourceSlug}" not found`);

  const src = scope.project;
  const inc = options.include || {};
  // Default all groups to true if not specified
  const shouldClone = (key: keyof NonNullable<CloneOptions['include']>) =>
    inc[key] === undefined ? true : inc[key];

  // 1. Create the new project
  const newProject = await createProject({
    name: options.name,
    slug: options.slug,
    description: src.description,
    repo_path: options.repoPath ?? '',
    repo_url: src.repo_url,
    package_manager: src.package_manager,
    default_branch: src.default_branch,
    monorepo_paths: src.monorepo_paths,
    tags: src.tags,
    status: 'active',
    notes: src.notes,
    danger_notes: src.danger_notes,
    hosting_platform: src.hosting_platform,
  });

  const pid = newProject.id;

  // Track old-to-new ID mappings for launch group steps (which reference command_id and launch_group_id)
  const commandIdMap = new Map<string, string>();
  const launchGroupIdMap = new Map<string, string>();

  // 2. Clone commands
  if (shouldClone('commands') && scope.commands.length > 0) {
    for (const cmd of scope.commands) {
      const { id: oldId, project_id: _, ...rest } = cmd;
      const created = await upsertRow<CommandProfile>('command_profiles', { ...rest, project_id: pid });
      commandIdMap.set(oldId, created.id);
    }
  }

  // 3. Clone ports
  if (shouldClone('ports') && scope.ports.length > 0) {
    for (const port of scope.ports) {
      const { id: _, project_id: _pid, ...rest } = port;
      await upsertRow<ProjectPort>('project_ports', { ...rest, project_id: pid });
    }
  }

  // 4. Clone URLs
  if (shouldClone('urls') && scope.urls.length > 0) {
    for (const url of scope.urls) {
      const { id: _, project_id: _pid, ...rest } = url;
      await upsertRow<ProjectUrl>('project_urls', { ...rest, project_id: pid });
    }
  }

  // 5. Clone deployments
  if (shouldClone('deployments') && scope.deployments.length > 0) {
    for (const dep of scope.deployments) {
      const { id: _, project_id: _pid, ...rest } = dep;
      await upsertRow<DeploymentTarget>('deployment_targets', { ...rest, project_id: pid });
    }
  }

  // 6. Clone env keys
  if (shouldClone('env_keys') && scope.env_keys.length > 0) {
    for (const env of scope.env_keys) {
      const { id: _, project_id: _pid, ...rest } = env;
      await upsertRow<EnvKey>('env_keys', { ...rest, project_id: pid });
    }
  }

  // 7. Clone Infisical refs
  if (shouldClone('infisical_refs') && scope.infisical_refs.length > 0) {
    for (const inf of scope.infisical_refs) {
      const { id: _, project_id: _pid, ...rest } = inf;
      await upsertRow<InfisicalRef>('infisical_refs', { ...rest, project_id: pid });
    }
  }

  // 8. Clone Docker configs
  if (shouldClone('docker') && scope.docker.length > 0) {
    for (const d of scope.docker) {
      const { id: _, project_id: _pid, ...rest } = d;
      await upsertRow<DockerComposeConfig>('docker_compose_configs', { ...rest, project_id: pid });
    }
  }

  // 9. Clone launch groups + steps
  if (shouldClone('launch_groups') && scope.launch_groups.length > 0) {
    for (const lg of scope.launch_groups) {
      const { id: oldId, project_id: _pid, ...rest } = lg;
      const created = await upsertRow<LaunchGroup>('launch_groups', { ...rest, project_id: pid });
      launchGroupIdMap.set(oldId, created.id);
    }
    // Clone steps with remapped launch_group_id and command_id
    for (const step of scope.launch_group_steps) {
      const { id: _, launch_group_id, command_id, ...rest } = step;
      const newLgId = launchGroupIdMap.get(launch_group_id) || launch_group_id;
      const newCmdId = command_id ? (commandIdMap.get(command_id) || command_id) : null;
      await upsertRow<LaunchGroupStep>('launch_group_steps', {
        ...rest,
        launch_group_id: newLgId,
        command_id: newCmdId,
      });
    }
  }

  // 10. Clone notes
  if (shouldClone('notes') && scope.notes.length > 0) {
    for (const note of scope.notes) {
      const { id: _, project_id: _pid, created_at: _ca, updated_at: _ua, ...rest } = note;
      await upsertRow<ProjectNote>('project_notes', { ...rest, project_id: pid });
    }
  }

  // 11. Clone SSH configs
  if (shouldClone('ssh_configs') && scope.ssh_configs.length > 0) {
    for (const ssh of scope.ssh_configs) {
      const { id: _, project_id: _pid, owner_id: _oid, created_at: _ca, updated_at: _ua, ...rest } = ssh;
      await upsertRow<SshConfig>('project_ssh_configs', { ...rest, project_id: pid });
    }
  }

  // 12. Clone danger zone commands
  if (shouldClone('danger_zone_commands') && scope.danger_zone_commands.length > 0) {
    for (const dz of scope.danger_zone_commands) {
      const { id: _, project_id: _pid, created_at: _ca, ...rest } = dz;
      await upsertRow<DangerZoneCommand>('danger_zone_commands', { ...rest, project_id: pid });
    }
  }

  // 13. Clone agent context overrides
  if (shouldClone('agent_context_overrides') && scope.overrides) {
    const { id: _, project_id: _pid, ...rest } = scope.overrides;
    await upsertRow<AgentContextOverride>('agent_context_overrides', { ...rest, project_id: pid });
  }

  // 14. Log the clone event on the new project
  await insertActivityLog({
    project_id: pid,
    event_type: 'project_cloned',
    category: 'lifecycle',
    title: 'Project cloned',
    detail: `Cloned from "${src.name}" (${sourceSlug})`,
    metadata: { source_project_id: src.id, source_slug: sourceSlug },
    source: 'cockpit',
  });

  return newProject;
}

// ── Port Conflict Detection ─────────────────────────────────────────────────

/** Fetches all port entries across all projects in a single query. */
export async function listAllPorts(): Promise<(ProjectPort & { project_name: string; project_slug: string })[]> {
  const { data, error } = await supabase
    .from('project_ports')
    .select('*, projects!inner(name, slug)');
  if (error) throw error;
  return (data || []).map((row: any) => {
    const { projects: proj, ...port } = row;
    return { ...port, project_name: proj.name, project_slug: proj.slug };
  });
}

/** Fetches all command profiles across all projects (for expected_port detection). */
export async function listAllCommands(): Promise<(CommandProfile & { project_name: string; project_slug: string })[]> {
  const { data, error } = await supabase
    .from('command_profiles')
    .select('*, projects!inner(name, slug)')
    .not('expected_port', 'is', null);
  if (error) throw error;
  return (data || []).map((row: any) => {
    const { projects: proj, ...cmd } = row;
    return { ...cmd, project_name: proj.name, project_slug: proj.slug };
  });
}

/**
 * Detects port conflicts across all registered projects.
 * A conflict exists when two or more different projects use the same port number
 * (via configured ports or command expected_port).
 */
export async function detectPortConflicts(): Promise<PortConflict[]> {
  const [ports, commands] = await Promise.all([listAllPorts(), listAllCommands()]);

  const portMap = new Map<number, Map<string, PortConflict['projects'][0]>>();

  for (const p of ports) {
    if (!p.port || p.port <= 0) continue;
    if (!portMap.has(p.port)) portMap.set(p.port, new Map());
    const projectMap = portMap.get(p.port)!;
    if (!projectMap.has(p.project_id)) {
      projectMap.set(p.project_id, {
        project_id: p.project_id,
        project_name: p.project_name,
        project_slug: p.project_slug,
        label: p.label,
        source: 'port',
        source_id: p.id,
      });
    }
  }

  for (const c of commands) {
    if (!c.expected_port || c.expected_port <= 0) continue;
    if (!portMap.has(c.expected_port)) portMap.set(c.expected_port, new Map());
    const projectMap = portMap.get(c.expected_port)!;
    if (!projectMap.has(c.project_id)) {
      projectMap.set(c.project_id, {
        project_id: c.project_id,
        project_name: c.project_name,
        project_slug: c.project_slug,
        label: c.name,
        source: 'command',
        source_id: c.id,
      });
    }
  }

  const conflicts: PortConflict[] = [];
  for (const [port, projectMap] of portMap) {
    if (projectMap.size >= 2) {
      conflicts.push({ port, projects: [...projectMap.values()] });
    }
  }

  return conflicts.sort((a, b) => a.port - b.port);
}

// ── Port Conflict Resolution ────────────────────────────────────────────────

/**
 * Keeps project_ports and command expected_port in sync within a project.
 * When either side references oldPort, update it to newPort (including URLs).
 */
export async function syncProjectPortReferences(
  projectId: string,
  oldPort: number,
  newPort: number,
): Promise<void> {
  if (oldPort === newPort || oldPort <= 0 || newPort <= 0) return;

  const { error: cmdErr } = await supabase
    .from('command_profiles')
    .update({ expected_port: newPort })
    .eq('project_id', projectId)
    .eq('expected_port', oldPort);
  if (cmdErr) throw cmdErr;

  const { data: ports, error: portErr } = await supabase
    .from('project_ports')
    .select('*')
    .eq('project_id', projectId)
    .eq('port', oldPort);
  if (portErr) throw portErr;

  for (const p of ports || []) {
    const updates: Partial<ProjectPort> = { port: newPort };
    if (p.local_url) {
      updates.local_url = p.local_url.replace(`:${oldPort}`, `:${newPort}`);
    }
    if (p.health_url) {
      updates.health_url = p.health_url.replace(`:${oldPort}`, `:${newPort}`);
    }
    const { error } = await supabase.from('project_ports').update(updates).eq('id', p.id);
    if (error) throw error;
  }
}

/**
 * Updates a project_port's port number (and optionally fixes local_url / health_url).
 * Also syncs matching command expected_port values in the same project.
 * Returns the updated row.
 */
export async function updatePortNumber(
  portId: string,
  oldPort: number,
  newPort: number,
): Promise<ProjectPort> {
  // Fetch current row
  const { data: current, error: fetchErr } = await supabase
    .from('project_ports')
    .select('*')
    .eq('id', portId)
    .single();
  if (fetchErr) throw fetchErr;

  const updates: Partial<ProjectPort> = { port: newPort };
  // Rewrite local_url and health_url if they reference the old port
  if (current.local_url) {
    updates.local_url = current.local_url.replace(`:${oldPort}`, `:${newPort}`);
  }
  if (current.health_url) {
    updates.health_url = current.health_url.replace(`:${oldPort}`, `:${newPort}`);
  }

  const { data, error } = await supabase
    .from('project_ports')
    .update(updates)
    .eq('id', portId)
    .select()
    .single();
  if (error) throw error;

  if (oldPort !== newPort && current.project_id) {
    await syncProjectPortReferences(current.project_id, oldPort, newPort);
  }

  return data as ProjectPort;
}

/**
 * Updates a command_profile's expected_port.
 * Also syncs matching project_ports in the same project.
 */
export async function updateCommandExpectedPort(
  commandId: string,
  newPort: number,
): Promise<void> {
  const { data: cmd, error: fetchErr } = await supabase
    .from('command_profiles')
    .select('project_id, expected_port')
    .eq('id', commandId)
    .single();
  if (fetchErr) throw fetchErr;

  const oldPort = cmd.expected_port;

  const { error } = await supabase
    .from('command_profiles')
    .update({ expected_port: newPort })
    .eq('id', commandId);
  if (error) throw error;

  if (oldPort && oldPort > 0 && oldPort !== newPort && cmd.project_id) {
    await syncProjectPortReferences(cmd.project_id, oldPort, newPort);
  }
}

/**
 * Regenerates agent context snapshots for a set of affected projects.
 * Call after port conflict resolution to keep agent contexts in sync.
 */
export async function regenerateAffectedContexts(
  projectSlugs: string[],
): Promise<void> {
  const unique = [...new Set(projectSlugs)];
  for (const slug of unique) {
    const scope = await getProjectScope(slug);
    if (!scope) continue;
    const ctx = buildAgentContext(scope);
    await saveSnapshot(scope.project.id, ctx, 'port_conflict_resolution', 'Auto-regenerated after port conflict resolution');
  }
}

// ── Dashboard Layouts ──────────────────────────────────────────────────────

export async function getDashboardLayout(): Promise<DashboardLayout | null> {
  const { data, error } = await supabase
    .from('dashboard_layouts')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data as DashboardLayout | null;
}

export async function saveDashboardLayout(sections: LayoutSection[]): Promise<DashboardLayout> {
  // Upsert: try update first, insert if no row exists
  const { data: existing } = await supabase
    .from('dashboard_layouts')
    .select('id')
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from('dashboard_layouts')
      .update({
        layout_config: sections as any,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data as DashboardLayout;
  }

  const { data, error } = await supabase
    .from('dashboard_layouts')
    .insert({
      layout_config: sections as any,
    })
    .select()
    .single();
  if (error) throw error;
  return data as DashboardLayout;
}

