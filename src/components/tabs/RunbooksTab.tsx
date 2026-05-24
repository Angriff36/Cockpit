import { useState, useMemo, useCallback, useRef } from 'react';
import { Save, Plus, Trash2, Search, X, BookOpenCheck, AlertTriangle, ChevronDown, ChevronRight, ArrowUp, ArrowDown, Play, Square, CheckCircle2, Terminal, RotateCcw, FileJson } from 'lucide-react';
import type { ProjectScope, Runbook, RunbookStep } from '../../lib/types';
import { upsertRow, deleteRow } from '../../lib/api';
import { startProcess, streamLogs } from '../../lib/daemon';
import { Card, CardHeader, Field, Input, Textarea, Button, Badge } from '../ui';
import { JsonImportPanel } from '../JsonImportPanel';

// ── JSON import types ─────────────────────────────────────────────────────

type RunbookStepImport = {
  instruction: string;
  notes?: string;
  shell_command?: string;
  is_danger?: boolean;
  danger_warning?: string;
  auto_run?: boolean;
};

type RunbookImport = {
  title: string;
  description?: string;
  steps?: RunbookStepImport[];
};

const IMPORT_TEMPLATE: RunbookImport[] = [
  {
    title: 'Deploy to production',
    description: 'Step-by-step production deployment guide',
    steps: [
      { instruction: 'Ensure all tests pass', shell_command: 'npm test', auto_run: true },
      { instruction: 'Create a database backup', shell_command: 'npm run db:backup', notes: 'Verify the backup file exists before proceeding' },
      { instruction: 'Run database migrations', shell_command: 'npm run db:migrate', is_danger: true, danger_warning: 'Modifies the production database — backup must exist' },
      { instruction: 'Deploy application', shell_command: 'npm run deploy' },
      { instruction: 'Verify health endpoints are responding', notes: 'Check /health and /ready endpoints' },
    ],
  },
];


function emptyRunbook(projectId: string): Partial<Runbook> {
  return { project_id: projectId, title: '', description: '' };
}

function emptyStep(runbookId: string, sortOrder: number): Partial<RunbookStep> {
  return { runbook_id: runbookId, sort_order: sortOrder, instruction: '', is_danger: false, danger_warning: '', notes: '', shell_command: '', auto_run: false };
}

// ── Execution state per step ──────────────────────────────────────────────

type StepExecState = {
  checked: boolean;
  running: boolean;
  exitCode: number | null;
  output: string;
  lines?: string[];
};

