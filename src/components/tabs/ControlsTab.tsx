import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Cpu, Layers, Loader2, MemoryStick, Pencil, Play, Plus, RefreshCw, ScanLine, Square, Wifi, WifiOff, XCircle, Zap } from 'lucide-react';
import type { CommandProfile, LaunchGroupExecution, ProjectPort, ProjectScope, UptimeStats } from '../../lib/types';
import {
  checkHealth,
  checkPorts,
  detectProject,
  getActiveLaunchGroup,
  listProcesses,
  startLaunchGroup,
  startProcess,
  stopLaunchGroup,
  stopProcess,
  streamLaunchGroupStatus,
  streamLogs,
  type DetectedPort,
  type DetectResult,
  type DaemonLogEntry,
  type DaemonProcess,
} from '../../lib/daemon';
import { upsertRow, getEffectiveRepoPath, updateCommandExpectedPort } from '../../lib/api';
import { useCurrentMachine } from '../../lib/useCurrentMachine';
import { usePortConflicts } from '../../lib/usePortConflicts';
import { useUptimeTracker } from '../../lib/uptime';
import { Badge, Button, Card, CardHeader, Sparkline } from '../ui';
import { PortStatusSection } from '../PortStatusSection';
import { ansiToHtml } from '../../lib/ansi';

// ── Daemon status banner ──────────────────────────────────────────────────────

