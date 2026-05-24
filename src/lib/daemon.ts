/**
 * Daemon client — talks to the ldc daemon running on http://127.0.0.1:7891
 */

export const DAEMON_URL = 'http://127.0.0.1:7891';
export const DAEMON_PORT = 7891;

export type DaemonProcess = {
  slug: string;
  cmdId: string;
  name: string;
  kind: string;
  command: string;
  cwd: string;
  pid: number;
  startedAt: number;
  running: boolean;
  exitedAt?: number;
  exitCode?: number | null;
  /** CPU usage percentage (0-100+). null if unavailable. */
  cpu: number | null;
  /** Memory usage in MB. null if unavailable. */
  memoryMB: number | null;
};

export type DaemonLogEntry = {
  t: number;
  text: string;
  err: boolean;
};

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  try {
    const res = await fetch(`${DAEMON_URL}${path}`, {
      ...opts,
      signal: AbortSignal.timeout(10000), // Increased timeout to 10 seconds
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as any).error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  } catch (error) {
    console.error(`Daemon request failed: ${path}`, error);
    throw error;
  }
}

export async function checkHealth(): Promise<{ ok: boolean; version: string; pid: number }> {
  return req('/health');
}

export async function listProcesses(): Promise<DaemonProcess[]> {
  return req('/processes');
}

export async function startProcess(params: {
  slug: string;
  cmdId: string;
  command: string;
  cwd?: string;
  name?: string;
  kind?: string;
}): Promise<{ ok: boolean; pid: number }> {
  return req('/processes/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export async function stopProcess(slug: string, cmdId: string): Promise<{ ok: boolean }> {
  return req('/processes/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, cmdId }),
  });
}

export async function getLogs(slug: string, cmdId: string, tail = 100): Promise<DaemonLogEntry[]> {
  return req(`/processes/${encodeURIComponent(slug)}/${encodeURIComponent(cmdId)}/logs?tail=${tail}`);
}

export async function checkPorts(ports: number[]): Promise<Record<number, boolean>> {
  if (ports.length === 0) return {};
  return req(`/ports?check=${ports.join(',')}`);
}

// ── Health check probing ─────────────────────────────────────────────────────

export type HealthCheckResult = {
  id: string;
  url: string;
  ok: boolean;
  status: number;
  statusText: string;
  responseMs: number;
  bodySnippet: string;
};

export async function probeHealthUrls(
  urls: Array<{ id: string; url: string }>,
): Promise<HealthCheckResult[]> {
  const { results } = await req<{ results: HealthCheckResult[] }>('/health-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls }),
  });
  return results;
}

// ── Project detection ─────────────────────────────────────────────────────────

export type DetectedPort = {
  label: string;
  port: number;
  protocol: string;
  local_url: string;
  health_url: string;
};

export type DetectResult = {
  project: {
    name?: string;
    slug?: string;
    repo_url?: string;
    default_branch?: string;
    package_manager?: string;
    hosting_platform?: string;
  };
  commands: Array<{
    name: string;
    kind: string;
    command: string;
    working_dir: string;
    expected_port?: number | null;
    health_url: string;
    must_confirm: boolean;
  }>;
  ports: DetectedPort[];
  env_keys: Array<{ key_name: string; classification: string }>;
  deployments: Array<{ platform: string; environment: string; production_url?: string }>;
  docker: Array<{ compose_file_path: string; services: string }>;
  infisical_refs: Array<{
    infisical_project_id: string;
    environment: string;
    secret_path: string;
    run_command_pattern: string;
    notes?: string;
  }>;
};

export async function detectProject(cwd: string): Promise<DetectResult> {
  return req(`/detect?cwd=${encodeURIComponent(cwd)}`);
}

// ── Env diff scan ─────────────────────────────────────────────────────────────

export type EnvDiffResult = {
  files: Record<string, string[]>;
  all_keys: string[];
};

export async function fetchEnvDiff(cwd: string): Promise<EnvDiffResult> {
  return req(`/env-diff?cwd=${encodeURIComponent(cwd)}`);
}

// ── Terminal launcher ──────────────────────────────────────────────────────────

