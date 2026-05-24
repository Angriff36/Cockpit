import { useState, useRef } from 'react';
import { Plus, Trash2, Play, Square, Zap, ChevronDown, ChevronRight, History, FileJson } from 'lucide-react';
import type { ProjectScope, CommandProfile, CommandRunHistory } from '../../lib/types';
import { upsertRow, deleteRow, getEffectiveRepoPath, insertCommandRun, updateCommandRun, updateCommandExpectedPort } from '../../lib/api';
import { detectProject, startProcess, stopProcess } from '../../lib/daemon';
import { useDaemonOnline } from '../../lib/useDaemonOnline';
import { useCurrentMachine } from '../../lib/useCurrentMachine';
import { Card, CardHeader, Field, Input, Select, Button, Badge } from '../ui';
import { UrlInputRow } from '../ExternalLink';
import { JsonImportPanel } from '../JsonImportPanel';

const COMMANDS_TEMPLATE = [
  { name: 'Dev server', kind: 'dev', command: 'npm run dev', working_dir: '', expected_port: 3000, health_url: '', must_confirm: false, notes: '' },
  { name: 'Build', kind: 'build', command: 'npm run build', working_dir: '', expected_port: null, health_url: '', must_confirm: false, notes: '' },
  { name: 'Test', kind: 'test', command: 'npm test', working_dir: '', expected_port: null, health_url: '', must_confirm: false, notes: '' },
  { name: 'Migrate', kind: 'migrate', command: 'npm run db:migrate', working_dir: '', expected_port: null, health_url: '', must_confirm: true, notes: 'Applies pending DB migrations' },
];

const KIND_ORDER = ['dev', 'start', 'build', 'test', 'lint', 'migrate', 'seed', 'reset', 'other'];
const KIND_DEFAULT_OPEN = new Set(['dev', 'start', 'migrate', 'seed', 'reset']);

const KIND_TONE: Record<string, string> = {
  dev: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  start: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  build: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  test: 'text-violet-400 bg-violet-500/10 border-violet-500/30',
  lint: 'text-slate-400 bg-slate-700/30 border-slate-600/30',
  migrate: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  seed: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  reset: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
  other: 'text-slate-400 bg-slate-700/30 border-slate-600/30',
};

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = Math.floor(secs % 60);
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function RunStatusDot({ run }: { run: CommandRunHistory }) {
  if (run.finished_at == null) {
    return <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="Running" />;
  }
  if (run.exit_code === 0) {
    return <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" title={`Exit 0 • ${formatDuration(run.duration_ms)}`} />;
  }
  if (run.exit_code != null) {
    return <span className="inline-block w-2 h-2 rounded-full bg-rose-500" title={`Exit ${run.exit_code} • ${formatDuration(run.duration_ms)}`} />;
  }
  return <span className="inline-block w-2 h-2 rounded-full bg-slate-500" title="No exit code" />;
}

function RunHistoryInline({ runs }: { runs: CommandRunHistory[] }) {
  if (runs.length === 0) return null;
  // Show last 5 runs as dots
  const recent = runs.slice(0, 5);
  return (
    <div className="flex items-center gap-1" title="Recent runs (newest first)">
      {recent.map(r => <RunStatusDot key={r.id} run={r} />)}
    </div>
  );
}

