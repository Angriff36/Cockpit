/**
 * ldc daemon — local HTTP + WebSocket bridge
 * Runs on http://localhost:7891 and allows the Cockpit web UI to start/stop
 * local dev processes and check port liveness.
 * WebSocket connections on the same port support real-time log streaming.
 */
import { createServer } from 'http';
import { spawn, execSync } from 'child_process';
import { createConnection } from 'net';
import { basename, dirname } from 'path';
import { hostname, platform, arch, cpus, totalmem } from 'os';
import { WebSocketServer } from 'ws';
import { detect, scanEnvFiles } from './detect.js';
import { WebhookDispatcher } from './webhook.js';

// ── Resource usage collection ─────────────────────────────────────────────────

const totalMemoryMB = totalmem() / (1024 * 1024);
const numCpus = cpus().length;

/**
 * Collect CPU% and memory (MB) for a given PID using OS-level APIs.
 * Returns { cpu, memoryMB } or null if the process is gone.
 * On Windows uses wmic, on Unix uses ps.
 */
function collectResourceUsage(pid) {
  if (!pid) return null;
  try {
    if (process.platform === 'win32') {
      // wmic: get WorkingSetSize (bytes) and PercentProcessorTime
      // Use tasklist for memory (reliable), and track CPU via snapshots
      const out = execSync(
        `tasklist /FI "PID eq ${pid}" /FO CSV /NH`,
        { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
      if (!out || out.includes('No tasks')) return null;
      // CSV format: "Image Name","PID","Session Name","Session#","Mem Usage"
      // Mem Usage is like "12,344 K"
      const match = out.match(/"([^"]*\d+[^"]*)"\s*$/);
      if (!match) return null;
      const memStr = match[1].replace(/[^0-9]/g, '');
      const memKB = parseInt(memStr, 10);
      const memoryMB = Math.round((memKB / 1024) * 10) / 10;
      return { cpu: null, memoryMB };
    } else {
      // ps: get %CPU and RSS (in KB)
      const out = execSync(
        `ps -p ${pid} -o %cpu=,rss=`,
        { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
      if (!out) return null;
      const parts = out.split(/\s+/);
      if (parts.length < 2) return null;
      const cpu = parseFloat(parts[0]);
      const rssKB = parseInt(parts[1], 10);
      const memoryMB = Math.round((rssKB / 1024) * 10) / 10;
      return {
        cpu: Math.round(cpu * 10) / 10,
        memoryMB,
      };
    }
  } catch {
    return null;
  }
}

/**
 * Periodically refresh resource usage for all running processes.
 * Runs every 2 seconds.
 */
function startResourcePoller() {
  setInterval(() => {
    for (const [, entry] of procs) {
      if (!entry.running || !entry.pid) {
        entry.resources = null;
        continue;
      }
      const usage = collectResourceUsage(entry.pid);
      entry.resources = usage;
    }
  }, 2000);
}

// ── Infisical CLI probe ──────────────────────────────────────────────────────

let infisicalCliAvailable = null; // cached check

function hasInfisicalCli() {
  if (infisicalCliAvailable !== null) return infisicalCliAvailable;
  try {
    execSync(process.platform === 'win32' ? 'where infisical' : 'which infisical', { stdio: 'ignore' });
    infisicalCliAvailable = true;
  } catch {
    infisicalCliAvailable = false;
  }
  return infisicalCliAvailable;
}

function probeInfisicalRef(ref) {
  return new Promise((resolve) => {
    if (!hasInfisicalCli()) {
      resolve({
        id: ref.id,
        status: 'unknown',
        error: 'infisical CLI not installed',
        checked_at: new Date().toISOString(),
      });
      return;
    }

    const args = ['secrets', 'list', '--silent'];
    if (ref.environment) args.push('--env', ref.environment);
    if (ref.secret_path) args.push('--path', ref.secret_path);
    if (ref.infisical_project_id) args.push('--projectId', ref.infisical_project_id);

    const start = Date.now();
    const child = spawn('infisical', args, {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });

    child.on('error', (err) => {
      resolve({
        id: ref.id,
        status: 'error',
        error: err.message,
        response_ms: Date.now() - start,
        checked_at: new Date().toISOString(),
      });
    });

    child.on('close', (code) => {
      const elapsed = Date.now() - start;
      if (code === 0) {
        // Count secret lines (rough: non-empty lines that aren't headers)
        const lines = stdout.trim().split('\n').filter(l => l.trim());
        resolve({
          id: ref.id,
          status: 'reachable',
          secret_count: Math.max(0, lines.length - 1), // subtract header row
          response_ms: elapsed,
          checked_at: new Date().toISOString(),
        });
      } else {
        // Extract useful error from stderr
        const errMsg = stderr.trim().split('\n').pop() || `exit code ${code}`;
        resolve({
          id: ref.id,
          status: 'error',
          error: errMsg.slice(0, 300),
          response_ms: elapsed,
          checked_at: new Date().toISOString(),
        });
      }
    });
  });
}

export const DAEMON_PORT = 7891;

// ── Webhook dispatcher ────────────────────────────────────────────────────────
const webhooks = new WebhookDispatcher();

// ── Process registry ─────────────────────────────────────────────────────────
// key: `${slug}:${cmdId}`
const procs = new Map();

// Current project directory context
let currentProjectDir = process.cwd();

function procKey(slug, cmdId) { return `${slug}:${cmdId}`; }

// ── WebSocket subscriber registry ────────────────────────────────────────────
// key: procKey → Set<WebSocket>
const subscribers = new Map();

function broadcast(key, messages) {
  const subs = subscribers.get(key);
  if (!subs || subs.size === 0) return;
  const payload = JSON.stringify({ type: 'logs', key, lines: messages });
  for (const ws of subs) {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(payload);
    }
  }
}

function startProc(slug, cmdId, command, cwd, name, kind) {
  const key = procKey(slug, cmdId);
  if (procs.has(key)) return { error: 'already running' };

  const child = spawn(command, [], {
    shell: true,
    cwd: cwd || process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    // detached on Unix so we can kill the process group
    ...(process.platform !== 'win32' && { detached: true }),
  });

  const logs = [];
  function pushLog(text, err = false) {
    const lines = text.toString().split('\n');
    const newEntries = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      const entry = { t: Date.now(), text: line, err };
      logs.push(entry);
      newEntries.push(entry);
      if (logs.length > 500) logs.shift();
    }
    if (newEntries.length > 0) broadcast(key, newEntries);
  }
  child.stdout.on('data', d => pushLog(d));
  child.stderr.on('data', d => pushLog(d, true));
  child.on('exit', (code) => {
    const entry = procs.get(key);
    if (entry) {
      pushLog(`[process exited with code ${code ?? '?'}]`);
      entry.running = false;
      entry.exitedAt = Date.now();
      entry.exitCode = code;
      webhooks.emit('process.exited', { slug: entry.slug, name: entry.name || entry.cmdId }, { cmdId: entry.cmdId, kind: entry.kind, exitCode: code });
    }
  });

  procs.set(key, {
    slug, cmdId, name, kind, command, cwd,
    child, logs,
    pid: child.pid,
    startedAt: Date.now(),
    running: true,
  });

  webhooks.emit('process.started', { slug, name: name || cmdId }, { cmdId, kind, pid: child.pid, command });

  return { ok: true, pid: child.pid };
}

function stopProc(slug, cmdId) {
  const key = procKey(slug, cmdId);
  const entry = procs.get(key);
  if (!entry || !entry.running) return { error: 'not running' };

  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /T /PID ${entry.child.pid}`, { stdio: 'ignore' });
    } else {
      // Kill the process group so child processes of shell are also killed
      try { process.kill(-entry.child.pid, 'SIGTERM'); } catch { entry.child.kill('SIGTERM'); }
    }
  } catch {
    try { entry.child.kill('SIGKILL'); } catch {}
  }

  entry.running = false;
  return { ok: true };
}

// ── Port checker ─────────────────────────────────────────────────────────────
function checkPort(port) {
  return new Promise(resolve => {
    const s = createConnection({ port, host: '127.0.0.1' });
    const timeout = setTimeout(() => { try { s.destroy(); } catch {} resolve(false); }, 400);
    s.on('connect', () => { clearTimeout(timeout); s.destroy(); resolve(true); });
    s.on('error', () => { clearTimeout(timeout); resolve(false); });
  });
}

// ── Health URL prober ─────────────────────────────────────────────────────────
// acceptableStatuses: optional array of exact HTTP codes treated as healthy.
// When omitted, the default behavior (any 2xx/3xx) is preserved.
async function probeHealthUrl(url, id, acceptableStatuses) {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'Accept': 'application/json, text/plain, */*' },
    });
    clearTimeout(timeout);
    const elapsed = Date.now() - start;
    let bodySnippet = '';
    try {
      const text = await res.text();
      bodySnippet = text.slice(0, 500);
    } catch {}
    const ok = Array.isArray(acceptableStatuses) && acceptableStatuses.length > 0
      ? acceptableStatuses.includes(res.status)
      : (res.status >= 200 && res.status < 400);
    return {
      id,
      url,
      ok,
      status: res.status,
      statusText: res.statusText,
      responseMs: elapsed,
      bodySnippet,
    };
  } catch (err) {
    return {
      id,
      url,
      ok: false,
      status: 0,
      statusText: err.name === 'AbortError' ? 'Timeout' : err.message,
      responseMs: Date.now() - start,
      bodySnippet: '',
    };
  }
}

// ── Terminal launcher ─────────────────────────────────────────────────────────
function spawnDetached(cmd, args, opts = {}) {
  const proc = spawn(cmd, args, { ...opts, detached: true, stdio: 'ignore' });
  if (!proc.pid) throw new Error(`Failed to launch ${cmd} — process did not start`);
  proc.unref();
  return proc.pid;
}

function openTerminal(command, cwd, title = 'ldc') {
  const plat = process.platform;

  if (plat === 'win32') {
    let hasWT = false;
    try { execSync('where wt.exe', { stdio: 'ignore' }); hasWT = true; } catch {}

    if (hasWT) {
      const normalized = cwd ? cwd.replace(/\//g, '\\') : undefined;
      // Use -- separator so wt doesn't misparse command args as its own options
      const wtArgs = ['new-tab', '--title', title];
      if (normalized) wtArgs.push('--startingDirectory', normalized);
      wtArgs.push('--');
      if (command) wtArgs.push('cmd', '/k', command);
      else wtArgs.push('cmd');
      try {
        spawnDetached('wt.exe', wtArgs, { shell: false });
        return;
      } catch {
        // wt.exe found but failed — fall through to cmd.exe
      }
    }

    // cmd.exe fallback
    const startArgs = ['/c', 'start', title];
    if (cwd) startArgs.push('/d', cwd.replace(/\//g, '\\'));
    startArgs.push('cmd', '/k', command || 'echo ready');
    spawnDetached('cmd', startArgs, { shell: false });

  } else if (plat === 'darwin') {
    const escaped = (command
      ? (cwd ? `cd '${cwd}' && ${command}` : command)
      : (cwd ? `cd '${cwd}'` : '')
    ).replace(/'/g, "'\\''");
    spawnDetached('osascript', ['-e', `tell application "Terminal" to do script "${escaped}"`]);

  } else {
    // Linux: try common terminals in order
    const shellCmd = command
      ? (cwd ? `cd '${cwd}' && ${command}; exec bash` : `${command}; exec bash`)
      : (cwd ? `cd '${cwd}'; exec bash` : 'exec bash');
    const candidates = [
      ['gnome-terminal', ['--', 'bash', '-c', shellCmd]],
      ['xfce4-terminal', ['-e', `bash -c "${shellCmd.replace(/"/g, '\\"')}"`]],
      ['konsole', ['-e', 'bash', '-c', shellCmd]],
      ['xterm', ['-e', `bash -c "${shellCmd.replace(/"/g, '\\"')}"`]],
    ];
    for (const [term, args] of candidates) {
      try {
        execSync(`which ${term}`, { stdio: 'ignore' });
        spawnDetached(term, args, { cwd: cwd || undefined });
        return;
      } catch {}
    }
    throw new Error('No supported terminal emulator found (tried gnome-terminal, xfce4-terminal, konsole, xterm)');
  }
}

