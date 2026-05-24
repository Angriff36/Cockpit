import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, ArrowUp, ArrowDown, Play, Clock, Wifi, Square, Loader2, CheckCircle2, XCircle, AlertTriangle, FileJson } from 'lucide-react';
import type { ProjectScope, LaunchGroup, LaunchGroupStep, CommandProfile, LaunchGroupExecution, LaunchGroupStepStatus } from '../../lib/types';
import { upsertRow, deleteRow } from '../../lib/api';
import { startLaunchGroup, stopLaunchGroup, streamLaunchGroupStatus, getActiveLaunchGroup } from '../../lib/daemon';
import { Card, Field, Input, Select, Button, Badge } from '../ui';
import { JsonImportPanel } from '../JsonImportPanel';

// Combined import template — paste commands and launch_groups in a single JSON.
// command_name on a step is resolved against (1) commands defined above, then
// (2) command profiles already in this project. Unresolved references are rejected
// up-front with a precise error.
const LAUNCH_GROUP_TEMPLATE = {
  commands: [
    {
      name: 'capsule_restart_dev_popos',
      kind: 'dev',
      command: "ssh -t oc@pop-os '/home/oc/projects/capsule-pro/tools/restart-capsule-dev.sh'",
      working_dir: '',
      notes: 'Restarts Capsule Pro dev stack on Pop!_OS over SSH.',
    },
  ],
  launch_groups: [
    {
      name: 'Restart Capsule Pro Dev Stack',
      description: 'Restart Capsule Pro app/API on Pop!_OS over SSH. Script owns all verification.',
      steps: [
        {
          label: 'Restart dev stack on Pop!_OS',
          command_name: 'capsule_restart_dev_popos',
          wait_for_port: null,
          delay_ms: 0,
        },
      ],
    },
  ],
};

// ── Step status indicator ─────────────────────────────────────────────────

const STEP_STATUS_CONFIG: Record<LaunchGroupStepStatus['status'], { icon: typeof Play; tone: 'slate' | 'emerald' | 'amber' | 'rose' | 'blue'; label: string }> = {
  pending:         { icon: Clock,         tone: 'slate',   label: 'Pending' },
  waiting_port:    { icon: Wifi,          tone: 'amber',   label: 'Waiting for port' },
  waiting_health:  { icon: Wifi,          tone: 'amber',   label: 'Health check' },
  delaying:        { icon: Clock,         tone: 'amber',   label: 'Delaying' },
  starting:        { icon: Loader2,       tone: 'blue',    label: 'Starting' },
  running:         { icon: Play,          tone: 'blue',    label: 'Running' },
  completed:       { icon: CheckCircle2,  tone: 'emerald', label: 'Done' },
  failed:          { icon: XCircle,       tone: 'rose',    label: 'Failed' },
  skipped:         { icon: AlertTriangle, tone: 'slate',   label: 'Skipped' },
};

function StepStatusBadge({ stepStatus }: { stepStatus: LaunchGroupStepStatus }) {
  const config = STEP_STATUS_CONFIG[stepStatus.status];
  const Icon = config.icon;
  const isAnimated = ['waiting_port', 'waiting_health', 'starting', 'running', 'delaying'].includes(stepStatus.status);

  return (
    <span className="flex items-center gap-1.5">
      <Badge tone={config.tone}>
        <Icon className={`w-3 h-3 inline mr-1 ${isAnimated ? 'animate-spin' : ''}`} />
        {config.label}
        {stepStatus.status === 'waiting_port' && stepStatus.waitingForPort && ` :${stepStatus.waitingForPort}`}
        {stepStatus.status === 'delaying' && stepStatus.delayRemaining != null && ` ${Math.ceil(stepStatus.delayRemaining / 1000)}s`}
      </Badge>
      {stepStatus.error && (
        <span className="text-[10px] text-rose-400 truncate max-w-[200px]">{stepStatus.error}</span>
      )}
    </span>
  );
}

// ── Execution status panel ───────────────────────────────────────────────

