import { useState } from 'react';
import { Plus, Trash2, AlertTriangle, ChevronDown, ChevronRight, ShieldAlert, Play, X, Clock, CheckCircle2, XCircle, Ban } from 'lucide-react';
import type { ProjectScope, DangerZoneCommand, DangerZoneExecution } from '../../lib/types';
import { upsertRow, deleteRow, insertDangerZoneExecution } from '../../lib/api';
import { Card, CardHeader, Field, Input, Textarea, Select, Button, Badge } from '../ui';

const RISK_TONE: Record<string, 'rose' | 'amber' | 'slate'> = {
  critical: 'rose',
  high: 'rose',
  medium: 'amber',
  low: 'slate',
};

const OUTCOME_ICON: Record<string, typeof CheckCircle2> = {
  executed: CheckCircle2,
  aborted: Ban,
  failed: XCircle,
};

const OUTCOME_COLOR: Record<string, string> = {
  executed: 'text-emerald-400',
  aborted: 'text-slate-500',
  failed: 'text-rose-400',
};

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ── Triple-Confirm Execution Dialog ──────────────────────────────────────────

function TripleConfirmDialog({ command, onConfirm, onCancel }: {
  command: DangerZoneCommand;
  onConfirm: (notes: string) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState(1);
  const [typedName, setTypedName] = useState('');
  const [riskAck, setRiskAck] = useState(false);
  const [finalAck, setFinalAck] = useState(false);
  const [notes, setNotes] = useState('');

  const nameMatch = typedName.trim().toLowerCase() === (command.label || command.command).trim().toLowerCase();
  const expectedText = command.label || command.command;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-slate-900 border border-rose-500/30 rounded-lg shadow-2xl w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-400" />
            <h3 className="text-sm font-medium text-rose-300">Execute Dangerous Command</h3>
          </div>
          <button onClick={onCancel} className="text-slate-500 hover:text-slate-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="px-5 pt-4">
          <div className="flex items-center gap-2 mb-4">
            {[1, 2, 3].map(s => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${
                  s < step ? 'bg-rose-500 text-white' : s === step ? 'bg-rose-500/20 border border-rose-500 text-rose-300' : 'bg-slate-800 text-slate-600'
                }`}>{s}</div>
                {s < 3 && <div className={`w-8 h-px ${s < step ? 'bg-rose-500' : 'bg-slate-800'}`} />}
              </div>
            ))}
            <span className="text-[10px] text-slate-500 ml-2">
              {step === 1 ? 'Identify' : step === 2 ? 'Acknowledge risk' : 'Final confirmation'}
            </span>
          </div>
        </div>

        {/* Command summary */}
        <div className="mx-5 mb-4 bg-slate-950 border border-slate-800 rounded p-3">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400/70" />
            <span className="text-xs text-slate-200 font-medium">{command.label || 'Unlabeled command'}</span>
            <Badge tone={RISK_TONE[command.risk_level] || 'amber'}>{command.risk_level}</Badge>
            {command.environment && <Badge tone="blue">{command.environment}</Badge>}
          </div>
          <code className="text-xs text-rose-300/70 font-mono block mt-1">{command.command}</code>
          {command.description && <p className="text-[11px] text-slate-500 mt-1.5">{command.description}</p>}
        </div>

        {/* Step 1: Type command name */}
        {step === 1 && (
          <div className="px-5 pb-5">
            <p className="text-xs text-slate-400 mb-3">
              Type <code className="text-rose-300 bg-slate-800 px-1 py-0.5 rounded text-[11px]">{expectedText}</code> to confirm you know which command you're executing.
            </p>
            <Input
              value={typedName}
              onChange={e => setTypedName(e.target.value)}
              placeholder={`Type "${expectedText}" to continue`}
              className="font-mono"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" onClick={onCancel}>Cancel</Button>
              <Button variant="danger" onClick={() => setStep(2)} disabled={!nameMatch}>
                Next
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Acknowledge risk */}
        {step === 2 && (
          <div className="px-5 pb-5">
            <div className="bg-rose-500/5 border border-rose-500/20 rounded p-3 mb-3">
              <p className="text-xs text-rose-200/80">
                {command.risk_level === 'critical'
                  ? 'This is a CRITICAL risk command. It may cause irreversible data loss or service disruption. Proceed only if you have verified backups and understand the full impact.'
                  : command.risk_level === 'high'
                  ? 'This is a HIGH risk command. It may cause significant changes that are difficult to reverse. Make sure you understand the consequences.'
                  : 'This command has been flagged as potentially destructive. Review the impact before proceeding.'}
              </p>
            </div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={riskAck}
                onChange={e => setRiskAck(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-xs text-slate-300">
                I understand the risk level (<span className="text-rose-300 font-medium">{command.risk_level}</span>) and have reviewed what this command does.
              </span>
            </label>
            <div className="flex justify-between mt-4">
              <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={onCancel}>Cancel</Button>
                <Button variant="danger" onClick={() => setStep(3)} disabled={!riskAck}>
                  Next
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Final confirmation */}
        {step === 3 && (
          <div className="px-5 pb-5">
            <Field label="Notes (optional)">
              <Textarea
                rows={2}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Why are you running this? e.g. resetting staging after demo"
              />
            </Field>
            <label className="flex items-start gap-2 cursor-pointer mt-3">
              <input
                type="checkbox"
                checked={finalAck}
                onChange={e => setFinalAck(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-xs text-slate-300">
                I accept full responsibility for executing <code className="text-rose-300 bg-slate-800 px-1 py-0.5 rounded text-[11px]">{command.command}</code>. This action will be logged.
              </span>
            </label>
            <div className="flex justify-between mt-4">
              <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={onCancel}>Cancel</Button>
                <Button variant="danger" onClick={() => onConfirm(notes)} disabled={!finalAck}>
                  <Play className="w-3 h-3 inline mr-1" />Execute
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Danger Row (command entry) ──────────────────────────────────────────────

function DangerRow({ item, onSave, onRemove, onExecute }: {
  item: DangerZoneCommand;
  onSave: (d: DangerZoneCommand) => void;
  onRemove: (id: string) => void;
  onExecute: (d: DangerZoneCommand) => void;
}) {
  const [d, setD] = useState(item);
  const [expanded, setExpanded] = useState(!item.command);

  function save() { onSave(d); }

  return (
    <div className={`border rounded transition-colors ${expanded ? 'border-rose-500/30 bg-slate-900/60' : 'border-slate-800/60 bg-slate-950/40 hover:border-slate-700/60'}`}>
      <div className="flex items-center gap-3 px-3 py-2">
        <button onClick={() => setExpanded(e => !e)} className="shrink-0 text-slate-600 hover:text-slate-400 transition-colors">
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <AlertTriangle className="w-3.5 h-3.5 text-rose-400/70 shrink-0" />
        <span className="text-sm text-slate-200 min-w-0 truncate flex-1">{d.label || d.command || 'Untitled'}</span>
        <code className="text-xs text-slate-400 font-mono shrink-0 truncate max-w-[240px]">{d.command}</code>
        <Badge tone={RISK_TONE[d.risk_level] || 'amber'}>{d.risk_level}</Badge>
        {d.requires_confirmation && <Badge tone="amber">confirm</Badge>}
        {d.environment && <Badge tone="blue">{d.environment}</Badge>}
        {d.command && (
          <button
            onClick={() => onExecute(d)}
            title="Execute with confirmation"
            className="p-1 rounded text-slate-600 hover:text-rose-300 hover:bg-rose-500/10 transition-colors shrink-0"
          >
            <Play className="w-3.5 h-3.5" />
          </button>
        )}
        <button onClick={() => onRemove(d.id)} className="p-1 rounded text-slate-600 hover:text-rose-400 transition-colors shrink-0">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-slate-800">
          <div className="grid grid-cols-12 gap-3 mt-3">
            <div className="col-span-4">
              <Field label="Label">
                <Input value={d.label} onChange={e => setD({ ...d, label: e.target.value })} onBlur={save} placeholder="e.g. Reset database" />
              </Field>
            </div>
            <div className="col-span-5">
              <Field label="Command">
                <Input className="font-mono" value={d.command} onChange={e => setD({ ...d, command: e.target.value })} onBlur={save} placeholder="e.g. db:reset" />
              </Field>
            </div>
            <div className="col-span-3">
              <Field label="Risk level">
                <Select value={d.risk_level} onChange={e => { const u = { ...d, risk_level: e.target.value }; setD(u); onSave(u); }}>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </Select>
              </Field>
            </div>
            <div className="col-span-8">
              <Field label="Description (why is this dangerous?)">
                <Textarea rows={2} value={d.description} onChange={e => setD({ ...d, description: e.target.value })} onBlur={save} placeholder="Drops and recreates all tables, losing all data." />
              </Field>
            </div>
            <div className="col-span-4 space-y-3">
              <Field label="Environment scope">
                <Input value={d.environment} onChange={e => setD({ ...d, environment: e.target.value })} onBlur={save} placeholder="e.g. production, staging" />
              </Field>
              <label className="flex items-center gap-1.5 text-xs text-slate-400">
                <input type="checkbox" checked={d.requires_confirmation} onChange={e => { const u = { ...d, requires_confirmation: e.target.checked }; setD(u); onSave(u); }} />
                Requires confirmation
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Execution History ────────────────────────────────────────────────────────

function ExecutionHistory({ executions }: { executions: DangerZoneExecution[] }) {
  const [showAll, setShowAll] = useState(false);
  const displayed = showAll ? executions : executions.slice(0, 10);

  if (executions.length === 0) {
    return (
      <div className="text-sm text-slate-500">
        No execution history yet. Executions are logged here when you run danger zone commands through the triple-confirm dialog.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {displayed.map(ex => {
        const Icon = OUTCOME_ICON[ex.outcome] || CheckCircle2;
        const color = OUTCOME_COLOR[ex.outcome] || 'text-slate-400';
        return (
          <div key={ex.id} className="flex items-center gap-3 px-3 py-2 border border-slate-800/60 rounded bg-slate-950/40 hover:border-slate-700/60 transition-colors">
            <Icon className={`w-3.5 h-3.5 shrink-0 ${color}`} />
            <span className="text-sm text-slate-200 min-w-0 truncate flex-1">
              {ex.command_label || ex.command_text}
            </span>
            <code className="text-xs text-slate-500 font-mono shrink-0 truncate max-w-[200px]">{ex.command_text}</code>
            <Badge tone={RISK_TONE[ex.risk_level] || 'amber'}>{ex.risk_level}</Badge>
            {ex.environment && <Badge tone="blue">{ex.environment}</Badge>}
            <Badge tone={ex.outcome === 'executed' ? 'emerald' : ex.outcome === 'aborted' ? 'slate' : 'rose'}>
              {ex.outcome}
            </Badge>
            <span className="text-[10px] text-slate-600 shrink-0 flex items-center gap-1" title={new Date(ex.executed_at).toLocaleString()}>
              <Clock className="w-3 h-3" />
              {formatRelative(ex.executed_at)}
            </span>
          </div>
        );
      })}
      {executions.length > 10 && (
        <button
          onClick={() => setShowAll(s => !s)}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors px-3 py-1"
        >
          {showAll ? 'Show less' : `Show all ${executions.length} entries`}
        </button>
      )}
    </div>
  );
}

// ── Main Tab ─────────────────────────────────────────────────────────────────

export function DangerZoneTab({ scope, onChange }: { scope: ProjectScope; onChange: () => void }) {
  const items = scope.danger_zone_commands || [];
  const executions = scope.danger_zone_executions || [];
  const [confirmTarget, setConfirmTarget] = useState<DangerZoneCommand | null>(null);

  async function add() {
    await upsertRow<DangerZoneCommand>('danger_zone_commands', {
      project_id: scope.project.id,
      label: '',
      command: '',
      risk_level: 'high',
      description: '',
      requires_confirmation: true,
      environment: '',
    } as any);
    onChange();
  }

  async function update(cmd: DangerZoneCommand) {
    await upsertRow<DangerZoneCommand>('danger_zone_commands', cmd);
    onChange();
  }

  async function remove(id: string) {
    await deleteRow('danger_zone_commands', id);
    onChange();
  }

  async function handleExecution(notes: string) {
    if (!confirmTarget) return;
    await insertDangerZoneExecution({
      project_id: scope.project.id,
      danger_zone_command_id: confirmTarget.id,
      command_label: confirmTarget.label,
      command_text: confirmTarget.command,
      risk_level: confirmTarget.risk_level,
      environment: confirmTarget.environment,
      outcome: 'executed',
      notes,
    });
    setConfirmTarget(null);
    onChange();
  }

  const critical = items.filter(d => d.risk_level === 'critical');
  const high = items.filter(d => d.risk_level === 'high');
  const rest = items.filter(d => d.risk_level !== 'critical' && d.risk_level !== 'high');

  const sorted = [...critical, ...high, ...rest];

  return (
    <div className="space-y-4">
      <div className="bg-rose-500/5 border border-rose-500/20 rounded px-4 py-3 flex items-start gap-2">
        <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
        <div className="text-xs text-rose-200/80">
          Register commands that are destructive or require extra caution. These are <strong>always included</strong> in agent context exports so AI agents know which commands need human confirmation before execution. Use the <Play className="w-3 h-3 inline text-rose-300" /> button to execute with a triple-confirm dialog.
        </div>
      </div>

      <Card>
        <CardHeader title={`Danger zone commands (${items.length})`} action={
          <Button onClick={add}><Plus className="w-3 h-3 inline mr-1" />Add</Button>
        } />
        <div className="p-5 space-y-2">
          {items.length === 0 && (
            <div className="text-sm text-slate-500">
              No danger zone commands registered. Add commands like <code className="text-rose-300/70 bg-slate-800 px-1.5 py-0.5 rounded text-xs">db:reset</code>, <code className="text-rose-300/70 bg-slate-800 px-1.5 py-0.5 rounded text-xs">docker system prune</code>, or <code className="text-rose-300/70 bg-slate-800 px-1.5 py-0.5 rounded text-xs">rm -rf dist</code> that agents should always confirm before running.
            </div>
          )}
          {sorted.map(d => (
            <DangerRow key={d.id} item={d} onSave={update} onRemove={remove} onExecute={setConfirmTarget} />
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title={`Execution history (${executions.length})`} />
        <div className="p-5">
          <ExecutionHistory executions={executions} />
        </div>
      </Card>

      {confirmTarget && (
        <TripleConfirmDialog
          command={confirmTarget}
          onConfirm={handleExecution}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
    </div>
  );
}