/** Open a native folder picker dialog. Returns absolute path or null if cancelled. */
function pickDirectoryNative() {
  const plat = process.platform;
  try {
    if (plat === 'win32') {
      const ps = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
        "$d.Description = 'Select a project folder'",
        "$d.ShowNewFolderButton = $false",
        "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }",
      ].join('; ');
      const out = execSync(`powershell -NoProfile -STA -Command "${ps.replace(/"/g, '\\"')}"`, {
        encoding: 'utf8',
        timeout: 120_000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      return out || null;
    }
    if (plat === 'darwin') {
      const out = execSync(
        'osascript -e \'POSIX path of (choose folder with prompt "Select a project folder")\'',
        { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim().replace(/\/$/, '');
      return out || null;
    }
    for (const cmd of [
      'zenity --file-selection --directory --title="Select a project folder"',
      'kdialog --getexistingdirectory .',
    ]) {
      try {
        const out = execSync(cmd, { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (out) return out;
      } catch { /* try next */ }
    }
    return null;
  } catch {
    return null;
  }
}

// ── Launch Group Execution Engine ─────────────────────────────────────────
// key: executionId → execution state
const launchGroupExecutions = new Map();
// key: executionId → Set<WebSocket>
const launchGroupSubscribers = new Map();

let executionCounter = 0;

function broadcastLaunchGroupStatus(executionId) {
  const exec = launchGroupExecutions.get(executionId);
  if (!exec) return;
  const subs = launchGroupSubscribers.get(executionId);
  if (!subs || subs.size === 0) return;
  const payload = JSON.stringify({ type: 'launch-group-status', execution: serializeExecution(exec) });
  for (const ws of subs) {
    if (ws.readyState === 1 /* OPEN */) ws.send(payload);
  }
}

function serializeExecution(exec) {
  return {
    executionId: exec.executionId,
    launchGroupId: exec.launchGroupId,
    launchGroupName: exec.launchGroupName,
    slug: exec.slug,
    status: exec.status,
    startedAt: exec.startedAt,
    completedAt: exec.completedAt || undefined,
    currentStepIndex: exec.currentStepIndex,
    steps: exec.steps.map(s => ({
      stepId: s.stepId,
      label: s.label,
      commandId: s.commandId,
      status: s.status,
      error: s.error,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      waitingForPort: s.waitingForPort,
      waitingForHealth: s.waitingForHealth,
      delayRemaining: s.delayRemaining,
    })),
  };
}

async function waitForPort(port, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const live = await checkPort(port);
    if (live) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function waitForHealth(url, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await probeHealthUrl(url, 'gate');
    if (result.ok) return true;
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

async function executeLaunchGroup(executionId) {
  const exec = launchGroupExecutions.get(executionId);
  if (!exec) return;

  exec.status = 'running';
  broadcastLaunchGroupStatus(executionId);

  for (let i = 0; i < exec.steps.length; i++) {
    // Check abort
    if (exec.aborted) {
      exec.status = 'aborted';
      for (let j = i; j < exec.steps.length; j++) {
        if (exec.steps[j].status === 'pending') exec.steps[j].status = 'skipped';
      }
      exec.completedAt = Date.now();
      broadcastLaunchGroupStatus(executionId);
      return;
    }

    exec.currentStepIndex = i;
    const step = exec.steps[i];
    step.status = 'starting';
    step.startedAt = Date.now();
    broadcastLaunchGroupStatus(executionId);

    // Per-step timeout (null/undefined → 120s default, matching prior behavior)
    const stepTimeoutMs = (typeof step.timeoutMs === 'number' && step.timeoutMs > 0)
      ? step.timeoutMs
      : 120000;

    // Track non-fatal step failure so the group still reports 'failed' at the end
    // even when continue_on_failure let execution proceed.
    const failStep = (reason) => {
      step.status = 'failed';
      step.error = reason;
      step.completedAt = Date.now();
      step.waitingForPort = undefined;
      step.waitingForHealth = undefined;
      step.delayRemaining = undefined;
      if (step.continueOnFailure) {
        exec.hadNonFatalFailure = true;
        broadcastLaunchGroupStatus(executionId);
        return 'continue';
      }
      exec.status = 'failed';
      exec.completedAt = Date.now();
      broadcastLaunchGroupStatus(executionId);
      return 'stop';
    };

    try {
      // 1. Wait for port gate
      if (step.waitForPort) {
        step.status = 'waiting_port';
        step.waitingForPort = step.waitForPort;
        broadcastLaunchGroupStatus(executionId);
        const portReady = await waitForPortWithAbort(step.waitForPort, stepTimeoutMs, exec);
        if (exec.aborted) { handleAbort(exec, i); return; }
        if (!portReady) {
          const action = failStep(`Port ${step.waitForPort} did not become available within ${stepTimeoutMs}ms`);
          if (action === 'stop') return;
          continue;
        }
        step.waitingForPort = undefined;
      }

      // 2. Wait for health gate
      if (step.waitForHealth) {
        step.status = 'waiting_health';
        step.waitingForHealth = step.waitForHealth;
        broadcastLaunchGroupStatus(executionId);
        const healthy = await waitForHealthWithAbort(
          step.waitForHealth,
          stepTimeoutMs,
          exec,
          step.acceptableStatuses,
        );
        if (exec.aborted) { handleAbort(exec, i); return; }
        if (!healthy) {
          const action = failStep(`Health check ${step.waitForHealth} did not pass within ${stepTimeoutMs}ms`);
          if (action === 'stop') return;
          continue;
        }
        step.waitingForHealth = undefined;
      }

      // 3. Delay
      if (step.delayMs > 0) {
        step.status = 'delaying';
        step.delayRemaining = step.delayMs;
        broadcastLaunchGroupStatus(executionId);
        await delayWithAbort(step.delayMs, exec, step, executionId);
        if (exec.aborted) { handleAbort(exec, i); return; }
        step.delayRemaining = undefined;
      }

      // 4. Start the command
      if (step.command) {
        step.status = 'running';
        broadcastLaunchGroupStatus(executionId);
        const result = startProc(exec.slug, step.commandId, step.command, step.cwd, step.label, step.kind);
        if (result.error && result.error !== 'already running') {
          const action = failStep(result.error);
          if (action === 'stop') return;
          continue;
        }
        step.status = 'completed';
        step.completedAt = Date.now();
      } else {
        // No command — just a gate/delay step
        step.status = 'completed';
        step.completedAt = Date.now();
      }
      broadcastLaunchGroupStatus(executionId);

    } catch (err) {
      const action = failStep(err.message || String(err));
      if (action === 'stop') return;
      continue;
    }
  }

  exec.status = exec.hadNonFatalFailure ? 'failed' : 'completed';
  exec.completedAt = Date.now();
  broadcastLaunchGroupStatus(executionId);
}

function handleAbort(exec, fromIndex) {
  exec.status = 'aborted';
  for (let j = fromIndex; j < exec.steps.length; j++) {
    const s = exec.steps[j];
    if (s.status !== 'completed' && s.status !== 'failed') s.status = 'skipped';
  }
  exec.completedAt = Date.now();
  broadcastLaunchGroupStatus(exec.executionId);
}

async function waitForPortWithAbort(port, timeoutMs, exec) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (exec.aborted) return false;
    const live = await checkPort(port);
    if (live) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function waitForHealthWithAbort(url, timeoutMs, exec, acceptableStatuses) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (exec.aborted) return false;
    const result = await probeHealthUrl(url, 'gate', acceptableStatuses);
    if (result.ok) return true;
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

async function delayWithAbort(ms, exec, step, executionId) {
  const interval = 250;
  let remaining = ms;
  while (remaining > 0) {
    if (exec.aborted) return;
    const wait = Math.min(interval, remaining);
    await new Promise(r => setTimeout(r, wait));
    remaining -= wait;
    step.delayRemaining = remaining;
    // Throttle status broadcasts to every 1s during delay
    if (remaining % 1000 < interval) broadcastLaunchGroupStatus(executionId);
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) reject(new Error('too large')); });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('invalid JSON')); }
    });
  });
}