function ExecutionPanel({
  execution,
  onStop,
}: {
  execution: LaunchGroupExecution;
  onStop: () => void;
}) {
  const isRunning = execution.status === 'running';

  return (
    <div className="border-t border-slate-800 px-5 py-4 bg-slate-950/60">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Execution</span>
          <Badge tone={
            execution.status === 'running' ? 'blue' :
            execution.status === 'completed' ? 'emerald' :
            execution.status === 'failed' ? 'rose' : 'amber'
          }>
            {execution.status}
          </Badge>
        </div>
        {isRunning && (
          <Button variant="danger" onClick={onStop}>
            <Square className="w-3 h-3 inline mr-1" />Abort
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        {execution.steps.map((step, i) => (
          <div
            key={step.stepId}
            className={`flex items-center gap-3 px-3 py-1.5 rounded text-sm ${
              i === execution.currentStepIndex && isRunning ? 'bg-slate-800/60 border border-slate-700' : ''
            }`}
          >
            <span className="text-[10px] font-mono text-slate-600 w-5 text-right shrink-0">{i + 1}</span>
            <span className="text-slate-300 flex-1 truncate">{step.label || 'Step'}</span>
            <StepStatusBadge stepStatus={step} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Step row ─────────────────────────────────────────────────────────────────

function StepRow({
  step,
  commands,
  isFirst,
  isLast,
  onSave,
  onRemove,
  onMove,
}: {
  step: LaunchGroupStep;
  commands: CommandProfile[];
  isFirst: boolean;
  isLast: boolean;
  onSave: (s: LaunchGroupStep) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: 'up' | 'down') => void;
}) {
  const [s, setS] = useState(step);
  const [expanded, setExpanded] = useState(false);

  function save() { onSave(s); }

  const cmd = commands.find(c => c.id === s.command_id);

  return (
    <div className="flex items-stretch gap-0">
      {/* Timeline connector */}
      <div className="flex flex-col items-center w-8 shrink-0">
        <div className={`w-px flex-1 ${isFirst ? 'bg-transparent' : 'bg-slate-700'}`} />
        <div className="w-3 h-3 rounded-full border-2 border-emerald-500 bg-slate-950 shrink-0 z-10" />
        <div className={`w-px flex-1 ${isLast ? 'bg-transparent' : 'bg-slate-700'}`} />
      </div>

      {/* Step card */}
      <div className={`flex-1 border rounded transition-colors mb-2 ${expanded ? 'border-slate-700 bg-slate-900/60' : 'border-slate-800/60 bg-slate-950/40 hover:border-slate-700/60'}`}>
        <div className="flex items-center gap-3 px-3 py-2">
          <button onClick={() => setExpanded(e => !e)} className="shrink-0 text-slate-600 hover:text-slate-400 transition-colors">
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 shrink-0">#{s.sort_order + 1}</span>
          <span className="text-sm text-slate-200 min-w-0 truncate flex-1">
            {s.label || cmd?.name || 'Untitled step'}
          </span>
          {cmd && <Badge tone="blue">{cmd.kind}</Badge>}
          {s.delay_ms > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-amber-400">
              <Clock className="w-3 h-3" />{s.delay_ms}ms
            </span>
          )}
          {s.wait_for_port && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400">
              <Wifi className="w-3 h-3" />:{s.wait_for_port}
            </span>
          )}
          <div className="flex gap-0.5 shrink-0 ml-1">
            <button disabled={isFirst} onClick={() => onMove(s.id, 'up')} className="p-1 rounded text-slate-600 hover:text-slate-300 disabled:opacity-30 transition-colors">
              <ArrowUp className="w-3 h-3" />
            </button>
            <button disabled={isLast} onClick={() => onMove(s.id, 'down')} className="p-1 rounded text-slate-600 hover:text-slate-300 disabled:opacity-30 transition-colors">
              <ArrowDown className="w-3 h-3" />
            </button>
            <button onClick={() => onRemove(s.id)} className="p-1 rounded text-slate-600 hover:text-rose-400 transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {expanded && (
          <div className="px-4 pb-4 pt-1 border-t border-slate-800">
            <div className="grid grid-cols-12 gap-3 mt-3">
              <div className="col-span-4">
                <Field label="Label">
                  <Input value={s.label} onChange={e => setS({ ...s, label: e.target.value })} onBlur={save} placeholder="Step label" />
                </Field>
              </div>
              <div className="col-span-8">
                <Field label="Command">
                  <Select
                    value={s.command_id || ''}
                    onChange={e => {
                      const u = { ...s, command_id: e.target.value || null };
                      setS(u);
                      onSave(u);
                    }}
                  >
                    <option value="">— none —</option>
                    {commands.map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.kind})</option>
                    ))}
                  </Select>
                </Field>
              </div>
              {/* Resolved command preview — shows the actual shell string behind the selected profile. */}
              {cmd && (
                <div className="col-span-12 -mt-1">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                    Resolved command
                  </div>
                  <div className="bg-slate-950/80 border border-slate-800 rounded px-3 py-2 font-mono text-xs text-slate-300 break-all whitespace-pre-wrap">
                    {cmd.command || <span className="text-slate-600 italic">(empty command)</span>}
                  </div>
                  {(cmd.working_dir || cmd.expected_port || cmd.must_confirm) && (
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-slate-500 mt-1">
                      {cmd.working_dir && <span>cwd: <span className="font-mono text-slate-400">{cmd.working_dir}</span></span>}
                      {cmd.expected_port != null && <span>expected port: <span className="font-mono text-slate-400">{cmd.expected_port}</span></span>}
                      {cmd.must_confirm && <span className="text-amber-400">requires confirmation</span>}
                    </div>
                  )}
                </div>
              )}
              <div className="col-span-2">
                <Field label="Delay (ms)">
                  <Input
                    type="number"
                    value={s.delay_ms}
                    onChange={e => setS({ ...s, delay_ms: Number(e.target.value) || 0 })}
                    onBlur={save}
                    placeholder="0"
                  />
                </Field>
              </div>
              <div className="col-span-2">
                <Field label="Wait for port">
                  <Input
                    type="number"
                    value={s.wait_for_port ?? ''}
                    onChange={e => setS({ ...s, wait_for_port: e.target.value ? Number(e.target.value) : null })}
                    onBlur={save}
                    placeholder="e.g. 5432"
                  />
                </Field>
              </div>
              <div className="col-span-6">
                <Field label="Wait for health URL">
                  <Input
                    className="font-mono"
                    value={s.wait_for_health}
                    onChange={e => setS({ ...s, wait_for_health: e.target.value })}
                    onBlur={save}
                    placeholder="http://127.0.0.1:3000/health"
                  />
                </Field>
              </div>
              <div className="col-span-4">
                <Field label="Acceptable HTTP statuses">
                  <Input
                    className="font-mono"
                    value={(s.acceptable_statuses ?? []).join(', ')}
                    onChange={e => {
                      const parsed = e.target.value
                        .split(',')
                        .map(tok => Number(tok.trim()))
                        .filter(n => Number.isFinite(n) && n > 0);
                      setS({ ...s, acceptable_statuses: parsed });
                    }}
                    onBlur={save}
                    placeholder="200, 302, 401"
                  />
                </Field>
              </div>
              <div className="col-span-2">
                <Field label="Timeout (ms)">
                  <Input
                    type="number"
                    value={s.timeout_ms ?? ''}
                    onChange={e => setS({ ...s, timeout_ms: e.target.value ? Number(e.target.value) : null })}
                    onBlur={save}
                    placeholder="120000"
                  />
                </Field>
              </div>
              <div className="col-span-6 flex items-end">
                <label className="flex items-center gap-2 text-xs text-slate-300 select-none">
                  <input
                    type="checkbox"
                    checked={s.continue_on_failure}
                    onChange={e => {
                      const u = { ...s, continue_on_failure: e.target.checked };
                      setS(u);
                      onSave(u);
                    }}
                    className="rounded border-slate-700 bg-slate-900"
                  />
                  Continue group if this step fails
                </label>
              </div>
              <div className="col-span-6">
                <Field label="Notes">
                  <Input
                    value={s.notes}
                    onChange={e => setS({ ...s, notes: e.target.value })}
                    onBlur={save}
                    placeholder="Optional notes"
                  />
                </Field>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Group card ───────────────────────────────────────────────────────────

function GroupCard({
  group,
  steps,
  commands,
  slug,
  daemonOnline,
  onSaveGroup,
  onRemoveGroup,
  onSaveStep,
  onRemoveStep,
  onAddStep,
  onMoveStep,
}: {
  group: LaunchGroup;
  steps: LaunchGroupStep[];
  commands: CommandProfile[];
  slug: string;
  daemonOnline: boolean;
  onSaveGroup: (g: LaunchGroup) => void;
  onRemoveGroup: (id: string) => void;
  onSaveStep: (s: LaunchGroupStep) => void;
  onRemoveStep: (id: string) => void;
  onAddStep: (groupId: string) => void;
  onMoveStep: (stepId: string, dir: 'up' | 'down') => void;
}) {
  const [g, setG] = useState(group);
  const [open, setOpen] = useState(true);
  const [editHeader, setEditHeader] = useState(false);
  const [execution, setExecution] = useState<LaunchGroupExecution | null>(null);
  const [launching, setLaunching] = useState(false);

  function save() { onSaveGroup(g); }

  const sorted = [...steps].sort((a, b) => a.sort_order - b.sort_order);
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
    if (!execution?.executionId) return;
    if (execution.status !== 'running') return;

    const cleanup = streamLaunchGroupStatus(execution.executionId, {
      onStatus: (exec) => setExecution(exec),
    });
    return cleanup;
  }, [execution?.executionId, execution?.status]);

  const handleRun = useCallback(async () => {
    if (sorted.length === 0 || !daemonOnline) return;
    setLaunching(true);
    try {
      const stepsPayload = sorted.map(step => {
        const cmd = commands.find(c => c.id === step.command_id);
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
          acceptableStatuses: step.acceptable_statuses,
          timeoutMs: step.timeout_ms,
          continueOnFailure: step.continue_on_failure,
        };
      });

      const result = await startLaunchGroup({
        slug,
        launchGroupId: group.id,
        launchGroupName: group.name,
        steps: stepsPayload,
      });

      setExecution({
        executionId: result.executionId,
        launchGroupId: group.id,
        launchGroupName: group.name,
        slug,
        status: 'running',
        steps: stepsPayload.map(s => ({
          stepId: s.stepId,
          label: s.label,
          commandId: s.commandId,
          status: 'pending' as const,
        })),
        startedAt: Date.now(),
        currentStepIndex: 0,
      });
    } catch (e: any) {
      alert(`Failed to start launch group: ${e.message}`);
    } finally {
      setLaunching(false);
    }
  }, [sorted, commands, slug, group, daemonOnline]);

  const handleStop = useCallback(async () => {
    if (!execution?.executionId) return;
    try {
      await stopLaunchGroup(execution.executionId);
    } catch (e: any) {
      alert(`Failed to abort: ${e.message}`);
    }
  }, [execution?.executionId]);

  return (
    <Card className="overflow-hidden">
      {/* Group header */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-800">
        <button onClick={() => setOpen(o => !o)} className="shrink-0 text-slate-500 hover:text-slate-300 transition-colors">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        {editHeader ? (
          <div className="flex-1 flex items-center gap-2">
            <Input
              value={g.name}
              onChange={e => setG({ ...g, name: e.target.value })}
              onBlur={() => { save(); setEditHeader(false); }}
              autoFocus
              className="!py-1"
              placeholder="Group name"
            />
            <Input
              value={g.description}
              onChange={e => setG({ ...g, description: e.target.value })}
              onBlur={() => { save(); setEditHeader(false); }}
              className="!py-1"
              placeholder="Description"
            />
          </div>
        ) : (
          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setEditHeader(true)}>
            <h3 className="text-sm font-semibold text-slate-100 truncate">{g.name || 'Untitled group'}</h3>
            {g.description && <p className="text-xs text-slate-500 truncate">{g.description}</p>}
          </div>
        )}

        <Badge tone="slate">{sorted.length} step{sorted.length !== 1 ? 's' : ''}</Badge>

        <div className="flex gap-1 shrink-0">
          {isRunning ? (
            <Button variant="danger" onClick={handleStop} title="Abort execution">
              <Square className="w-3 h-3 inline mr-1" />Abort
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={sorted.length === 0 || !daemonOnline || launching}
              onClick={handleRun}
              title={!daemonOnline ? 'Daemon not connected' : sorted.length === 0 ? 'Add steps first' : 'Run launch group'}
            >
              <Play className="w-3 h-3 inline mr-1" />{launching ? 'Starting...' : 'Run'}
            </Button>
          )}
          <Button variant="ghost" onClick={() => onAddStep(group.id)} title="Add step">
            <Plus className="w-3 h-3" />
          </Button>
          <button onClick={() => onRemoveGroup(group.id)} className="p-1 rounded text-slate-600 hover:text-rose-400 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Steps */}
      {open && (
        <div className="px-5 py-4">
          {sorted.length === 0 ? (
            <div className="text-sm text-slate-500 text-center py-6">
              No steps yet. Add steps to define the startup sequence.
            </div>
          ) : (
            sorted.map((step, i) => (
              <StepRow
                key={step.id}
                step={step}
                commands={commands}
                isFirst={i === 0}
                isLast={i === sorted.length - 1}
                onSave={onSaveStep}
                onRemove={onRemoveStep}
                onMove={onMoveStep}
              />
            ))
          )}
        </div>
      )}

      {/* Execution status panel */}
      {execution && execution.status !== 'completed' && (
        <ExecutionPanel execution={execution} onStop={handleStop} />
      )}

      {/* Completed/failed summary */}
      {execution && (execution.status === 'completed' || execution.status === 'failed' || execution.status === 'aborted') && (
        <div className="border-t border-slate-800 px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {execution.status === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            {execution.status === 'failed' && <XCircle className="w-4 h-4 text-rose-400" />}
            {execution.status === 'aborted' && <AlertTriangle className="w-4 h-4 text-amber-400" />}
            <span className="text-xs text-slate-400">
              {execution.status === 'completed' && 'All steps completed successfully'}
              {execution.status === 'failed' && `Failed at step ${execution.currentStepIndex + 1}`}
              {execution.status === 'aborted' && 'Execution aborted'}
            </span>
          </div>
          <button
            onClick={() => setExecution(null)}
            className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}
    </Card>
  );
}