export function RunbooksTab({ scope, onChange, daemonOnline = false }: { scope: ProjectScope; onChange: () => void; daemonOnline?: boolean }) {
  const [runbooks, setRunbooks] = useState<Runbook[]>(scope.runbooks || []);
  const [steps, setSteps] = useState<RunbookStep[]>(scope.runbook_steps || []);
  const [editingRunbook, setEditingRunbook] = useState<Partial<Runbook> | null>(null);
  const [editingStep, setEditingStep] = useState<Partial<RunbookStep> | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [importMode, setImportMode] = useState(false);

  // Execution mode: tracks which runbook is being "executed" and step states
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [execStates, setExecStates] = useState<Record<string, StepExecState>>({});
  const streamCleanups = useRef<Record<string, () => void>>({});

  const filtered = useMemo(() => {
    if (!search.trim()) return runbooks;
    const q = search.toLowerCase();
    return runbooks.filter(r =>
      r.title.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      stepsFor(r.id).some(s => s.instruction.toLowerCase().includes(q))
    );
  }, [runbooks, steps, search]);

  function stepsFor(runbookId: string) {
    return steps.filter(s => s.runbook_id === runbookId).sort((a, b) => a.sort_order - b.sort_order);
  }

  // ── Runbook CRUD ───────────────────────────────────────────────────────

  async function saveRunbook() {
    if (!editingRunbook) return;
    setSaving(true);
    try {
      const saved = await upsertRow<Runbook>('runbooks', {
        ...editingRunbook,
        updated_at: new Date().toISOString(),
      } as any);
      if (editingRunbook.id) {
        setRunbooks(prev => prev.map(r => r.id === saved.id ? saved : r));
      } else {
        setRunbooks(prev => [saved, ...prev]);
        setExpandedId(saved.id);
      }
      setEditingRunbook(null);
      onChange();
    } finally {
      setSaving(false);
    }
  }

  async function removeRunbook(id: string) {
    if (!confirm('Delete this runbook and all its steps?')) return;
    await deleteRow('runbooks', id);
    setRunbooks(prev => prev.filter(r => r.id !== id));
    setSteps(prev => prev.filter(s => s.runbook_id !== id));
    if (editingRunbook?.id === id) setEditingRunbook(null);
    if (expandedId === id) setExpandedId(null);
    if (executingId === id) { setExecutingId(null); setExecStates({}); }
    onChange();
  }

  // ── JSON import ───────────────────────────────────────────────────────

  async function runImport(items: unknown[]) {
    // validate
    for (let i = 0; i < items.length; i++) {
      const rb = items[i] as any;
      if (typeof rb !== 'object' || rb === null) throw new Error(`Item ${i + 1}: must be an object`);
      if (typeof rb.title !== 'string' || !rb.title.trim()) throw new Error(`Item ${i + 1}: "title" (string) is required`);
      if (rb.steps !== undefined) {
        if (!Array.isArray(rb.steps)) throw new Error(`Item ${i + 1}: "steps" must be an array`);
        for (let j = 0; j < rb.steps.length; j++) {
          const s = rb.steps[j] as any;
          if (typeof s.instruction !== 'string' || !s.instruction.trim()) throw new Error(`Item ${i + 1}, step ${j + 1}: "instruction" (string) is required`);
        }
      }
    }
    for (const item of items) {
      const rb = item as RunbookImport;
      const saved = await upsertRow<Runbook>('runbooks', {
        project_id: scope.project.id,
        title: rb.title.trim(),
        description: rb.description?.trim() || '',
        updated_at: new Date().toISOString(),
      } as any);
      setRunbooks(prev => [saved, ...prev]);
      if (rb.steps?.length) {
        for (let i = 0; i < rb.steps.length; i++) {
          const s = rb.steps[i];
          const savedStep = await upsertRow<RunbookStep>('runbook_steps', {
            runbook_id: saved.id,
            sort_order: i,
            instruction: s.instruction.trim(),
            notes: s.notes?.trim() || '',
            shell_command: s.shell_command?.trim() || '',
            is_danger: s.is_danger ?? false,
            danger_warning: s.danger_warning?.trim() || '',
            auto_run: s.auto_run ?? false,
          } as any);
          setSteps(prev => [...prev, savedStep]);
        }
      }
    }
    setImportMode(false);
    onChange();
  }

  // ── Step CRUD ──────────────────────────────────────────────────────────

  async function saveStep() {
    if (!editingStep) return;
    setSaving(true);
    try {
      const saved = await upsertRow<RunbookStep>('runbook_steps', editingStep as any);
      if (editingStep.id) {
        setSteps(prev => prev.map(s => s.id === saved.id ? saved : s));
      } else {
        setSteps(prev => [...prev, saved]);
      }
      setEditingStep(null);
      onChange();
    } finally {
      setSaving(false);
    }
  }

  async function removeStep(id: string) {
    if (!confirm('Delete this step?')) return;
    await deleteRow('runbook_steps', id);
    setSteps(prev => prev.filter(s => s.id !== id));
    if (editingStep?.id === id) setEditingStep(null);
    onChange();
  }

  async function moveStep(step: RunbookStep, direction: 'up' | 'down') {
    const siblings = stepsFor(step.runbook_id);
    const idx = siblings.findIndex(s => s.id === step.id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= siblings.length) return;

    const other = siblings[swapIdx];
    const newOrder = other.sort_order;
    const otherNewOrder = step.sort_order;

    setSaving(true);
    try {
      await Promise.all([
        upsertRow<RunbookStep>('runbook_steps', { id: step.id, sort_order: newOrder } as any),
        upsertRow<RunbookStep>('runbook_steps', { id: other.id, sort_order: otherNewOrder } as any),
      ]);
      setSteps(prev => prev.map(s => {
        if (s.id === step.id) return { ...s, sort_order: newOrder };
        if (s.id === other.id) return { ...s, sort_order: otherNewOrder };
        return s;
      }));
      onChange();
    } finally {
      setSaving(false);
    }
  }

  // ── Execution mode ─────────────────────────────────────────────────────

  function startExecution(runbookId: string) {
    const rbSteps = stepsFor(runbookId);
    const states: Record<string, StepExecState> = {};
    for (const s of rbSteps) {
      states[s.id] = { checked: false, running: false, exitCode: null, output: '' };
    }
    setExecStates(states);
    setExecutingId(runbookId);
    setExpandedId(runbookId);
  }

  function stopExecution() {
    setExecutingId(null);
    setExecStates({});
  }

  function resetExecution() {
    if (!executingId) return;
    startExecution(executingId);
  }

  function toggleCheck(stepId: string) {
    setExecStates(prev => ({
      ...prev,
      [stepId]: { ...prev[stepId], checked: !prev[stepId].checked },
    }));
  }

  const runShellCommand = useCallback(async (step: RunbookStep) => {
    if (!step.shell_command.trim()) return;

    // Cancel any previous stream for this step
    streamCleanups.current[step.id]?.();
    delete streamCleanups.current[step.id];

    const cmdId = `runbook-${step.id}`;

    setExecStates(prev => ({
      ...prev,
      [step.id]: { ...prev[step.id], running: true, exitCode: null, output: 'Starting…', lines: [] },
    }));

    try {
      const result = await startProcess({
        slug: scope.project.slug,
        cmdId,
        command: step.shell_command,
        cwd: scope.project.repo_path,
        name: step.instruction.slice(0, 50) || 'Runbook step',
        kind: 'runbook',
      });

      setExecStates(prev => ({
        ...prev,
        [step.id]: { ...prev[step.id], running: true, output: `PID ${result.pid}`, lines: [] },
      }));

      const stopStream = streamLogs(scope.project.slug, cmdId, {
        onBacklog: (logLines) => {
          const exitLine = logLines.find(l => /\[process exited with code/.test(l.text));
          setExecStates(prev => ({
            ...prev,
            [step.id]: {
              ...prev[step.id],
              lines: logLines.map(l => l.text),
              ...(exitLine ? {
                running: false,
                exitCode: /code 0/.test(exitLine.text) ? 0 : 1,
                output: exitLine.text,
              } : {}),
            },
          }));
          if (exitLine) { stopStream(); delete streamCleanups.current[step.id]; }
        },
        onLines: (logLines) => {
          const exitLine = logLines.find(l => /\[process exited with code/.test(l.text));
          setExecStates(prev => ({
            ...prev,
            [step.id]: {
              ...prev[step.id],
              lines: [...(prev[step.id]?.lines ?? []), ...logLines.map(l => l.text)],
              ...(exitLine ? {
                running: false,
                exitCode: /code 0/.test(exitLine.text) ? 0 : 1,
                output: exitLine.text,
              } : {}),
            },
          }));
          if (exitLine) { stopStream(); delete streamCleanups.current[step.id]; }
        },
      });

      streamCleanups.current[step.id] = stopStream;

    } catch (e: any) {
      setExecStates(prev => ({
        ...prev,
        [step.id]: { ...prev[step.id], running: false, exitCode: 1, output: `Error: ${e.message}`, lines: [] },
      }));
    }
  }, [scope.project.slug, scope.project.repo_path]);

  // Auto-run a step's shell command if auto_run is enabled
  function handleCheckWithAutoRun(step: RunbookStep) {
    toggleCheck(step.id);
    if (!execStates[step.id]?.checked && step.auto_run && step.shell_command.trim() && daemonOnline) {
      runShellCommand(step);
    }
  }

  const dangerStepCount = steps.filter(s => s.is_danger).length;

  return (
    <div className="space-y-4">
      {/* Header info */}
      <div className="bg-blue-500/5 border border-blue-500/20 rounded px-4 py-3 flex items-start gap-2">
        <BookOpenCheck className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
        <div className="text-xs text-blue-200/80">
          Runbooks are step-by-step guides for operational procedures like deploying, resetting databases, or onboarding. Steps can be marked with danger warnings for risky operations.
          {dangerStepCount > 0 && <span className="text-amber-300/80 ml-1">{dangerStepCount} step{dangerStepCount !== 1 ? 's' : ''} flagged as dangerous.</span>}
          {!daemonOnline && <span className="text-slate-500 ml-1">Daemon offline — shell commands unavailable.</span>}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <Button onClick={() => { setEditingRunbook(emptyRunbook(scope.project.id)); setImportMode(false); }}>
          <Plus className="w-3 h-3 inline mr-1" />New Runbook
        </Button>
        <Button
          variant="ghost"
          onClick={() => { setImportMode(m => !m); setEditingRunbook(null); }}
          title="Paste a JSON runbook definition to bulk-import"
        >
          <FileJson className="w-3 h-3 inline mr-1" />Import JSON
        </Button>
        <div className="flex-1 relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search runbooks..."
            className="w-full bg-slate-950 border border-slate-800 rounded pl-9 pr-8 py-1.5 text-slate-100 text-xs placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* JSON import panel */}
      {importMode && (
        <JsonImportPanel
          title="Import Runbooks from JSON"
          template={IMPORT_TEMPLATE}
          schemaHint={'Required: title (runbook), instruction (each step)\nOptional step fields: notes, shell_command, auto_run, is_danger, danger_warning'}
          onImport={runImport}
          onClose={() => { setImportMode(false); }}
        />
      )}

      {/* Runbook editor */}
      {editingRunbook && (
        <Card>
          <CardHeader title={editingRunbook.id ? 'Edit Runbook' : 'New Runbook'} action={
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setEditingRunbook(null)}>Cancel</Button>
              <Button onClick={saveRunbook} disabled={saving || !editingRunbook.title?.trim()}>
                <Save className="w-3 h-3 inline mr-1" />{saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          } />
          <div className="p-5 space-y-4">
            <Field label="Title">
              <Input
                value={editingRunbook.title || ''}
                onChange={e => setEditingRunbook({ ...editingRunbook, title: e.target.value })}
                placeholder="e.g., How to deploy to production"
                autoFocus
              />
            </Field>
            <Field label="Description (optional)">
              <Textarea
                rows={3}
                value={editingRunbook.description || ''}
                onChange={e => setEditingRunbook({ ...editingRunbook, description: e.target.value })}
                placeholder="Brief description of when to use this runbook"
              />
            </Field>
          </div>
        </Card>
      )}

      {/* Runbook list */}
      {filtered.length === 0 ? (
        <Card>
          <div className="px-5 py-8 text-center text-xs text-slate-500">
            {runbooks.length === 0
              ? 'No runbooks yet. Click "New Runbook" to create a step-by-step guide.'
              : 'No runbooks match your search.'}
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(runbook => {
            const rbSteps = stepsFor(runbook.id);
            const expanded = expandedId === runbook.id;
            const hasDanger = rbSteps.some(s => s.is_danger);
            const isExecuting = executingId === runbook.id;
            const checkedCount = isExecuting ? rbSteps.filter(s => execStates[s.id]?.checked).length : 0;
            const allChecked = isExecuting && rbSteps.length > 0 && checkedCount === rbSteps.length;
            const anyRunning = isExecuting && rbSteps.some(s => execStates[s.id]?.running);

            return (
              <Card key={runbook.id}>
                <div className="px-5 py-3.5">
                  {/* Runbook header */}
                  <div className="flex items-start justify-between gap-3">
                    <button
                      onClick={() => setExpandedId(expanded ? null : runbook.id)}
                      className="flex items-start gap-2.5 min-w-0 flex-1 text-left"
                    >
                      {expanded
                        ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                        : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                      }
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {isExecuting && allChecked && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
                          <span className="text-sm font-medium text-slate-100 truncate">{runbook.title}</span>
                          <Badge tone="slate">{rbSteps.length} step{rbSteps.length !== 1 ? 's' : ''}</Badge>
                          {hasDanger && <Badge tone="amber">has warnings</Badge>}
                          {isExecuting && (
                            <Badge tone={allChecked ? 'emerald' : 'blue'}>
                              {checkedCount}/{rbSteps.length} done
                            </Badge>
                          )}
                        </div>
                        {runbook.description && (
                          <div className="text-xs text-slate-400 line-clamp-2">{runbook.description}</div>
                        )}
                        <div className="text-[10px] text-slate-600 mt-1">
                          Updated {new Date(runbook.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                      </div>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      {isExecuting ? (
                        <>
                          <Button variant="ghost" onClick={resetExecution} title="Reset execution">
                            <RotateCcw className="w-3 h-3" />
                          </Button>
                          <Button variant="danger" onClick={stopExecution} disabled={anyRunning}>
                            <Square className="w-3 h-3 inline mr-1" />Stop
                          </Button>
                        </>
                      ) : (
                        <>
                          {rbSteps.length > 0 && (
                            <Button
                              variant="primary"
                              onClick={() => startExecution(runbook.id)}
                              disabled={executingId !== null}
                              title={executingId ? 'Finish current execution first' : 'Execute this runbook step by step'}
                            >
                              <Play className="w-3 h-3 inline mr-1" />Run
                            </Button>
                          )}
                          <Button variant="ghost" onClick={() => setEditingRunbook(runbook)}>Edit</Button>
                          <Button variant="ghost" onClick={() => removeRunbook(runbook.id)}>
                            <Trash2 className="w-3 h-3 text-rose-400/60" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Expanded steps */}
                  {expanded && (
                    <div className="mt-4 ml-6 space-y-2">
                      {rbSteps.length === 0 && !editingStep && (
                        <div className="text-xs text-slate-500 py-2">No steps yet.</div>
                      )}

                      {rbSteps.map((step, idx) => {
                        const execState = isExecuting ? execStates[step.id] : null;
                        const hasShell = !!step.shell_command?.trim();
                        return (
                          <div
                            key={step.id}
                            className={`flex items-start gap-2 rounded px-3 py-2.5 border ${
                              execState?.checked
                                ? 'border-emerald-500/20 bg-emerald-500/5'
                                : step.is_danger
                                  ? 'border-amber-500/20 bg-amber-500/5'
                                  : 'border-slate-800 bg-slate-900/50'
                            } ${execState?.running ? 'ring-1 ring-blue-500/30' : ''}`}
                          >
                            {/* Execution checkbox */}
                            {isExecuting && (
                              <div className="pt-0.5 shrink-0">
                                <input
                                  type="checkbox"
                                  checked={execState?.checked || false}
                                  onChange={() => handleCheckWithAutoRun(step)}
                                  disabled={execState?.running}
                                  className="rounded border-slate-600 bg-slate-950 text-emerald-500 focus:ring-emerald-500 w-4 h-4 cursor-pointer disabled:cursor-not-allowed"
                                />
                              </div>
                            )}

                            <div className="flex flex-col items-center gap-0.5 pt-0.5 shrink-0">
                              <button
                                onClick={() => moveStep(step, 'up')}
                                disabled={idx === 0 || saving || isExecuting}
                                className="text-slate-600 hover:text-slate-300 disabled:opacity-20 disabled:cursor-not-allowed"
                              >
                                <ArrowUp className="w-3 h-3" />
                              </button>
                              <span className="text-[10px] text-slate-600 font-mono w-4 text-center">{idx + 1}</span>
                              <button
                                onClick={() => moveStep(step, 'down')}
                                disabled={idx === rbSteps.length - 1 || saving || isExecuting}
                                className="text-slate-600 hover:text-slate-300 disabled:opacity-20 disabled:cursor-not-allowed"
                              >
                                <ArrowDown className="w-3 h-3" />
                              </button>
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className={`text-xs ${execState?.checked ? 'text-slate-400 line-through' : 'text-slate-200'}`}>
                                {step.instruction}
                              </div>
                              {hasShell && (
                                <div className="flex items-center gap-1.5 mt-1 text-[11px] font-mono">
                                  <Terminal className="w-3 h-3 text-blue-400/60 shrink-0" />
                                  <span className="text-blue-300/70 truncate">{step.shell_command}</span>
                                  {step.auto_run && (
                                    <Badge tone="blue">auto-run</Badge>
                                  )}
                                </div>
                              )}
                              {step.is_danger && step.danger_warning && (
                                <div className="flex items-start gap-1.5 mt-1.5 text-[11px] text-amber-300/80">
                                  <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                                  <span>{step.danger_warning}</span>
                                </div>
                              )}
                              {step.notes && (
                                <div className="text-[11px] text-slate-500 mt-1">{step.notes}</div>
                              )}
                              {/* Execution output */}
                              {execState && (execState.running || execState.output || (execState.lines && execState.lines.length > 0)) && (
                                <div className={`mt-1.5 text-[10px] font-mono rounded overflow-hidden ${
                                  execState.running ? 'border border-blue-500/20' :
                                  execState.exitCode === 0 ? 'border border-emerald-500/20' :
                                  execState.exitCode !== null ? 'border border-rose-500/20' :
                                  'border border-slate-700'
                                }`}>
                                  {execState.lines && execState.lines.length > 0 ? (
                                    <div className="bg-black px-2 py-1 max-h-28 overflow-y-auto space-y-px">
                                      {execState.lines.map((l, i) => <div key={i} className="text-slate-300">{l}</div>)}
                                    </div>
                                  ) : (
                                    <div className={`px-2 py-1 ${
                                      execState.running ? 'text-blue-300 bg-blue-500/10' :
                                      execState.exitCode === 0 ? 'text-emerald-300 bg-emerald-500/10' :
                                      'text-slate-400 bg-slate-800/50'
                                    }`}>{execState.output}</div>
                                  )}
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              {/* Run shell command button (when in exec mode) */}
                              {isExecuting && hasShell && !execState?.running && daemonOnline && (
                                <Button
                                  variant="ghost"
                                  onClick={() => runShellCommand(step)}
                                  title="Run shell command via daemon"
                                >
                                  <Play className="w-3 h-3 text-blue-400" />
                                </Button>
                              )}
                              {!isExecuting && (
                                <>
                                  <Button variant="ghost" onClick={() => setEditingStep(step)}>Edit</Button>
                                  <Button variant="ghost" onClick={() => removeStep(step.id)}>
                                    <Trash2 className="w-3 h-3 text-rose-400/60" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {/* Step editor */}
                      {editingStep && editingStep.runbook_id === runbook.id && !isExecuting && (
                        <Card>
                          <CardHeader title={editingStep.id ? 'Edit Step' : 'New Step'} action={
                            <div className="flex gap-2">
                              <Button variant="ghost" onClick={() => setEditingStep(null)}>Cancel</Button>
                              <Button onClick={saveStep} disabled={saving || !editingStep.instruction?.trim()}>
                                <Save className="w-3 h-3 inline mr-1" />{saving ? 'Saving...' : 'Save'}
                              </Button>
                            </div>
                          } />
                          <div className="p-4 space-y-3">
                            <Field label="Instruction">
                              <Textarea
                                rows={2}
                                value={editingStep.instruction || ''}
                                onChange={e => setEditingStep({ ...editingStep, instruction: e.target.value })}
                                placeholder="What to do in this step"
                                autoFocus
                              />
                            </Field>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="flex items-center gap-4">
                                <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={editingStep.is_danger || false}
                                    onChange={e => setEditingStep({ ...editingStep, is_danger: e.target.checked })}
                                    className="rounded border-slate-700 bg-slate-950 text-amber-500 focus:ring-amber-500"
                                  />
                                  Danger step
                                </label>
                              </div>
                              <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={editingStep.auto_run || false}
                                  onChange={e => setEditingStep({ ...editingStep, auto_run: e.target.checked })}
                                  className="rounded border-slate-700 bg-slate-950 text-blue-500 focus:ring-blue-500"
                                />
                                Auto-run command on check
                              </label>
                            </div>
                            {editingStep.is_danger && (
                              <Field label="Danger warning">
                                <Input
                                  value={editingStep.danger_warning || ''}
                                  onChange={e => setEditingStep({ ...editingStep, danger_warning: e.target.value })}
                                  placeholder="e.g., This will wipe the database — ensure you have a backup"
                                />
                              </Field>
                            )}
                            <Field label="Shell command (optional — runs via daemon)">
                              <div className="flex items-center gap-2">
                                <Terminal className="w-4 h-4 text-slate-500 shrink-0" />
                                <Input
                                  value={editingStep.shell_command || ''}
                                  onChange={e => setEditingStep({ ...editingStep, shell_command: e.target.value })}
                                  placeholder="e.g., npm run db:migrate"
                                  className="font-mono"
                                />
                              </div>
                              {editingStep.shell_command && !daemonOnline && (
                                <div className="text-[10px] text-amber-400/70 mt-1">Daemon is offline — this command won't run until the daemon is connected.</div>
                              )}
                            </Field>
                            <Field label="Notes (optional)">
                              <Input
                                value={editingStep.notes || ''}
                                onChange={e => setEditingStep({ ...editingStep, notes: e.target.value })}
                                placeholder="Additional context for this step"
                              />
                            </Field>
                          </div>
                        </Card>
                      )}

                      {!isExecuting && (
                        <Button
                          variant="ghost"
                          onClick={() => setEditingStep(emptyStep(runbook.id, rbSteps.length))}
                        >
                          <Plus className="w-3 h-3 inline mr-1" />Add Step
                        </Button>
                      )}
                    </div>
                  )}

                  {/* Completion banner */}
                  {isExecuting && allChecked && (
                    <div className="mt-3 ml-6 flex items-center gap-2 rounded px-3 py-2 bg-emerald-500/10 border border-emerald-500/20">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs text-emerald-300">All steps completed!</span>
                      <Button variant="ghost" onClick={stopExecution} className="ml-auto text-xs">Dismiss</Button>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Summary card */}
      {runbooks.length > 0 && (
        <Card>
          <CardHeader title="Runbooks summary" />
          <div className="p-5 grid grid-cols-3 gap-4 text-xs">
            <div className="flex justify-between"><span className="text-slate-500">Total runbooks</span><span className="text-slate-200 font-mono">{runbooks.length}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Total steps</span><span className="text-slate-200 font-mono">{steps.length}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Danger steps</span><span className="text-amber-300 font-mono">{dangerStepCount}</span></div>
          </div>
        </Card>
      )}
    </div>
  );
}