// ── Router ────────────────────────────────────────────────────────────────────
async function handle(req, res) {
  const url = new URL(req.url, `http://localhost:${DAEMON_PORT}`);
  const path = url.pathname;
  const method = req.method;

  // Preflight
  if (method === 'OPTIONS') { send(res, 204, {}); return; }

  // GET /health
  if (method === 'GET' && path === '/health') {
    send(res, 200, { ok: true, version: '0.1.0', pid: process.pid });
    return;
  }

  // POST /set-project-directory — set the current project directory context
  if (method === 'POST' && path === '/set-project-directory') {
    const { projectDir } = await readBody(req);
    if (!projectDir) { send(res, 400, { error: 'projectDir required' }); return; }
    currentProjectDir = projectDir;
    console.log(`\x1b[36m➜\x1b[0m Project directory set to: ${projectDir}`);
    send(res, 200, { ok: true, projectDir: currentProjectDir });
    return;
  }

  // GET /project-directory — get the current project directory context
  if (method === 'GET' && path === '/project-directory') {
    send(res, 200, { projectDir: currentProjectDir });
    return;
  }

  // POST /pick-directory — native folder picker for opening projects by path
  if (method === 'POST' && path === '/pick-directory') {
    try {
      const selected = pickDirectoryNative();
      if (!selected) {
        send(res, 200, { cancelled: true, path: null });
        return;
      }
      send(res, 200, { cancelled: false, path: selected });
    } catch (err) {
      send(res, 500, { error: err.message });
    }
    return;
  }

  // GET /processes  — list all (including recently exited)
  if (method === 'GET' && path === '/processes') {
    const list = [...procs.values()].map(({ child, logs, resources, ...rest }) => ({
      ...rest,
      cpu: resources?.cpu ?? null,
      memoryMB: resources?.memoryMB ?? null,
    }));
    send(res, 200, list);
    return;
  }

  // POST /processes/start
  if (method === 'POST' && path === '/processes/start') {
    const { slug, cmdId, command, cwd, name, kind } = await readBody(req);
    if (!slug || !cmdId || !command) { send(res, 400, { error: 'slug, cmdId, command required' }); return; }
    const result = startProc(slug, cmdId, command, cwd, name, kind);
    send(res, result.error ? 409 : 200, result);
    return;
  }

  // POST /processes/stop
  if (method === 'POST' && path === '/processes/stop') {
    const { slug, cmdId } = await readBody(req);
    if (!slug || !cmdId) { send(res, 400, { error: 'slug and cmdId required' }); return; }
    const result = stopProc(slug, cmdId);
    send(res, result.error ? 409 : 200, result);
    return;
  }

  // GET /processes/:slug/:cmdId/logs
  const logsMatch = path.match(/^\/processes\/([^/]+)\/([^/]+)\/logs$/);
  if (method === 'GET' && logsMatch) {
    const key = procKey(logsMatch[1], logsMatch[2]);
    const entry = procs.get(key);
    const tail = parseInt(url.searchParams.get('tail') || '100');
    send(res, 200, entry ? entry.logs.slice(-tail) : []);
    return;
  }

  // GET /ports?check=3000,5432,6379
  if (method === 'GET' && path === '/ports') {
    const raw = url.searchParams.get('check') || '';
    const ports = raw.split(',').map(Number).filter(n => n > 0 && n < 65536);
    const results = await Promise.all(ports.map(async p => [p, await checkPort(p)]));
    send(res, 200, Object.fromEntries(results));
    return;
  }

  // GET /detect?cwd=<absolute-path>
  if (method === 'GET' && path === '/detect') {
    const cwd = url.searchParams.get('cwd');
    if (!cwd) { send(res, 400, { error: 'cwd required' }); return; }
    try {
      const result = await detect(cwd);
      send(res, 200, result);
    } catch (err) {
      send(res, 500, { error: err.message });
    }
    return;
  }

  // GET /env-diff?cwd=<path>  — scan local .env files and return key names (no values)
  if (method === 'GET' && path === '/env-diff') {
    const cwd = url.searchParams.get('cwd');
    if (!cwd) { send(res, 400, { error: 'cwd required' }); return; }
    try {
      const result = scanEnvFiles(cwd);
      send(res, 200, result);
    } catch (err) {
      send(res, 500, { error: err.message });
    }
    return;
  }

  // POST /open-terminal  — open a new OS terminal window and run a command
  if (method === 'POST' && path === '/open-terminal') {
    const { command, cwd, title } = await readBody(req);
    try {
      openTerminal(command || '', cwd || '', title || 'ldc');
      send(res, 200, { ok: true });
    } catch (err) {
      send(res, 500, { error: err.message });
    }
    return;
  }

  // POST /launch-project  — start project dev server as tracked process
  if (method === 'POST' && path === '/launch-project') {
    const { repo_path, command, slug } = await readBody(req);
    if (!repo_path) { send(res, 400, { error: 'repo_path required' }); return; }
    try {
      let cmd = command || null;
      if (!cmd) {
        const detected = await detect(repo_path);
        const devCmd = detected.commands.find(c => c.kind === 'dev') || detected.commands.find(c => c.kind === 'start');
        if (devCmd) cmd = devCmd.command;
      }
      if (!cmd) {
        // No command detected — fall back to opening a terminal so user can run manually
        openTerminal('', repo_path, basename(repo_path));
        send(res, 200, { ok: true, command: null });
        return;
      }
      const procSlug = slug || basename(repo_path);
      const result = startProc(procSlug, 'launch', cmd, repo_path, 'Dev Server', 'dev');
      if (result.error === 'already running') {
        send(res, 200, { ok: true, command: cmd, already: true });
      } else {
        send(res, result.error ? 409 : 200, { ok: !result.error, command: cmd, pid: result.pid });
      }
    } catch (err) {
      send(res, 500, { error: err.message });
    }
    return;
  }

  // POST /deploy — trigger a deployment (runs deploy_command as a managed process)
  if (method === 'POST' && path === '/deploy') {
    const { slug, deploymentId, command, cwd, platform: plat, environment } = await readBody(req);
    if (!slug || !deploymentId || !command) {
      send(res, 400, { error: 'slug, deploymentId, command required' });
      return;
    }
    const cmdId = `deploy:${deploymentId}`;
    const name = `Deploy ${plat || 'unknown'} (${environment || 'production'})`;
    const result = startProc(slug, cmdId, command, cwd, name, 'deploy');
    if (!result.error) {
      webhooks.emit('deploy.triggered', { slug, name: slug }, { deploymentId, platform: plat, environment, cmdId });
    }
    send(res, result.error ? 409 : 200, { ...result, cmdId });
    return;
  }

  // GET /machine-identity — return hostname, os, arch for multi-machine sync
  if (method === 'GET' && path === '/machine-identity') {
    send(res, 200, { hostname: hostname(), os: platform(), arch: arch() });
    return;
  }

  // POST /health-check — probe health URLs and return status, response time, body snippet
  if (method === 'POST' && path === '/health-check') {
    const { urls } = await readBody(req);
    if (!Array.isArray(urls) || urls.length === 0) {
      send(res, 400, { error: 'urls array required' });
      return;
    }
    const results = await Promise.all(urls.map(entry => probeHealthUrl(entry.url, entry.id)));
    // Emit webhook for any failed health checks
    for (const r of results) {
      if (!r.ok) {
        webhooks.emit('port.health_failure', { slug: 'unknown', name: 'unknown' }, { url: r.url, id: r.id, status: r.status, statusText: r.statusText });
      }
    }
    send(res, 200, { results });
    return;
  }

  // POST /infisical-sync-check — probe Infisical references for reachability
  if (method === 'POST' && path === '/infisical-sync-check') {
    const { refs } = await readBody(req);
    if (!Array.isArray(refs) || refs.length === 0) {
      send(res, 400, { error: 'refs array required' });
      return;
    }
    const results = await Promise.all(refs.map(ref => probeInfisicalRef(ref)));
    send(res, 200, { results, cli_available: hasInfisicalCli() });
    return;
  }

  // POST /launch-group/start — execute a launch group sequence
  if (method === 'POST' && path === '/launch-group/start') {
    const { slug, launchGroupId, launchGroupName, steps } = await readBody(req);
    if (!slug || !launchGroupId || !Array.isArray(steps)) {
      send(res, 400, { error: 'slug, launchGroupId, steps[] required' });
      return;
    }
    // Prevent double-execution of same launch group
    for (const [, exec] of launchGroupExecutions) {
      if (exec.launchGroupId === launchGroupId && exec.status === 'running') {
        send(res, 409, { error: 'Launch group is already running', executionId: exec.executionId });
        return;
      }
    }
    executionCounter++;
    const executionId = `lg-${Date.now()}-${executionCounter}`;
    const execution = {
      executionId,
      launchGroupId,
      launchGroupName: launchGroupName || 'Launch Group',
      slug,
      status: 'pending',
      startedAt: Date.now(),
      completedAt: null,
      currentStepIndex: 0,
      aborted: false,
      steps: steps.map(s => ({
        stepId: s.stepId || s.id,
        label: s.label || 'Step',
        commandId: s.commandId || s.command_id || null,
        command: s.command || null,
        cwd: s.cwd || '',
        kind: s.kind || 'dev',
        waitForPort: s.waitForPort || s.wait_for_port || null,
        waitForHealth: s.waitForHealth || s.wait_for_health || '',
        delayMs: s.delayMs || s.delay_ms || 0,
        acceptableStatuses: Array.isArray(s.acceptableStatuses)
          ? s.acceptableStatuses
          : (Array.isArray(s.acceptable_statuses) ? s.acceptable_statuses : undefined),
        timeoutMs: (typeof s.timeoutMs === 'number')
          ? s.timeoutMs
          : (typeof s.timeout_ms === 'number' ? s.timeout_ms : null),
        continueOnFailure: Boolean(s.continueOnFailure ?? s.continue_on_failure ?? false),
        status: 'pending',
        error: undefined,
        startedAt: undefined,
        completedAt: undefined,
        waitingForPort: undefined,
        waitingForHealth: undefined,
        delayRemaining: undefined,
      })),
      hadNonFatalFailure: false,
    };
    launchGroupExecutions.set(executionId, execution);
    // Execute asynchronously
    executeLaunchGroup(executionId).catch(err => {
      const ex = launchGroupExecutions.get(executionId);
      if (ex) {
        ex.status = 'failed';
        ex.completedAt = Date.now();
        broadcastLaunchGroupStatus(executionId);
      }
    });
    send(res, 200, { ok: true, executionId });
    return;
  }

  // POST /launch-group/stop — abort a running launch group execution
  if (method === 'POST' && path === '/launch-group/stop') {
    const { executionId } = await readBody(req);
    if (!executionId) { send(res, 400, { error: 'executionId required' }); return; }
    const exec = launchGroupExecutions.get(executionId);
    if (!exec) { send(res, 404, { error: 'execution not found' }); return; }
    if (exec.status !== 'running') { send(res, 409, { error: `execution is ${exec.status}, not running` }); return; }
    exec.aborted = true;
    send(res, 200, { ok: true });
    return;
  }

  // GET /launch-group/status?executionId=... — poll current execution status
  if (method === 'GET' && path === '/launch-group/status') {
    const executionId = url.searchParams.get('executionId');
    if (!executionId) { send(res, 400, { error: 'executionId required' }); return; }
    const exec = launchGroupExecutions.get(executionId);
    if (!exec) { send(res, 404, { error: 'execution not found' }); return; }
    send(res, 200, serializeExecution(exec));
    return;
  }

  // GET /launch-group/active?launchGroupId=... — check if a specific launch group is currently running
  if (method === 'GET' && path === '/launch-group/active') {
    const launchGroupId = url.searchParams.get('launchGroupId');
    if (!launchGroupId) { send(res, 400, { error: 'launchGroupId required' }); return; }
    for (const [, exec] of launchGroupExecutions) {
      if (exec.launchGroupId === launchGroupId && exec.status === 'running') {
        send(res, 200, serializeExecution(exec));
        return;
      }
    }
    send(res, 200, { active: false });
    return;
  }

  // POST /webhooks/config — register a webhook config (in-memory for this daemon session)
  if (method === 'POST' && path === '/webhooks/config') {
    const { id, url: whUrl, events, secret, enabled, projectSlug, label } = await readBody(req);
    if (!id || !whUrl) { send(res, 400, { error: 'id and url required' }); return; }
    webhooks.addConfig({ id, url: whUrl, events: events || '', secret: secret || '', enabled: enabled !== false, projectSlug: projectSlug || '' });
    send(res, 200, { ok: true });
    return;
  }

  // DELETE /webhooks/config — remove a webhook config
  if (method === 'DELETE' && path === '/webhooks/config') {
    const { id } = await readBody(req);
    if (!id) { send(res, 400, { error: 'id required' }); return; }
    webhooks.removeConfig(id);
    send(res, 200, { ok: true });
    return;
  }

  // POST /webhooks/configs/bulk — set all webhook configs at once (replaces existing)
  if (method === 'POST' && path === '/webhooks/configs/bulk') {
    const { configs } = await readBody(req);
    if (!Array.isArray(configs)) { send(res, 400, { error: 'configs array required' }); return; }
    webhooks.clearConfigs();
    for (const cfg of configs) {
      webhooks.addConfig(cfg);
    }
    send(res, 200, { ok: true, count: configs.length });
    return;
  }

  // GET /webhooks/configs — list current in-memory webhook configs
  if (method === 'GET' && path === '/webhooks/configs') {
    const list = [...webhooks.configs.values()].map(c => ({
      id: c.id,
      url: c.url,
      events: c.events.join(','),
      enabled: c.enabled,
      projectSlug: c.projectSlug,
    }));
    send(res, 200, list);
    return;
  }

  // GET /webhooks/deliveries — list recent delivery log entries
  if (method === 'GET' && path === '/webhooks/deliveries') {
    const status = url.searchParams.get('status') || undefined;
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const log = webhooks.getDeliveryLog({ status, limit });
    send(res, 200, log);
    return;
  }

  // POST /webhooks/test — emit a test event to a specific URL
  if (method === 'POST' && path === '/webhooks/test') {
    const { url: testUrl, secret, event: testEvent } = await readBody(req);
    if (!testUrl) { send(res, 400, { error: 'url required' }); return; }
    const testConfig = {
      id: 'test',
      url: testUrl,
      events: ['test'],
      secret: secret || '',
      enabled: true,
      projectSlug: 'test',
    };
    const payload = {
      event: testEvent || 'test',
      timestamp: new Date().toISOString(),
      project: { slug: 'test-project', name: 'Test Project' },
      data: { message: 'Test webhook from ldc daemon' },
    };
    try {
      await webhooks._deliver(testConfig, payload);
      send(res, 200, { ok: true, message: 'Test webhook sent' });
    } catch (err) {
      send(res, 500, { error: err.message });
    }
    return;
  }

  // POST /webhooks/emit — emit a webhook event from an external source (e.g., CLI sync)
  if (method === 'POST' && path === '/webhooks/emit') {
    const { event: eventType, project, data } = await readBody(req);
    if (!eventType) { send(res, 400, { error: 'event required' }); return; }
    webhooks.emit(eventType, project || { slug: 'unknown', name: 'unknown' }, data || {});
    send(res, 200, { ok: true });
    return;
  }

  // POST /docker-compose — run a docker compose action as a tracked process
  if (method === 'POST' && path === '/docker-compose') {
    const { action, compose_file_path, cwd, slug } = await readBody(req);
    if (!action || !compose_file_path || !slug) {
      send(res, 400, { error: 'action, compose_file_path, slug required' });
      return;
    }
    const workDir = cwd || dirname(compose_file_path);
    const safePath = compose_file_path.replace(/"/g, '\\"');
    const command = `docker compose -f "${safePath}" ${action}`;
    const cmdId = `docker:${action.replace(/[^a-z0-9]/gi, '-')}:${Date.now()}`;
    const result = startProc(slug, cmdId, command, workDir, `docker compose ${action}`, 'docker');
    if (result.error) {
      send(res, 409, result);
    } else {
      send(res, 200, { ok: true, cmdId, pid: result.pid });
    }
    return;
  }

  send(res, 404, { error: 'not found' });
}

// ── Start server ──────────────────────────────────────────────────────────────
export function startDaemon(port = DAEMON_PORT) {
  const server = createServer((req, res) => {
    handle(req, res).catch(err => send(res, 500, { error: err.message }));
  });

  // ── WebSocket server (shares the HTTP server) ──────────────────────────────
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    let subscribedKey = null;

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === 'subscribe' && msg.slug && msg.cmdId) {
        // Unsubscribe from previous key if any
        if (subscribedKey) {
          const prev = subscribers.get(subscribedKey);
          if (prev) { prev.delete(ws); if (prev.size === 0) subscribers.delete(subscribedKey); }
        }

        subscribedKey = procKey(msg.slug, msg.cmdId);

        // Register in subscriber set
        if (!subscribers.has(subscribedKey)) subscribers.set(subscribedKey, new Set());
        subscribers.get(subscribedKey).add(ws);

        // Send existing log backlog
        const entry = procs.get(subscribedKey);
        const backlog = entry ? entry.logs : [];
        ws.send(JSON.stringify({ type: 'backlog', key: subscribedKey, lines: backlog }));
      }

      if (msg.type === 'unsubscribe') {
        if (subscribedKey) {
          const subs = subscribers.get(subscribedKey);
          if (subs) { subs.delete(ws); if (subs.size === 0) subscribers.delete(subscribedKey); }
          subscribedKey = null;
        }
      }

      // Launch group status subscription
      if (msg.type === 'subscribe-launch-group' && msg.executionId) {
        const execId = msg.executionId;
        if (!launchGroupSubscribers.has(execId)) launchGroupSubscribers.set(execId, new Set());
        launchGroupSubscribers.get(execId).add(ws);
        // Send current state immediately
        const exec = launchGroupExecutions.get(execId);
        if (exec) {
          ws.send(JSON.stringify({ type: 'launch-group-status', execution: serializeExecution(exec) }));
        }
      }

      if (msg.type === 'unsubscribe-launch-group' && msg.executionId) {
        const subs = launchGroupSubscribers.get(msg.executionId);
        if (subs) { subs.delete(ws); if (subs.size === 0) launchGroupSubscribers.delete(msg.executionId); }
      }
    });

    ws.on('close', () => {
      if (subscribedKey) {
        const subs = subscribers.get(subscribedKey);
        if (subs) { subs.delete(ws); if (subs.size === 0) subscribers.delete(subscribedKey); }
      }
      // Clean up launch group subscriptions
      for (const [execId, subs] of launchGroupSubscribers) {
        subs.delete(ws);
        if (subs.size === 0) launchGroupSubscribers.delete(execId);
      }
    });
  });

  // Start background resource usage poller
  startResourcePoller();

  server.listen(port, '127.0.0.1', () => {
    console.log(`\x1b[32m✓\x1b[0m ldc daemon running on http://127.0.0.1:${port}`);
    console.log(`\x1b[90m  WebSocket log streaming enabled on ws://127.0.0.1:${port}\x1b[0m`);
    console.log(`\x1b[90m  Resource usage monitoring active (${numCpus} CPUs, ${Math.round(totalMemoryMB)}MB RAM)\x1b[0m`);
    console.log(`\x1b[90m  Press Ctrl+C to stop\x1b[0m`);

    // Emit daemon.start to all configured webhooks
    webhooks.emit('daemon.start', { slug: 'ldc-daemon', name: 'LDC Daemon' }, { pid: process.pid, port });
  });

  // Graceful shutdown: close WebSocket connections, kill all managed processes
  function shutdown() {
    console.log('\n\x1b[90m  Stopping all managed processes…\x1b[0m');

    // Emit daemon.stop (synchronous fire-and-forget)
    webhooks.emit('daemon.stop', { slug: 'ldc-daemon', name: 'LDC Daemon' }, { pid: process.pid });

    for (const ws of wss.clients) {
      try { ws.close(1001, 'daemon shutting down'); } catch {}
    }
    for (const [, entry] of procs) {
      if (entry.running) {
        try {
          if (process.platform === 'win32') {
            execSync(`taskkill /F /T /PID ${entry.child.pid}`, { stdio: 'ignore' });
          } else {
            try { process.kill(-entry.child.pid, 'SIGTERM'); } catch { entry.child.kill(); }
          }
        } catch {}
      }
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