function DaemonBanner({ online }: { online: boolean | null }) {
  if (online === null) return null;
  if (online) {
    return (
      <div className="flex items-center gap-2 text-xs px-4 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
        <Wifi className="w-3.5 h-3.5 flex-shrink-0" />
        ldc daemon connected — processes are managed locally on your machine
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-xs px-4 py-2.5 rounded-lg bg-slate-800/60 border border-slate-700 text-slate-400">
      <WifiOff className="w-3.5 h-3.5 flex-shrink-0" />
      ldc daemon not running — start it with&nbsp;
      <code className="font-mono text-slate-300 bg-slate-950 px-1.5 py-0.5 rounded">ldc daemon</code>
      &nbsp;in the project directory
    </div>
  );
}

// ── Discovered ports card ─────────────────────────────────────────────────────

function DiscoveredPorts({
  newPorts,
  addedSet,
  onAdd,
  onAddAll,
}: {
  newPorts: DetectedPort[];
  addedSet: Set<number>;
  onAdd: (p: DetectedPort) => Promise<void>;
  onAddAll: () => Promise<void>;
}) {
  if (newPorts.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title="Discovered Ports"
        action={
          <Button onClick={onAddAll}>
            <Plus className="w-3 h-3 inline mr-1" />Add All ({newPorts.length})
          </Button>
        }
      />
      <div className="p-5 space-y-2">
        <p className="text-xs text-slate-500 mb-3">
          These ports were detected from your project files but aren't configured yet.
        </p>
        {newPorts.map(p => {
          const added = addedSet.has(p.port);
          return (
            <div key={p.port} className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded px-4 py-2.5 gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-sm font-mono font-medium text-slate-200 flex-shrink-0">:{p.port}</span>
                <span className="text-xs text-slate-500 truncate">{p.label}</span>
                <Badge tone="slate">{p.protocol}</Badge>
              </div>
              <Button
                variant={added ? 'ghost' : 'secondary'}
                disabled={added}
                onClick={() => onAdd(p)}
              >
                {added ? 'Added' : <><Plus className="w-3 h-3 inline mr-1" />Add</>}
              </Button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Resource usage gauge ──────────────────────────────────────────────────────

function ResourceBar({ value, max, tone }: { value: number; max: number; tone: 'blue' | 'amber' | 'rose' }) {
  const pct = Math.min(100, (value / max) * 100);
  const toneClasses = {
    blue: 'bg-blue-500',
    amber: 'bg-amber-500',
    rose: 'bg-rose-500',
  };
  return (
    <div className="w-16 h-1.5 rounded-full bg-slate-800 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${toneClasses[tone]}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function ResourceGauges({ proc }: { proc: DaemonProcess }) {
  if (!proc.running) return null;
  const hasCpu = proc.cpu != null;
  const hasMem = proc.memoryMB != null;
  if (!hasCpu && !hasMem) return null;

  const cpuTone = (proc.cpu ?? 0) > 80 ? 'rose' : (proc.cpu ?? 0) > 40 ? 'amber' : 'blue';
  const memTone = (proc.memoryMB ?? 0) > 1024 ? 'rose' : (proc.memoryMB ?? 0) > 512 ? 'amber' : 'blue';

  return (
    <div className="flex items-center gap-4 mt-2">
      {hasCpu && (
        <div className="flex items-center gap-1.5">
          <Cpu className="w-3 h-3 text-slate-600" />
          <ResourceBar value={proc.cpu!} max={100} tone={cpuTone} />
          <span className="text-[10px] font-mono text-slate-500 w-10 text-right">{proc.cpu!.toFixed(1)}%</span>
        </div>
      )}
      {hasMem && (
        <div className="flex items-center gap-1.5">
          <MemoryStick className="w-3 h-3 text-slate-600" />
          <ResourceBar value={proc.memoryMB!} max={2048} tone={memTone} />
          <span className="text-[10px] font-mono text-slate-500 w-14 text-right">
            {proc.memoryMB! >= 1024
              ? `${(proc.memoryMB! / 1024).toFixed(1)} GB`
              : `${proc.memoryMB!.toFixed(0)} MB`}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Per-command control card ──────────────────────────────────────────────────

function CommandCard({
  cmd,
  slug,
  daemonOnline,
  processes,
  portStatus,
  uptimeStats,
  onAction,
  onPortChange,
}: {
  cmd: CommandProfile;
  slug: string;
  daemonOnline: boolean;
  processes: DaemonProcess[];
  portStatus: Record<number, boolean>;
  uptimeStats?: UptimeStats;
  onAction: () => void;
  onPortChange?: (commandId: string, newPort: number) => Promise<void>;
}) {
  const [logs, setLogs] = useState<DaemonLogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editingPort, setEditingPort] = useState(false);
  const [portDraft, setPortDraft] = useState(cmd.expected_port ?? 0);
  const [portSaving, setPortSaving] = useState(false);
  const logsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPortDraft(cmd.expected_port ?? 0);
  }, [cmd.expected_port]);

  const proc = processes.find(p => p.slug === slug && p.cmdId === cmd.id);
  const running = proc?.running ?? false;

  // Auto-scroll log pane to bottom when new lines arrive
  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  // Stream logs via WebSocket when pane is open
  useEffect(() => {
    if (!showLogs || !daemonOnline) return;

    const close = streamLogs(slug, cmd.id, {
      onBacklog: (lines) => setLogs(lines),
      onLines: (newLines) => setLogs(prev => {
        const merged = [...prev, ...newLines];
        // Keep the last 500 lines to match daemon-side buffer
        return merged.length > 500 ? merged.slice(-500) : merged;
      }),
    });

    return close;
  }, [showLogs, daemonOnline, slug, cmd.id]);

  async function handleStart() {
    if (cmd.must_confirm && !confirm(`This command is flagged as requiring confirmation.\n\n${cmd.command}\n\nContinue?`)) return;
    setBusy(true);
    try {
      await startProcess({
        slug,
        cmdId: cmd.id,
        command: cmd.command,
        cwd: cmd.working_dir || undefined,
        name: cmd.name,
        kind: cmd.kind,
      });
      setShowLogs(true);
      onAction();
    } catch (e: any) {
      alert(`Failed to start: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    setBusy(true);
    try {
      await stopProcess(slug, cmd.id);
      onAction();
    } catch (e: any) {
      alert(`Failed to stop: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  const portLive = cmd.expected_port != null ? portStatus[cmd.expected_port] : undefined;

  async function savePort() {
    if (!onPortChange || portDraft <= 0 || portDraft > 65535) return;
    setPortSaving(true);
    try {
      await onPortChange(cmd.id, portDraft);
      setEditingPort(false);
    } finally {
      setPortSaving(false);
    }
  }

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          {/* Left: name, badges, command string */}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="text-sm font-medium text-slate-200">{cmd.name}</span>
              <Badge tone="blue">{cmd.kind}</Badge>
              {running
                ? <Badge tone="emerald">● running</Badge>
                : proc ? <Badge tone="slate">exited</Badge> : <Badge>idle</Badge>
              }
              {cmd.must_confirm && <Badge tone="amber">confirm</Badge>}
            </div>
            <code className="text-xs text-slate-500 font-mono block truncate">{cmd.command || '—'}</code>
            {cmd.working_dir && (
              <code className="text-[11px] text-slate-600 font-mono block truncate mt-0.5">in {cmd.working_dir}</code>
            )}
          </div>

          {/* Right: controls */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {running ? (
              <Button variant="danger" disabled={busy} onClick={handleStop}>
                <Square className="w-3 h-3 inline mr-1" />Stop
              </Button>
            ) : (
              <Button
                variant="secondary"
                disabled={busy || !cmd.command || !daemonOnline}
                onClick={handleStart}
              >
                <Play className="w-3 h-3 inline mr-1" />Start
              </Button>
            )}
            <Button variant="ghost" title="Toggle logs" onClick={() => setShowLogs(v => !v)}>
              {showLogs ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </Button>
          </div>
        </div>

        {/* Port liveness pill + uptime */}
        {cmd.expected_port != null && cmd.expected_port > 0 && (
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {editingPort ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-slate-600 uppercase tracking-wider">Port</span>
                <input
                  type="number"
                  value={portDraft}
                  onChange={e => setPortDraft(Number(e.target.value))}
                  className="w-20 px-2 py-0.5 text-xs font-mono bg-slate-900 border border-slate-700 rounded text-slate-100 focus:border-emerald-500 focus:outline-none"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') savePort(); if (e.key === 'Escape') { setEditingPort(false); setPortDraft(cmd.expected_port ?? 0); } }}
                />
                <Button variant="ghost" disabled={portSaving} onClick={savePort}>Save</Button>
                <Button variant="ghost" disabled={portSaving} onClick={() => { setEditingPort(false); setPortDraft(cmd.expected_port ?? 0); }}>Cancel</Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setPortDraft(cmd.expected_port ?? 0); setEditingPort(true); }}
                className="flex items-center gap-1 text-[10px] text-slate-500 uppercase tracking-wider hover:text-emerald-300 transition-colors group"
                title="Click to edit expected port"
              >
                Port {cmd.expected_port}
                <Pencil className="w-2.5 h-2.5 text-slate-600 group-hover:text-emerald-400" />
              </button>
            )}
            {portLive === true && <Badge tone="emerald">live</Badge>}
            {portLive === false && <Badge tone="rose">closed</Badge>}
            {portLive === undefined && <Badge>–</Badge>}
            {uptimeStats && uptimeStats.totalSamples > 0 && (
              <>
                <Sparkline
                  data={uptimeStats.samples.map(s => s.up)}
                  width={56}
                  height={12}
                />
                <span className={`text-[10px] font-mono ${uptimeStats.uptimePct >= 99 ? 'text-emerald-400' : uptimeStats.uptimePct >= 95 ? 'text-amber-400' : 'text-rose-400'}`}>
                  {uptimeStats.uptimePct}%
                </span>
                {uptimeStats.isFlapping && (
                  <Badge tone="amber">
                    <Zap className="w-2.5 h-2.5" />
                    flapping
                  </Badge>
                )}
              </>
            )}
          </div>
        )}

        {/* Resource usage gauges (CPU / Memory) */}
        {proc && <ResourceGauges proc={proc} />}
      </div>

      {/* Log pane */}
      {showLogs && (
        <div
          ref={logsRef}
          className="border-t border-slate-800 bg-black/40 px-4 py-3 h-52 overflow-y-auto"
        >
          {logs.length === 0 ? (
            <span className="text-xs text-slate-600 italic">No logs yet</span>
          ) : (
            logs.map((l, i) => (
              <div
                key={i}
                className={`text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-all ${
                  l.err ? 'text-rose-400' : 'text-slate-400'
                }`}
                dangerouslySetInnerHTML={{ __html: ansiToHtml(l.text) }}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Launch group quick-run card ───────────────────────────────────────────

function LaunchGroupCard({
  group,
  scope,
  daemonOnline,
}: {
  group: ProjectScope['launch_groups'][0];
  scope: ProjectScope;
  daemonOnline: boolean;
}) {
  const [execution, setExecution] = useState<LaunchGroupExecution | null>(null);
  const [launching, setLaunching] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const steps = scope.launch_group_steps
    .filter(s => s.launch_group_id === group.id)
    .sort((a, b) => a.sort_order - b.sort_order);

  const isRunning = execution?.status === 'running';

  // Check for active execution on mount
  useEffect(() => {
    if (!daemonOnline) return;
    getActiveLaunchGroup(group.id).then(exec => {
      if (exec) setExecution(exec);
    }).catch(() => {});
  }, [group.id, daemonOnline]);

  // Subscribe to execution status via WebSocket
  useEffect(() => {
    if (!execution?.executionId || execution.status !== 'running') return;
    const cleanup = streamLaunchGroupStatus(execution.executionId, {
      onStatus: (exec) => setExecution(exec),
    });
    return cleanup;
  }, [execution?.executionId, execution?.status]);

  const handleRun = useCallback(async () => {
    if (steps.length === 0 || !daemonOnline) return;
    setLaunching(true);
    try {
      const stepsPayload = steps.map(step => {
        const cmd = scope.commands.find(c => c.id === step.command_id);
        return {
          stepId: step.id,
          label: step.label || cmd?.name || 'Step',
          commandId: step.command_id,
          command: cmd?.command || null,
          cwd: cmd?.working_dir || '',
          kind: cmd?.kind || 'dev',
          waitForPort: step.wait_for_port,
          waitForHealth: step.wait_for_health,
          delayMs: step.delay_ms,
        };
      });
      const result = await startLaunchGroup({
        slug: scope.project.slug,
        launchGroupId: group.id,
        launchGroupName: group.name,
        steps: stepsPayload,
      });
      setExecution({
        executionId: result.executionId,
        launchGroupId: group.id,
        launchGroupName: group.name,
        slug: scope.project.slug,
        status: 'running',
        steps: stepsPayload.map(s => ({
          stepId: s.stepId, label: s.label, commandId: s.commandId, status: 'pending' as const,
        })),
        startedAt: Date.now(),
        currentStepIndex: 0,
      });
    } catch (e: any) {
      alert(`Failed to start: ${e.message}`);
    } finally {
      setLaunching(false);
    }
  }, [steps, scope, group, daemonOnline]);

  const handleStop = useCallback(async () => {
    if (!execution?.executionId) return;
    setStopError(null);
    try {
      await stopLaunchGroup(execution.executionId);
    } catch (e: any) {
      setStopError(e?.message || 'Failed to stop launch group');
    }
  }, [execution?.executionId]);

  const completedCount = execution?.steps.filter(s => s.status === 'completed').length ?? 0;
  const totalSteps = execution?.steps.length ?? steps.length;

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <Layers className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span className="text-sm font-medium text-slate-200 truncate">{group.name}</span>
            <Badge tone="slate">{steps.length} step{steps.length !== 1 ? 's' : ''}</Badge>
          </div>
          {group.description && (
            <p className="text-[11px] text-slate-500 truncate">{group.description}</p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isRunning && (
            <span className="text-[10px] text-blue-300 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              {completedCount}/{totalSteps}
            </span>
          )}
          {execution?.status === 'completed' && (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          )}
          {execution?.status === 'failed' && (
            <XCircle className="w-4 h-4 text-rose-400" />
          )}

          {isRunning ? (
            <Button variant="danger" onClick={handleStop}>
              <Square className="w-3 h-3 inline mr-1" />Stop
            </Button>
          ) : (
            <Button
              variant="secondary"
              disabled={steps.length === 0 || !daemonOnline || launching}
              onClick={handleRun}
            >
              <Play className="w-3 h-3 inline mr-1" />{launching ? 'Starting...' : 'Run'}
            </Button>
          )}
        </div>
      </div>
      {stopError && (
        <div className="mt-2 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded px-3 py-2">
          Stop failed: {stopError}
        </div>
      )}
    </div>
  );
}

function LaunchGroupsQuickRun({ scope, daemonOnline }: { scope: ProjectScope; daemonOnline: boolean }) {
  if (scope.launch_groups.length === 0) return null;

  return (
    <Card>
      <CardHeader title="Launch Groups" />
      <div className="p-5 space-y-3">
        {scope.launch_groups.map(group => (
          <LaunchGroupCard key={group.id} group={group} scope={scope} daemonOnline={daemonOnline} />
        ))}
      </div>
    </Card>
  );
}

// ── Controls tab ──────────────────────────────────────────────────────────────

export function ControlsTab({ scope, onChange }: { scope: ProjectScope; onChange: () => void }) {
  const [online, setOnline] = useState<boolean | null>(null);
  const [processes, setProcesses] = useState<DaemonProcess[]>([]);
  const [portStatus, setPortStatus] = useState<Record<number, boolean>>({});
  const [detectResult, setDetectResult] = useState<DetectResult | null>(null);
  const [addedPorts, setAddedPorts] = useState<Set<number>>(new Set());
  const [scanning, setScanning] = useState(false);

  const currentMachine = useCurrentMachine();
  const { conflicts: allConflicts, refresh: refreshConflicts } = usePortConflicts(scope.ports.length);
  const { statsMap: uptimeMap, getStats: getUptimeStats } = useUptimeTracker(portStatus);

  // Filter conflicts to only those involving this project's ports
  const localConflicts = useMemo(() => {
    const projectId = scope.project.id;
    return allConflicts.filter(c => c.projects.some(p => p.project_id === projectId));
  }, [allConflicts, scope.project.id]);

  const slug = scope.project.slug;
  const repoPath = getEffectiveRepoPath(scope, currentMachine);

  // Deduplicated list of all ports to check liveness for
  const allPorts = useMemo(() => {
    const set = new Set<number>();
    scope.ports.forEach(p => p.port && set.add(p.port));
    scope.commands.forEach(c => c.expected_port && set.add(c.expected_port));
    return [...set];
  }, [scope.ports, scope.commands]);

  // Ports detected by daemon that aren't already in the project
  const newPorts = useMemo<DetectedPort[]>(() => {
    if (!detectResult) return [];
    const existing = new Set(scope.ports.map(p => p.port));
    return detectResult.ports.filter(p => !existing.has(p.port) && !addedPorts.has(p.port));
  }, [detectResult, scope.ports, addedPorts]);

  async function refreshProcesses() {
    try { setProcesses(await listProcesses()); } catch {}
  }

  async function refreshPorts() {
    if (allPorts.length === 0) return;
    try { setPortStatus(await checkPorts(allPorts)); } catch {}
  }

  async function refresh() {
    await Promise.all([refreshProcesses(), refreshPorts()]);
  }

  async function runDetect() {
    if (!repoPath) return;
    setScanning(true);
    try {
      setDetectResult(await detectProject(repoPath));
    } catch {
      // daemon may not have the repo path accessible; silently ignore
    } finally {
      setScanning(false);
    }
  }

  // Poll health every 3 s; auto-detect on first connect
  useEffect(() => {
    let cancelled = false;
    let detected = false;

    async function poll() {
      try {
        await checkHealth();
        if (cancelled) return;
        setOnline(prev => {
          if (!prev && !detected && repoPath) {
            detected = true;
            runDetect();
          }
          return true;
        });
        await refresh();
      } catch {
        if (!cancelled) setOnline(false);
      }
    }

    poll();
    const id = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, allPorts.join(','), repoPath]);

  async function addPort(p: DetectedPort) {
    await upsertRow<ProjectPort>('project_ports', {
      project_id: scope.project.id,
      label: p.label,
      port: p.port,
      protocol: p.protocol,
      local_url: p.local_url,
      health_url: p.health_url || '',
      notes: 'auto-detected',
    } as any);
    setAddedPorts(prev => new Set([...prev, p.port]));
    onChange();
  }

  async function addAllPorts() {
    for (const p of newPorts) {
      if (!addedPorts.has(p.port)) await addPort(p);
    }
  }

  async function updateCommandPort(commandId: string, newPort: number) {
    await updateCommandExpectedPort(commandId, newPort);
    onChange();
    refreshConflicts();
  }

  return (
    <div className="space-y-5">
      <DaemonBanner online={online} />

      {/* Launch groups quick-run */}
      {online && <LaunchGroupsQuickRun scope={scope} daemonOnline={online === true} />}

      {/* Discovered ports from auto-detection */}
      {online && <DiscoveredPorts
        newPorts={newPorts}
        addedSet={addedPorts}
        onAdd={addPort}
        onAddAll={addAllPorts}
      />}

      <Card>
        <CardHeader
          title="Commands"
          action={
            <div className="flex gap-2">
              {online && repoPath && (
                <Button variant="ghost" disabled={scanning} onClick={runDetect}>
                  <ScanLine className="w-3 h-3 inline mr-1" />
                  {scanning ? 'Scanning…' : 'Re-scan'}
                </Button>
              )}
              <Button variant="ghost" onClick={refresh}>
                <RefreshCw className="w-3 h-3 inline mr-1" />Refresh
              </Button>
            </div>
          }
        />
        <div className="p-5 space-y-3">
          {scope.commands.length === 0 ? (
            <div className="text-sm text-slate-500">
              No commands configured. Add commands in the Commands tab.
            </div>
          ) : (
            scope.commands.map(cmd => (
              <CommandCard
                key={cmd.id}
                cmd={cmd}
                slug={slug}
                daemonOnline={online === true}
                processes={processes}
                portStatus={portStatus}
                uptimeStats={cmd.expected_port ? getUptimeStats(cmd.expected_port) : undefined}
                onAction={() => {
                  setTimeout(refreshProcesses, 500);
                  setTimeout(refreshPorts, 1000);
                }}
                onPortChange={updateCommandPort}
              />
            ))
          )}
        </div>
      </Card>

      <PortStatusSection
        scope={scope}
        portStatus={portStatus}
        uptimeMap={uptimeMap}
        localConflicts={localConflicts}
        onChange={onChange}
        onConflictsRefresh={refreshConflicts}
      />
    </div>
  );
}