// ── Tab ──────────────────────────────────────────────────────────────────────

export function LaunchGroupsTab({ scope, onChange, daemonOnline = false }: { scope: ProjectScope; onChange: () => void; daemonOnline?: boolean }) {
  const [importMode, setImportMode] = useState(false);

  async function importGroups(items: unknown[]) {
    // ── Shape detection ─────────────────────────────────────────────────────
    // Accepts either:
    //   1) combined: { "commands": [...], "launch_groups": [...] }
    //   2) legacy:   [<launch_group>, ...]   (a bare array of launch groups)
    let commandsIn: unknown[] = [];
    let groupsIn: unknown[] = [];
    if (
      items.length === 1 &&
      items[0] !== null &&
      typeof items[0] === 'object' &&
      !Array.isArray(items[0]) &&
      (Array.isArray((items[0] as any).commands) || Array.isArray((items[0] as any).launch_groups))
    ) {
      const o = items[0] as { commands?: unknown[]; launch_groups?: unknown[] };
      commandsIn = Array.isArray(o.commands) ? o.commands : [];
      groupsIn = Array.isArray(o.launch_groups) ? o.launch_groups : [];
    } else {
      groupsIn = items;
    }

    // ── Validate commands ───────────────────────────────────────────────────
    for (let i = 0; i < commandsIn.length; i++) {
      const c = commandsIn[i] as any;
      if (typeof c !== 'object' || c === null) throw new Error(`Command ${i + 1}: must be an object`);
      if (typeof c.name !== 'string' || !c.name.trim()) throw new Error(`Command ${i + 1}: "name" (string) is required`);
      if (typeof c.command !== 'string' || !c.command.trim()) throw new Error(`Command ${i + 1}: "command" (string) is required`);
    }

    // ── Validate launch groups ──────────────────────────────────────────────
    for (let i = 0; i < groupsIn.length; i++) {
      const g = groupsIn[i] as any;
      if (typeof g !== 'object' || g === null) throw new Error(`Launch group ${i + 1}: must be an object`);
      if (typeof g.name !== 'string' || !g.name.trim()) throw new Error(`Launch group ${i + 1}: "name" (string) is required`);
      if (g.steps !== undefined && !Array.isArray(g.steps)) throw new Error(`Launch group ${i + 1}: "steps" must be an array`);
    }

    // ── Resolve command_name references up-front ────────────────────────────
    // Fail before any DB writes if a step references a command profile that
    // neither exists in this project nor appears in the "commands" array of
    // the same import. This is the rule the user enforced: launch groups
    // should not silently depend on hidden data.
    const incomingNames = new Set<string>(
      commandsIn.map(c => String((c as any).name).trim().toLowerCase()),
    );
    const existingNames = new Set<string>(
      scope.commands.map(c => c.name.trim().toLowerCase()),
    );
    const missing: string[] = [];
    for (let gi = 0; gi < groupsIn.length; gi++) {
      const g = groupsIn[gi] as any;
      const rawSteps: any[] = g.steps || [];
      for (let si = 0; si < rawSteps.length; si++) {
        const s = rawSteps[si];
        if (s.command_id) continue;          // resolved by ID — skip name check
        if (!s.command_name) continue;       // step with no command — allowed (pure gate/delay)
        const lc = String(s.command_name).trim().toLowerCase();
        if (!incomingNames.has(lc) && !existingNames.has(lc)) {
          missing.push(`Launch group "${g.name}" step #${si + 1}: command_name "${s.command_name}" not found`);
        }
      }
    }
    if (missing.length > 0) {
      throw new Error(
        'Missing command profiles — add them under "commands" in the same JSON, or create them first in the Commands tab:\n• ' +
          missing.join('\n• '),
      );
    }

    // ── Phase 1: upsert commands (idempotent by name within this project) ──
    const nameToId = new Map<string, string>();
    for (const c of scope.commands) nameToId.set(c.name.trim().toLowerCase(), c.id);

    for (const raw of commandsIn) {
      const c = raw as any;
      const lc = String(c.name).trim().toLowerCase();
      const existing = scope.commands.find(x => x.name.trim().toLowerCase() === lc);
      const payload: Partial<CommandProfile> & { id?: string } = {
        ...(existing ? { id: existing.id } : {}),
        project_id: scope.project.id,
        name: String(c.name).trim(),
        kind: typeof c.kind === 'string' && c.kind.trim() ? c.kind.trim() : 'dev',
        command: String(c.command).trim(),
        working_dir: typeof c.working_dir === 'string' ? c.working_dir : '',
        notes: typeof c.notes === 'string' ? c.notes : '',
        expected_port: typeof c.expected_port === 'number' ? c.expected_port : null,
        health_url: typeof c.health_url === 'string' ? c.health_url : '',
        must_confirm: typeof c.must_confirm === 'boolean' ? c.must_confirm : false,
      };
      const saved = await upsertRow<CommandProfile>('command_profiles', payload as any);
      nameToId.set(lc, saved.id);
    }

    // ── Phase 2: upsert launch groups + steps ──────────────────────────────
    for (const item of groupsIn) {
      const g = item as any;
      const saved = await upsertRow<LaunchGroup>('launch_groups', {
        project_id: scope.project.id,
        name: g.name.trim(),
        description: g.description?.trim() || '',
      } as any);
      const rawSteps: any[] = g.steps || [];
      for (let i = 0; i < rawSteps.length; i++) {
        const s = rawSteps[i];
        let commandId: string | null = s.command_id ?? null;
        if (!commandId && s.command_name) {
          commandId = nameToId.get(String(s.command_name).trim().toLowerCase()) ?? null;
        }
        const acceptableStatuses = Array.isArray(s.acceptable_statuses)
          ? s.acceptable_statuses.filter((n: unknown) => typeof n === 'number')
          : undefined;
        await upsertRow<LaunchGroupStep>('launch_group_steps', {
          launch_group_id: saved.id,
          sort_order: i,
          label: s.label?.trim() || '',
          notes: s.notes?.trim() || '',
          command_id: commandId,
          delay_ms: typeof s.delay_ms === 'number' ? s.delay_ms : 0,
          wait_for_port: typeof s.wait_for_port === 'number' ? s.wait_for_port : null,
          wait_for_health: s.wait_for_health?.trim() || '',
          ...(acceptableStatuses ? { acceptable_statuses: acceptableStatuses } : {}),
          ...(typeof s.timeout_ms === 'number' ? { timeout_ms: s.timeout_ms } : {}),
          ...(typeof s.continue_on_failure === 'boolean' ? { continue_on_failure: s.continue_on_failure } : {}),
        } as any);
      }
    }

    setImportMode(false);
    onChange();
  }

  async function addGroup() {
    await upsertRow<LaunchGroup>('launch_groups', {
      project_id: scope.project.id,
      name: 'New launch group',
      description: '',
    } as any);
    onChange();
  }

  async function updateGroup(g: LaunchGroup) {
    await upsertRow<LaunchGroup>('launch_groups', g);
    onChange();
  }

  async function removeGroup(id: string) {
    await deleteRow('launch_groups', id);
    onChange();
  }

  async function addStep(groupId: string) {
    const existing = scope.launch_group_steps.filter(s => s.launch_group_id === groupId);
    const maxOrder = existing.length > 0 ? Math.max(...existing.map(s => s.sort_order)) : -1;
    await upsertRow<LaunchGroupStep>('launch_group_steps', {
      launch_group_id: groupId,
      sort_order: maxOrder + 1,
      delay_ms: 0,
      wait_for_port: null,
      wait_for_health: '',
      label: '',
      notes: '',
      command_id: null,
      acceptable_statuses: [200, 201, 204],
      timeout_ms: null,
      continue_on_failure: false,
    } as any);
    onChange();
  }

  async function updateStep(s: LaunchGroupStep) {
    await upsertRow<LaunchGroupStep>('launch_group_steps', s);
    onChange();
  }

  async function removeStep(id: string) {
    await deleteRow('launch_group_steps', id);
    onChange();
  }

  async function moveStep(stepId: string, dir: 'up' | 'down') {
    const step = scope.launch_group_steps.find(s => s.id === stepId);
    if (!step) return;
    const siblings = scope.launch_group_steps
      .filter(s => s.launch_group_id === step.launch_group_id)
      .sort((a, b) => a.sort_order - b.sort_order);
    const idx = siblings.findIndex(s => s.id === stepId);
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= siblings.length) return;

    const other = siblings[swapIdx];
    const tmpOrder = step.sort_order;
    await upsertRow<LaunchGroupStep>('launch_group_steps', { ...step, sort_order: other.sort_order });
    await upsertRow<LaunchGroupStep>('launch_group_steps', { ...other, sort_order: tmpOrder });
    onChange();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Launch Groups</h3>
          <p className="text-xs text-slate-500 mt-0.5">Define ordered startup sequences for your services.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setImportMode(m => !m)}>
            <FileJson className="w-3 h-3 inline mr-1" />Import commands + groups
          </Button>
          <Button onClick={addGroup}><Plus className="w-3 h-3 inline mr-1" />Add Group</Button>
        </div>
      </div>

      {importMode && (
        <JsonImportPanel
          title="Import Commands & Launch Groups from JSON"
          template={LAUNCH_GROUP_TEMPLATE}
          schemaHint={[
            'Two shapes accepted:',
            '  • Combined: { "commands": [...], "launch_groups": [...] }   (recommended)',
            '  • Legacy:   [ <launch_group>, ... ]',
            '',
            'Command fields: name (required), command (required), kind, working_dir, notes, expected_port, health_url, must_confirm',
            'Launch group fields: name (required), description, steps[]',
            'Step fields: label, command_name (matched against commands above + existing profiles) OR command_id, delay_ms, wait_for_port, wait_for_health, acceptable_statuses (int[]), timeout_ms, continue_on_failure, notes',
            '',
            'Steps with an unresolved command_name are rejected up-front (no partial writes).',
          ].join('\n')}
          onImport={importGroups}
          onClose={() => setImportMode(false)}
        />
      )}

      {scope.launch_groups.length === 0 ? (
        <Card>
          <div className="p-8 text-center">
            <Play className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-400 mb-1">No launch groups yet</p>
            <p className="text-xs text-slate-600">Create a launch group to define ordered startup sequences like: start DB → start API → start frontend.</p>
          </div>
        </Card>
      ) : (
        scope.launch_groups.map(group => (
          <GroupCard
            key={group.id}
            group={group}
            steps={scope.launch_group_steps.filter(s => s.launch_group_id === group.id)}
            commands={scope.commands}
            slug={scope.project.slug}
            daemonOnline={daemonOnline}
            onSaveGroup={updateGroup}
            onRemoveGroup={removeGroup}
            onSaveStep={updateStep}
            onRemoveStep={removeStep}
            onAddStep={addStep}
            onMoveStep={moveStep}
          />
        ))
      )}

      <div className="text-xs text-slate-500 px-1">
        Launch groups define sequences of commands to start in order. Use delays and port/health checks to gate each step.
      </div>
    </div>
  );
}
