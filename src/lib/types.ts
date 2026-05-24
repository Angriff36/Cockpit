export type Project = {
  id: string;
  slug: string;
  name: string;
  description: string;
  repo_path: string;
  repo_url: string;
  package_manager: string;
  default_branch: string;
  monorepo_paths: string;
  tags: string;
  status: string;
  notes: string;
  danger_notes: string;
  hosting_platform: string;
  pinned: boolean;
  pin_order: number;
  archived_at: string | null;
  archive_snapshot: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type CommandProfile = {
  id: string;
  project_id: string;
  name: string;
  kind: string;
  command: string;
  working_dir: string;
  expected_port: number | null;
  health_url: string;
  notes: string;
  must_confirm: boolean;
};

export type ProjectPort = {
  id: string;
  project_id: string;
  label: string;
  port: number;
  protocol: string;
  local_url: string;
  health_url: string;
  notes: string;
};

export type ProjectUrl = {
  id: string;
  project_id: string;
  label: string;
  url: string;
  category: string;
  environment: string;
  notes: string;
};

export type DeploymentTarget = {
  id: string;
  project_id: string;
  platform: string;
  platform_project_id: string;
  platform_project_name: string;
  team_or_org: string;
  environment: string;
  branch: string;
  region: string;
  deploy_command: string;
  build_command: string;
  production_url: string;
  preview_url_pattern: string;
  dashboard_url: string;
  logs_url: string;
  domains: string;
  env_source: string;
  notes: string;
};

export type EnvKey = {
  id: string;
  project_id: string;
  key_name: string;
  purpose: string;
  classification: string;
  source_type: string;
  infisical_path: string;
  env_scope: string;
  required: boolean;
  notes: string;
};

export type InfisicalRef = {
  id: string;
  project_id: string;
  infisical_project_id: string;
  workspace_name: string;
  environment: string;
  secret_path: string;
  run_command_pattern: string;
  notes: string;
};

export type DockerComposeConfig = {
  id: string;
  project_id: string;
  compose_file_path: string;
  compose_project_name: string;
  services: string;
  notes: string;
};

export type LaunchGroup = {
  id: string;
  project_id: string;
  name: string;
  description: string;
};

export type LaunchGroupStep = {
  id: string;
  launch_group_id: string;
  command_id: string | null;
  sort_order: number;
  delay_ms: number;
  wait_for_port: number | null;
  wait_for_health: string;
  label: string;
  notes: string;
  /** HTTP status codes that count as healthy when probing wait_for_health */
  acceptable_statuses: number[];
  /** Per-step timeout for port/health waits in ms; null = daemon default (120s) */
  timeout_ms: number | null;
  /** When true, a failed step does not abort the rest of the group */
  continue_on_failure: boolean;
};

export type ProjectNote = {
  id: string;
  project_id: string;
  title: string;
  content: string;
  category: string;
  tags: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
};

export type AgentContextOverride = {
  id: string;
  project_id: string;
  database_notes: string;
  migration_notes: string;
  danger_zones: string;
  gotchas: string;
  recommended_commands: string;
  must_confirm_commands: string;
};

export type SshConfig = {
  id: string;
  project_id: string;
  owner_id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  identity_file: string;
  remote_path: string;
  jump_host: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type DangerZoneCommand = {
  id: string;
  project_id: string;
  command: string;
  label: string;
  risk_level: string;
  description: string;
  requires_confirmation: boolean;
  environment: string;
  created_at: string;
};

export type DangerZoneExecution = {
  id: string;
  project_id: string;
  danger_zone_command_id: string | null;
  command_label: string;
  command_text: string;
  risk_level: string;
  environment: string;
  outcome: string;
  notes: string;
  executed_at: string;
  created_at: string;
};

export type Runbook = {
  id: string;
  project_id: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
};

export type RunbookStep = {
  id: string;
  runbook_id: string;
  sort_order: number;
  instruction: string;
  is_danger: boolean;
  danger_warning: string;
  notes: string;
  shell_command: string;
  auto_run: boolean;
  created_at: string;
};

export type AgentContextSnapshot = {
  id: string;
  project_id: string;
  context_json: Record<string, unknown>;
  label: string;
  trigger: string;
  created_at: string;
};

export type ContextShareLink = {
  id: string;
  project_id: string;
  token: string;
  label: string;
  expires_at: string | null;
  max_access_count: number | null;
  access_count: number;
  last_accessed_at: string | null;
  context_json: Record<string, unknown>;
  created_at: string;
};

export type Machine = {
  id: string;
  owner_id: string;
  hostname: string;
  label: string;
  os: string;
  arch: string;
  notes: string;
  is_current: boolean;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

export type MachineOverride = {
  id: string;
  project_id: string;
  machine_id: string;
  owner_id: string;
  repo_path: string;
  port_offset: number;
  working_dir_override: string;
  custom_env: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type DeploymentHistoryEntry = {
  id: string;
  project_id: string;
  deployment_target_id: string | null;
  platform: string;
  environment: string;
  trigger_source: string;
  status: string;
  deployment_url: string;
  deploy_command: string;
  branch: string;
  commit_sha: string;
  duration_ms: number | null;
  notes: string;
  started_at: string;
  finished_at: string | null;
  created_at: string;
};

export type CommandRunHistory = {
  id: string;
  command_id: string;
  project_id: string;
  exit_code: number | null;
  duration_ms: number | null;
  triggered_by: string;
  started_at: string;
  finished_at: string | null;
};

export type ActivityLogEntry = {
  id: string;
  project_id: string;
  event_type: string;
  category: string;
  title: string;
  detail: string;
  metadata: Record<string, unknown>;
  source: string;
  created_at: string;
};

export type GitHubToken = {
  id: string;
  owner_id: string;
  access_token: string;
  github_username: string;
  github_avatar_url: string;
  scopes: string;
  created_at: string;
  updated_at: string;
};

export type GitHubWorkflowRun = {
  id: number;
  name: string;
  workflow_id: number;
  head_branch: string;
  head_sha: string;
  status: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested' | 'pending';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | 'neutral' | 'stale' | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  run_started_at: string | null;
  run_number: number;
  event: string;
};

export type GitHubRepoStatus = {
  openIssues: number | null;
  openPRs: number | null;
  latestRun: GitHubWorkflowRun | null;
  branchProtected: boolean | null;
  error: string | null;
  fetchedAt: string;
};

export type GitHubIssue = {
  id: number;
  number: number;
  title: string;
  html_url: string;
  state: 'open' | 'closed';
  labels: { id: number; name: string; color: string; description: string | null }[];
  assignees: { id: number; login: string; avatar_url: string }[];
  milestone: { id: number; title: string; html_url: string } | null;
  created_at: string;
  updated_at: string;
  comments: number;
  user: { login: string; avatar_url: string };
};

export type GitHubPullRequest = {
  id: number;
  number: number;
  title: string;
  html_url: string;
  state: 'open' | 'closed';
  draft: boolean;
  merged: boolean;
  labels: { id: number; name: string; color: string; description: string | null }[];
  assignees: { id: number; login: string; avatar_url: string }[];
  milestone: { id: number; title: string; html_url: string } | null;
  user: { login: string; avatar_url: string };
  created_at: string;
  updated_at: string;
  comments: number;
  /** SHA of the PR head commit, used to look up CI status */
  head_sha: string;
};

// ── Launch Group Execution (daemon-side orchestration) ──────────────────────

export type LaunchGroupStepStatus = {
  stepId: string;
  label: string;
  commandId: string | null;
  status: 'pending' | 'waiting_port' | 'waiting_health' | 'delaying' | 'starting' | 'running' | 'completed' | 'failed' | 'skipped';
  error?: string;
  startedAt?: number;
  completedAt?: number;
  /** Port being waited on, if any */
  waitingForPort?: number;
  /** Health URL being waited on, if any */
  waitingForHealth?: string;
  /** Remaining delay in ms, if delaying */
  delayRemaining?: number;
};

export type LaunchGroupExecution = {
  executionId: string;
  launchGroupId: string;
  launchGroupName: string;
  slug: string;
  status: 'running' | 'completed' | 'failed' | 'aborted';
  steps: LaunchGroupStepStatus[];
  startedAt: number;
  completedAt?: number;
  currentStepIndex: number;
};

// ── Port Conflict Detection ──────────────────────────────────────────────────

export type PortConflict = {
  port: number;
  projects: { project_id: string; project_name: string; project_slug: string; label: string; source: 'port' | 'command'; source_id: string }[];
};

// ── Project Templates ────────────────────────────────────────────────────────

export type ProjectTemplate = {
  /** Unique identifier for the template */
  id: string;
  /** Display name shown in the template picker */
  name: string;
  /** Short description of what this template sets up */
  description: string;
  /** Icon name from lucide-react (e.g. 'Globe', 'Server', 'Database') */
  icon: string;
  /** Tags applied to the new project */
  tags: string;
  /** Package manager default */
  package_manager: string;
  /** Hosting platform default */
  hosting_platform: string;
  /** Pre-configured command profiles (without id/project_id) */
  commands: Omit<CommandProfile, 'id' | 'project_id'>[];
  /** Pre-configured ports (without id/project_id) */
  ports: Omit<ProjectPort, 'id' | 'project_id'>[];
  /** Pre-configured env key scaffolds (without id/project_id) */
  env_keys: Omit<EnvKey, 'id' | 'project_id'>[];
  /** Pre-configured URLs (without id/project_id) */
  urls: Omit<ProjectUrl, 'id' | 'project_id'>[];
  /** Pre-configured deployment targets (without id/project_id) */
  deployments: Omit<DeploymentTarget, 'id' | 'project_id'>[];
  /** Pre-configured Docker compose configs (without id/project_id) */
  docker: Omit<DockerComposeConfig, 'id' | 'project_id'>[];
};

// ── Uptime Tracking ─────────────────────────────────────────────────────────

export type UptimeSample = {
  port: number;
  ts: number;      // unix ms
  up: boolean;
};

export type UptimeStats = {
  /** Percentage of samples that were up (0-100) */
  uptimePct: number;
  /** Total samples in the window */
  totalSamples: number;
  /** Number of up samples */
  upCount: number;
  /** Number of transitions (up->down or down->up) */
  transitions: number;
  /** True if service is flapping (high transition rate) */
  isFlapping: boolean;
  /** Raw samples for sparkline (most recent first) */
  samples: UptimeSample[];
};

// ── Webhook Notifications ────────────────────────────────────────────────────

export type WebhookConfig = {
  id: string;
  project_id: string;
  url: string;
  label: string;
  events: string;
  secret: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type WebhookDelivery = {
  id: string;
  webhook_config_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'success' | 'failed' | 'retrying';
  status_code: number | null;
  response_body: string;
  attempt_count: number;
  last_attempt_at: string | null;
  created_at: string;
};

export type WebhookEventType =
  | 'daemon.start'
  | 'daemon.stop'
  | 'deploy.triggered'
  | 'deploy.completed'
  | 'port.health_failure'
  | 'sync.completed'
  | 'process.started'
  | 'process.exited';

export type WebhookPayload = {
  event: WebhookEventType;
  timestamp: string;
  project: {
    slug: string;
    name: string;
  };
  data: Record<string, unknown>;
};

// ── Dashboard Layouts ────────────────────────────────────────────────────────

export type LayoutCardSize = 'small' | 'medium' | 'large';

export type LayoutSection = {
  /** Unique identifier for the section (client-generated uuid) */
  id: string;
  /** Display name (e.g. 'Client Work', 'Personal') */
  name: string;
  /** Ordered array of project IDs in this section */
  project_ids: string[];
  /** Card size for all cards in this section */
  card_size: LayoutCardSize;
  /** Whether the section is collapsed */
  collapsed: boolean;
};

export type DashboardLayout = {
  id: string;
  owner_id: string;
  name: string;
  layout_config: LayoutSection[];
  created_at: string;
  updated_at: string;
};

export type ProjectScope = {
  project: Project;
  commands: CommandProfile[];
  ports: ProjectPort[];
  urls: ProjectUrl[];
  deployments: DeploymentTarget[];
  env_keys: EnvKey[];
  infisical_refs: InfisicalRef[];
  docker: DockerComposeConfig[];
  launch_groups: LaunchGroup[];
  launch_group_steps: LaunchGroupStep[];
  overrides: AgentContextOverride | null;
  ssh_configs: SshConfig[];
  machine_overrides: MachineOverride[];
  notes: ProjectNote[];
  runbooks: Runbook[];
  runbook_steps: RunbookStep[];
  danger_zone_commands: DangerZoneCommand[];
  danger_zone_executions: DangerZoneExecution[];
  deployment_history: DeploymentHistoryEntry[];
  activity_log: ActivityLogEntry[];
  command_run_history: CommandRunHistory[];
  webhook_configs: WebhookConfig[];
};