function RunHistoryTable({ runs }: { runs: CommandRunHistory[] }) {
  if (runs.length === 0) {
    return <div className="text-xs text-slate-600 py-2">No run history yet.</div>;
  }
  return (
    <div className="mt-3 border-t border-slate-800 pt-3">
      <div className="flex items-center gap-1.5 mb-2">
        <History className="w-3 h-3 text-slate-500" />
        <span className="text-[11px] uppercase tracking-wider font-medium text-slate-500">Run History</span>
        <span className="text-[11px] text-slate-600">({runs.length})</span>
      </div>
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {runs.map(r => (
          <div key={r.id} className="flex items-center gap-3 text-xs py-1 px-2 rounded bg-slate-950/60">
            <RunStatusDot run={r} />
            <span className="text-slate-400 tabular-nums w-16 shrink-0">{formatTimeAgo(r.started_at)}</span>
            <span className={`tabular-nums w-12 shrink-0 ${r.exit_code === 0 ? 'text-emerald-400' : r.exit_code != null ? 'text-rose-400' : 'text-slate-500'}`}>
              {r.finished_at == null ? 'running' : r.exit_code != null ? `exit ${r.exit_code}` : 'killed'}
            </span>
            <span className="text-slate-500 tabular-nums w-16 shrink-0">{formatDuration(r.duration_ms)}</span>
            <span className="text-slate-600 text-[10px]">{r.triggered_by}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CommandRow({
  cmd, runs, onSave, onRemove, projectId, projectSlug, repoPath, daemonOnline, onChange,
}: {
  cmd: CommandProfile;
  runs: CommandRunHistory[];
  onSave: (c: CommandProfile) => void;
  onRemove: (id: string) => void;
  projectId: string;
  projectSlug: string;
  repoPath: string;
  daemonOnline: boolean;
  onChange: () => void;
}) {
  const [c, setC] = useState(cmd);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const activeRunId = useRef<string | null>(null);
  const startTime = useRef<number>(0);

  function save() { onSave(c); }

  async function toggle() {
    if (running) {
      // Stop
      if (daemonOnline) {
        try { await stopProcess(projectSlug, c.id); } catch { /* daemon may not be tracking it */ }
      }
      // Record finish
      if (activeRunId.current) {
        const duration = Date.now() - startTime.current;
        await updateCommandRun(activeRunId.current, {
          finished_at: new Date().toISOString(),
          duration_ms: duration,
          exit_code: null, // manual stop — no exit code
        }).catch((err: unknown) => { console.error('Failed to record command stop:', err); });
        activeRunId.current = null;
      }
      setRunning(false);
      onChange();
      return;
    }

    if (c.must_confirm && !confirm('This command is flagged as requiring confirmation. Continue?')) return;

    // Record start
    try {
      const entry = await insertCommandRun({
        command_id: c.id,
        project_id: projectId,
        started_at: new Date().toISOString(),
        triggered_by: 'manual',
      });
      activeRunId.current = entry.id;
      startTime.current = Date.now();
    } catch { /* non-blocking */ }

    // Start via daemon if online
    if (daemonOnline && c.command) {
      try {
        await startProcess({
          slug: projectSlug,
          cmdId: c.id,
          command: c.command,
          cwd: c.working_dir || repoPath || undefined,
          name: c.name,
          kind: c.kind,
        });
      } catch { /* daemon start failed — still track locally */ }
    }

    setRunning(true);
  }

  const kindStyle = KIND_TONE[c.kind] || KIND_TONE.other;

  return (
    <div className={`border rounded transition-colors ${expanded ? 'border-slate-700 bg-slate-900/60' : 'border-slate-800/60 bg-slate-950/40 hover:border-slate-700/60'}`}>
      {/* Compact row */}
      <div className="flex items-center gap-3 px-3 py-2">
        <button onClick={() => setExpanded(e => !e)} className="shrink-0 text-slate-600 hover:text-slate-400 transition-colors">
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wider border rounded px-1.5 py-0.5 ${kindStyle}`}>{c.kind}</span>
        <span className="text-sm text-slate-200 min-w-0 truncate flex-1">{c.name}</span>
        <RunHistoryInline runs={runs} />
        {c.working_dir && <span className="text-xs text-slate-600 font-mono shrink-0 hidden sm:block truncate max-w-[140px]">{c.working_dir}</span>}
        <span className="text-xs text-slate-400 font-mono shrink-0 truncate max-w-[200px]">{c.command}</span>
        {running && <Badge tone="emerald">running</Badge>}
        {c.must_confirm && !running && <Badge tone="amber">confirm</Badge>}
        <div className="flex gap-1 shrink-0 ml-1">
          <button onClick={toggle} className={`p-1 rounded transition-colors ${running ? 'text-emerald-400 hover:text-slate-300' : 'text-slate-500 hover:text-emerald-400'}`}>
            {running ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => onRemove(c.id)} className="p-1 rounded text-slate-600 hover:text-rose-400 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Expanded edit form + history */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-slate-800">
          <div className="grid grid-cols-12 gap-3 mt-3">
            <div className="col-span-3"><Field label="Name"><Input value={c.name} onChange={e => setC({ ...c, name: e.target.value })} onBlur={save} /></Field></div>
            <div className="col-span-2"><Field label="Kind">
              <Select value={c.kind} onChange={e => { const u = { ...c, kind: e.target.value }; setC(u); onSave(u); }}>
                {['dev', 'start', 'build', 'test', 'lint', 'migrate', 'seed', 'reset', 'other'].map(k => <option key={k}>{k}</option>)}
              </Select>
            </Field></div>
            <div className="col-span-5"><Field label="Command"><Input className="font-mono" value={c.command} onChange={e => setC({ ...c, command: e.target.value })} onBlur={save} placeholder="pnpm dev" /></Field></div>
            <div className="col-span-2"><Field label="Expected port"><Input type="number" value={c.expected_port ?? ''} onChange={e => setC({ ...c, expected_port: e.target.value ? Number(e.target.value) : null })} onBlur={save} /></Field></div>
            <div className="col-span-5"><Field label="Working dir"><Input className="font-mono" value={c.working_dir} onChange={e => setC({ ...c, working_dir: e.target.value })} onBlur={save} /></Field></div>
            <div className="col-span-5"><Field label="Health URL"><UrlInputRow value={c.health_url} onChange={e => setC({ ...c, health_url: e.target.value })} onBlur={save} placeholder="http://127.0.0.1:3000/health" openLabel="Open health URL" /></Field></div>
            <div className="col-span-2 flex items-end pb-0.5">
              <label className="flex items-center gap-1.5 text-xs text-slate-400">
                <input type="checkbox" checked={c.must_confirm} onChange={e => { const u = { ...c, must_confirm: e.target.checked }; setC(u); onSave(u); }} />
                Must confirm
              </label>
            </div>
          </div>
          <RunHistoryTable runs={runs} />
        </div>
      )}
    </div>
  );
}

function KindSection({
  kind, cmds, runsByCommand, onSave, onRemove, projectId, projectSlug, repoPath, daemonOnline, onChange,
}: {
  kind: string;
  cmds: CommandProfile[];
  runsByCommand: Record<string, CommandRunHistory[]>;
  onSave: (c: CommandProfile) => void;
  onRemove: (id: string) => void;
  projectId: string;
  projectSlug: string;
  repoPath: string;
  daemonOnline: boolean;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(KIND_DEFAULT_OPEN.has(kind));
  return (
    <div className="border border-slate-800 rounded overflow-hidden mb-2">
      <button
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800/60 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
        <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">{kind}</span>
        <span className="text-xs text-slate-500 ml-1">{cmds.length}</span>
      </button>
      {open && (
        <div className="p-3 space-y-3 bg-slate-950/40">
          {cmds.map(c => (
            <CommandRow
              key={c.id}
              cmd={c}
              runs={runsByCommand[c.id] || []}
              onSave={onSave}
              onRemove={onRemove}
              projectId={projectId}
              projectSlug={projectSlug}
              repoPath={repoPath}
              daemonOnline={daemonOnline}
              onChange={onChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function CommandsTab({ scope, onChange }: { scope: ProjectScope; onChange: () => void }) {
  const daemonOnline = useDaemonOnline();
  const currentMachine = useCurrentMachine();
  const repoPath = getEffectiveRepoPath(scope, currentMachine);
  const [syncing, setSyncing] = useState(false);
  const [importMode, setImportMode] = useState(false);

  async function importCommands(items: unknown[]) {
    for (let i = 0; i < items.length; i++) {
      const c = items[i] as any;
      if (typeof c !== 'object' || c === null) throw new Error(`Item ${i + 1}: must be an object`);
      if (typeof c.name !== 'string' || !c.name.trim()) throw new Error(`Item ${i + 1}: "name" (string) is required`);
      if (typeof c.command !== 'string' || !c.command.trim()) throw new Error(`Item ${i + 1}: "command" (string) is required`);
    }
    for (const item of items) {
      const c = item as any;
      await upsertRow<CommandProfile>('command_profiles', {
        project_id: scope.project.id,
        name: c.name.trim(),
        kind: c.kind?.trim() || 'other',
        command: c.command.trim(),
        working_dir: c.working_dir?.trim() || '',
        expected_port: typeof c.expected_port === 'number' ? c.expected_port : null,
        health_url: c.health_url?.trim() || '',
        must_confirm: c.must_confirm ?? false,
        notes: c.notes?.trim() || '',
      } as any);
    }
    setImportMode(false);
    onChange();
  }

  // Group run history by command_id for O(1) lookups
  const runsByCommand: Record<string, CommandRunHistory[]> = {};
  for (const run of scope.command_run_history || []) {
    if (!runsByCommand[run.command_id]) runsByCommand[run.command_id] = [];
    runsByCommand[run.command_id].push(run);
  }

  async function syncFromDaemon() {
    if (!repoPath) return;
    setSyncing(true);
    try {
      const detected = await detectProject(repoPath);
      const existing = new Set(scope.commands.map(c => `${c.command}::${c.working_dir}`));
      const toAdd = detected.commands.filter(c => c.command && !existing.has(`${c.command}::${c.working_dir ?? ''}`));
      for (const c of toAdd) {
        await upsertRow<CommandProfile>('command_profiles', {
          project_id: scope.project.id,
          name: c.name, kind: c.kind, command: c.command,
          working_dir: c.working_dir ?? '', expected_port: c.expected_port ?? null,
          health_url: c.health_url ?? '', must_confirm: c.must_confirm ?? false,
        } as any);
      }
      if (toAdd.length > 0) { onChange(); alert(`Added ${toAdd.length} command(s).`); }
      else alert('Nothing new detected — all commands already configured or none found.');
    } catch (e: any) {
      alert(`Auto-fill failed: ${e.message}\n\nMake sure the daemon is running the latest version: stop and re-run "ldc daemon"`);
    } finally { setSyncing(false); }
  }

  async function addCommand() {
    await upsertRow<CommandProfile>('command_profiles', {
      project_id: scope.project.id,
      name: 'New command',
      kind: 'dev',
      command: '',
    } as any);
    onChange();
  }

  async function update(cmd: CommandProfile) {
    const prev = scope.commands.find(c => c.id === cmd.id);
    if (
      prev
      && prev.expected_port
      && cmd.expected_port
      && prev.expected_port !== cmd.expected_port
    ) {
      await updateCommandExpectedPort(cmd.id, cmd.expected_port);
      await upsertRow<CommandProfile>('command_profiles', cmd);
    } else {
      await upsertRow<CommandProfile>('command_profiles', cmd);
    }
    onChange();
  }

  async function remove(id: string) {
    await deleteRow('command_profiles', id);
    onChange();
  }

  // Group commands by kind, preserving KIND_ORDER
  const grouped = KIND_ORDER.reduce<Record<string, CommandProfile[]>>((acc, k) => {
    const cmds = scope.commands.filter(c => (c.kind || 'other') === k);
    if (cmds.length > 0) acc[k] = cmds;
    return acc;
  }, {});
  // Append any kinds not in KIND_ORDER (shouldn't happen but safe)
  for (const c of scope.commands) {
    const k = c.kind || 'other';
    if (!grouped[k]) grouped[k] = scope.commands.filter(x => (x.kind || 'other') === k);
  }

  return (
    <div className="space-y-4">
      {importMode && (
        <JsonImportPanel
          title="Import Commands from JSON"
          template={COMMANDS_TEMPLATE}
          schemaHint={'Required: name, command\nOptional: kind (dev|build|test|lint|migrate|seed|reset|other), working_dir, expected_port, health_url, must_confirm, notes'}
          onImport={importCommands}
          onClose={() => setImportMode(false)}
        />
      )}

      <Card>
        <CardHeader title="Commands" action={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setImportMode(m => !m)}>
              <FileJson className="w-3 h-3 inline mr-1" />Import JSON
            </Button>
            {daemonOnline && repoPath && (
              <Button variant="ghost" disabled={syncing} onClick={syncFromDaemon} title="Auto-fill from project files">
                <Zap className="w-3 h-3" />
              </Button>
            )}
            <Button onClick={addCommand}><Plus className="w-3 h-3 inline mr-1" />Add</Button>
          </div>
        } />
        <div className="p-5 space-y-1">
          {scope.commands.length === 0 && <div className="text-sm text-slate-500">No commands yet. Add dev, build, test, migrate commands so the agent knows how to run this project.</div>}
          {Object.entries(grouped).map(([kind, cmds]) => (
            <KindSection
              key={kind}
              kind={kind}
              cmds={cmds}
              runsByCommand={runsByCommand}
              onSave={update}
              onRemove={remove}
              projectId={scope.project.id}
              projectSlug={scope.project.slug}
              repoPath={repoPath}
              daemonOnline={daemonOnline}
              onChange={onChange}
            />
          ))}
        </div>
      </Card>
      <div className="text-xs text-slate-500 px-1">
        Run history is recorded automatically when commands are executed. The <span className="font-mono text-slate-400">ldc</span> daemon captures exit codes and duration when running locally.
      </div>
    </div>
  );
}