export async function openTerminal(command: string, cwd?: string, title?: string): Promise<{ ok: boolean }> {
  return req('/open-terminal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, cwd, title }),
  });
}

export async function launchProject(repo_path: string, slug?: string, command?: string): Promise<{ ok: boolean; command: string | null; already?: boolean }> {
  return req('/launch-project', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo_path, slug, command }),
  });
}

// ── WebSocket log streaming ──────────────────────────────────────────────────

export const DAEMON_WS_URL = `ws://127.0.0.1:${DAEMON_PORT}`;

export type LogStreamCallbacks = {
  onBacklog: (lines: DaemonLogEntry[]) => void;
  onLines: (lines: DaemonLogEntry[]) => void;
  onError?: (err: Event) => void;
  onClose?: () => void;
};

/**
 * Open a WebSocket to the daemon and subscribe to real-time logs for a process.
 * Returns a cleanup function that closes the connection.
 */
export function streamLogs(
  slug: string,
  cmdId: string,
  callbacks: LogStreamCallbacks,
): () => void {
  const ws = new WebSocket(DAEMON_WS_URL);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'subscribe', slug, cmdId }));
  };

  ws.onmessage = (event) => {
    let msg: { type: string; lines: DaemonLogEntry[] };
    try { msg = JSON.parse(event.data); } catch { return; }

    if (msg.type === 'backlog') {
      callbacks.onBacklog(msg.lines);
    } else if (msg.type === 'logs') {
      callbacks.onLines(msg.lines);
    }
  };

  ws.onerror = (err) => {
    callbacks.onError?.(err);
  };

  ws.onclose = () => {
    callbacks.onClose?.();
  };

  return () => {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  };
}

// ── Deployment trigger ───────────────────────────────────────────────────────

export async function triggerDeploy(params: {
  slug: string;
  deploymentId: string;
  command: string;
  cwd?: string;
  platform?: string;
  environment?: string;
}): Promise<{ ok: boolean; pid: number; cmdId: string }> {
  return req('/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

// ── Infisical sync check ─────────────────────────────────────────────────

export type InfisicalSyncResult = {
  id: string;
  status: 'reachable' | 'error' | 'unknown';
  secret_count?: number;
  error?: string;
  response_ms?: number;
  checked_at: string;
};

export type InfisicalSyncCheckResponse = {
  results: InfisicalSyncResult[];
  cli_available: boolean;
};

export async function checkInfisicalSync(
  refs: Array<{ id: string; infisical_project_id: string; environment: string; secret_path: string }>,
): Promise<InfisicalSyncCheckResponse> {
  return req<InfisicalSyncCheckResponse>('/infisical-sync-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refs }),
  });
}

// ── Launch Group Execution ─────────────────────────────────────────────────

import type { LaunchGroupExecution } from './types';

export async function startLaunchGroup(params: {
  slug: string;
  launchGroupId: string;
  launchGroupName: string;
  steps: Array<{
    stepId: string;
    label: string;
    commandId: string | null;
    command: string | null;
    cwd?: string;
    kind?: string;
    waitForPort?: number | null;
    waitForHealth?: string;
    delayMs?: number;
    /** HTTP statuses treated as healthy when probing waitForHealth */
    acceptableStatuses?: number[];
    /** Per-step timeout in ms (null/undefined → daemon default 120000) */
    timeoutMs?: number | null;
    /** When true, failure does not abort the rest of the group */
    continueOnFailure?: boolean;
  }>;
}): Promise<{ ok: boolean; executionId: string }> {
  return req('/launch-group/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export async function stopLaunchGroup(executionId: string): Promise<{ ok: boolean }> {
  return req('/launch-group/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ executionId }),
  });
}

export async function getLaunchGroupStatus(executionId: string): Promise<LaunchGroupExecution> {
  return req(`/launch-group/status?executionId=${encodeURIComponent(executionId)}`);
}

export async function getActiveLaunchGroup(launchGroupId: string): Promise<LaunchGroupExecution | null> {
  const result = await req<LaunchGroupExecution | { active: false }>(`/launch-group/active?launchGroupId=${encodeURIComponent(launchGroupId)}`);
  if ('active' in result && result.active === false) return null;
  return result as LaunchGroupExecution;
}

export type LaunchGroupStatusCallbacks = {
  onStatus: (execution: LaunchGroupExecution) => void;
  onError?: (err: Event) => void;
  onClose?: () => void;
};

/**
 * Open a WebSocket to the daemon and subscribe to real-time launch group status.
 * Returns a cleanup function that closes the connection.
 */
export function streamLaunchGroupStatus(
  executionId: string,
  callbacks: LaunchGroupStatusCallbacks,
): () => void {
  const ws = new WebSocket(DAEMON_WS_URL);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'subscribe-launch-group', executionId }));
  };

  ws.onmessage = (event) => {
    let msg: { type: string; execution: LaunchGroupExecution };
    try { msg = JSON.parse(event.data); } catch { return; }

    if (msg.type === 'launch-group-status' && msg.execution) {
      callbacks.onStatus(msg.execution);
    }
  };

  ws.onerror = (err) => {
    callbacks.onError?.(err);
  };

  ws.onclose = () => {
    callbacks.onClose?.();
  };

  return () => {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  };
}

