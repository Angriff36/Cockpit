import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, ShieldAlert, Zap, X } from 'lucide-react';
import type { ProjectScope, DockerComposeConfig } from '../../lib/types';
import { upsertRow, deleteRow, getEffectiveRepoPath } from '../../lib/api';
import { detectProject, runDockerCompose, streamLogs } from '../../lib/daemon';
import { useDaemonOnline } from '../../lib/useDaemonOnline';
import { useCurrentMachine } from '../../lib/useCurrentMachine';
import { Card, CardHeader, Field, Input, Button, Textarea } from '../ui';

type ActionState = { cmdId: string; lines: string[]; done: boolean };

function DockerRow({ d: initial, slug, repoPath, onSave, onRemove }: {
  d: DockerComposeConfig;
  slug: string;
  repoPath: string | undefined;
  onSave: (d: DockerComposeConfig) => void;
  onRemove: (id: string) => void;
}) {
  const [d, setD] = useState(initial);
  const [actionState, setActionState] = useState<ActionState | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const cmdId = actionState?.cmdId;
    if (!cmdId) return;
    return streamLogs(slug, cmdId, {
      onBacklog: (lines) => setActionState(s => s?.cmdId === cmdId ? { ...s, lines: lines.map(l => l.text) } : s),
      onLines: (lines) => setActionState(s => s?.cmdId === cmdId ? { ...s, lines: [...s.lines, ...lines.map(l => l.text)] } : s),
      onClose: () => {
        setActionState(s => s?.cmdId === cmdId ? { ...s, done: true } : s);
        setRunning(false);
      },
    });
  }, [actionState?.cmdId, slug]);

  function save() { onSave(d); }

  async function runAction(action: string) {
    if (!repoPath) { alert('Configure a repo path for this project on this machine first.'); return; }
    const msg = ['down', 'restart'].includes(action)
      ? `Running "docker compose ${action}" can stop running services. Continue?`
      : `Run "docker compose ${action}"?`;
    if (!confirm(msg)) return;
    setRunning(true);
    try {
      const { cmdId } = await runDockerCompose({ action, compose_file_path: d.compose_file_path, cwd: repoPath, slug });
      setActionState({ cmdId, lines: [], done: false });
    } catch (err: any) {
      alert(`Failed: ${err.message}`);
      setRunning(false);
    }
  }

  return (
    <div className="bg-slate-950 border border-slate-800 rounded p-4">
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-6"><Field label="Compose file path"><Input className="font-mono" value={d.compose_file_path} onChange={e => setD({ ...d, compose_file_path: e.target.value })} onBlur={save} /></Field></div>
        <div className="col-span-6"><Field label="Compose project name"><Input value={d.compose_project_name} onChange={e => setD({ ...d, compose_project_name: e.target.value })} onBlur={save} /></Field></div>
        <div className="col-span-12"><Field label="Services"><Input value={d.services} onChange={e => setD({ ...d, services: e.target.value })} onBlur={save} placeholder="api, db, redis" /></Field></div>
        <div className="col-span-12"><Field label="Notes"><Textarea rows={2} value={d.notes} onChange={e => setD({ ...d, notes: e.target.value })} onBlur={save} /></Field></div>
      </div>
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-800">
        <div className="flex gap-2">
          <Button variant="secondary" disabled={running} onClick={() => runAction('ps')}>ps</Button>
          <Button variant="secondary" disabled={running} onClick={() => runAction('logs')}>logs</Button>
          <Button variant="secondary" disabled={running} onClick={() => runAction('up -d')}>
            {running ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            up -d
          </Button>
          <Button variant="danger" disabled={running} onClick={() => runAction('restart')}>restart</Button>
          <Button variant="danger" disabled={running} onClick={() => runAction('down')}>down</Button>
          <Button variant="danger" onClick={() => onRemove(d.id)}><Trash2 className="w-3 h-3" /></Button>
        </div>
      </div>
      {actionState && (
        <div className="mt-3 pt-3 border-t border-slate-800">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-slate-500 font-mono">
              {actionState.done ? 'output' : <span className="flex items-center gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin" />running…</span>}
            </span>
            <button onClick={() => setActionState(null)} className="text-slate-600 hover:text-slate-400">
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="bg-black rounded p-2 font-mono text-[10px] text-slate-300 max-h-40 overflow-y-auto leading-relaxed">
            {actionState.lines.length === 0 && !actionState.done && (
              <span className="text-slate-600">waiting for output…</span>
            )}
            {actionState.lines.map((line, i) => <div key={i}>{line}</div>)}
            {actionState.done && <div className="text-slate-500 mt-1 border-t border-slate-800 pt-1">process exited</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export function DockerTab({ scope, onChange }: { scope: ProjectScope; onChange: () => void }) {
  const daemonOnline = useDaemonOnline();
  const currentMachine = useCurrentMachine();
  const repoPath = getEffectiveRepoPath(scope, currentMachine);
  const [syncing, setSyncing] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false);

  useEffect(() => {
    if (autoDetected || !daemonOnline || !repoPath || scope.docker.length > 0) return;
    setAutoDetected(true);
    detectProject(repoPath).then(async detected => {
      if (detected.docker.length === 0) return;
      const existing = new Set(scope.docker.map(d => d.compose_file_path));
      const toAdd = detected.docker.filter(d => !existing.has(d.compose_file_path));
      if (toAdd.length === 0) return;
      await Promise.all(toAdd.map(d => upsertRow<DockerComposeConfig>('docker_compose_configs', {
        project_id: scope.project.id,
        compose_file_path: d.compose_file_path,
        compose_project_name: (d as any).compose_project_name ?? '',
        services: d.services ?? '',
        notes: 'auto-detected',
      } as any)));
      onChange();
    }).catch(() => {});
  }, [daemonOnline, repoPath, autoDetected]);

  async function syncFromDaemon() {
    if (!repoPath) return;
    setSyncing(true);
    try {
      const detected = await detectProject(repoPath);
      const existing = new Set(scope.docker.map(d => d.compose_file_path));
      const toAdd = detected.docker.filter(d => !existing.has(d.compose_file_path));
      for (const d of toAdd) {
        await upsertRow<DockerComposeConfig>('docker_compose_configs', {
          project_id: scope.project.id,
          compose_file_path: d.compose_file_path,
          compose_project_name: (d as any).compose_project_name ?? '',
          services: d.services ?? '', notes: 'auto-detected',
        } as any);
      }
      if (toAdd.length > 0) { onChange(); alert(`Added ${toAdd.length} docker compose config(s).`); }
      else alert('Nothing new detected — all docker configs already configured or none found.');
    } catch (e: any) {
      alert(`Auto-fill failed: ${e.message}\n\nMake sure the daemon is running the latest version: stop and re-run "ldc daemon"`);
    } finally { setSyncing(false); }
  }

  async function add() {
    await upsertRow<DockerComposeConfig>('docker_compose_configs', { project_id: scope.project.id, compose_file_path: 'docker-compose.yml' } as any);
    onChange();
  }
  async function update(d: DockerComposeConfig) { await upsertRow<DockerComposeConfig>('docker_compose_configs', d); onChange(); }
  async function remove(id: string) { await deleteRow('docker_compose_configs', id); onChange(); }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Docker Compose" action={
          <div className="flex gap-2">
            {daemonOnline && repoPath && (
              <Button variant="ghost" disabled={syncing} onClick={syncFromDaemon} title="Auto-fill from project files">
                <Zap className="w-3 h-3" />
              </Button>
            )}
            <Button onClick={add}><Plus className="w-3 h-3 inline mr-1" />Add compose</Button>
          </div>
        } />
        <div className="p-5 space-y-4">
          {scope.docker.length === 0 && <div className="text-sm text-slate-500">No Docker Compose configs yet.</div>}
          {scope.docker.map(d => (
            <DockerRow key={d.id} d={d} slug={scope.project.slug} repoPath={repoPath} onSave={update} onRemove={remove} />
          ))}
        </div>
      </Card>
      <div className="bg-amber-500/5 border border-amber-500/20 rounded px-4 py-3 flex items-start gap-2">
        <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-200/80">
          Destructive actions (down, restart) always require confirmation. Real Docker execution happens via the local <span className="font-mono">ldc</span> daemon.
        </div>
      </div>
    </div>
  );
}