// ── Machine identity ─────────────────────────────────────────────────────────

export type MachineIdentity = {
  hostname: string;
  os: string;
  arch: string;
};

export async function getMachineIdentity(): Promise<MachineIdentity> {
  try {
    return await req<MachineIdentity>('/machine-identity');
  } catch {
    // Fallback: use browser-available info if daemon doesn't support this endpoint yet
    return { hostname: '', os: navigator.platform || '', arch: '' };
  }
}

// ── Webhook management ─────────────────────────────────────────────────────

export type WebhookConfigState = {
  id: string;
  url: string;
  events: string;
  enabled: boolean;
  projectSlug: string;
};

export async function listWebhookConfigs(): Promise<WebhookConfigState[]> {
  return req('/webhooks/configs');
}

export async function registerWebhookConfig(params: {
  id: string;
  url: string;
  events?: string;
  secret?: string;
  enabled?: boolean;
  projectSlug?: string;
}): Promise<{ ok: boolean }> {
  return req('/webhooks/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export async function removeWebhookConfig(id: string): Promise<{ ok: boolean }> {
  return req('/webhooks/config', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
}

export async function bulkSetWebhookConfigs(configs: Array<{
  id: string;
  url: string;
  events?: string;
  secret?: string;
  enabled?: boolean;
  projectSlug?: string;
}>): Promise<{ ok: boolean; count: number }> {
  return req('/webhooks/configs/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ configs }),
  });
}

export type WebhookDeliveryEntry = {
  id: string;
  webhookId: string;
  event: string;
  payload: Record<string, unknown>;
  status: string;
  statusCode: number | null;
  responseBody: string;
  attemptCount: number;
  createdAt: number;
};

export async function listWebhookDeliveries(params?: {
  status?: string;
  limit?: number;
}): Promise<WebhookDeliveryEntry[]> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.limit) qs.set('limit', String(params.limit));
  const query = qs.toString();
  return req(`/webhooks/deliveries${query ? '?' + query : ''}`);
}

export async function testWebhook(url: string, secret?: string, event?: string): Promise<{ ok: boolean; message?: string; error?: string }> {
  return req('/webhooks/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, secret, event }),
  });
}

export async function emitWebhook(params: {
  event: string;
  project?: { slug: string; name: string };
  data?: Record<string, unknown>;
}): Promise<{ ok: boolean }> {
  return req('/webhooks/emit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

// ── Project Directory Management ──────────────────────────────────────────────

export async function runDockerCompose(params: {
  action: string;
  compose_file_path: string;
  cwd: string;
  slug: string;
}): Promise<{ ok: boolean; cmdId: string; pid: number }> {
  return req('/docker-compose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export async function setProjectDirectory(projectDir: string): Promise<{ ok: boolean; projectDir: string }> {
  return req('/set-project-directory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectDir }),
  });
}

export async function getProjectDirectory(): Promise<{ projectDir: string }> {
  return req('/project-directory');
}

export async function pickDirectory(): Promise<{ cancelled: boolean; path: string | null }> {
  return req('/pick-directory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}
