import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Trash2, Zap, Activity, RefreshCw } from 'lucide-react';
import type { ProjectScope, ProjectPort } from '../../lib/types';
import { upsertRow, deleteRow, getEffectiveRepoPath, updatePortNumber } from '../../lib/api';
import { detectProject, probeHealthUrls, type HealthCheckResult } from '../../lib/daemon';
import { useDaemonOnline } from '../../lib/useDaemonOnline';
import { useCurrentMachine } from '../../lib/useCurrentMachine';
import { Card, CardHeader, Field, Input, Select, Button, Badge } from '../ui';
import { UrlInputRow } from '../ExternalLink';

type HealthMap = Record<string, HealthCheckResult>;

function HealthBadge({ result }: { result?: HealthCheckResult }) {
  if (!result) return <Badge tone="slate">not checked</Badge>;
  if (result.status === 0) {
    return <Badge tone="rose">{result.statusText || 'unreachable'}</Badge>;
  }
  const tone = result.ok ? 'emerald' : result.status >= 500 ? 'rose' : 'amber';
  return (
    <Badge tone={tone}>
      {result.status} &middot; {result.responseMs}ms
    </Badge>
  );
}

function BodyPreview({ result }: { result?: HealthCheckResult }) {
  if (!result || !result.bodySnippet) return null;
  let parsed: string | null = null;
  try {
    const json = JSON.parse(result.bodySnippet);
    parsed = JSON.stringify(json, null, 2);
  } catch { /* not JSON */ }

  return (
    <details className="mt-2">
      <summary className="text-[10px] text-slate-500 cursor-pointer hover:text-slate-400 select-none">
        response body
      </summary>
      <pre className="mt-1 text-[11px] text-slate-400 bg-slate-950 border border-slate-800 rounded p-2 overflow-auto max-h-32 font-mono whitespace-pre-wrap break-all">
        {parsed ?? result.bodySnippet}
      </pre>
    </details>
  );
}

function PortRow({
  pt, health, onSave, onRemove,
}: {
  pt: ProjectPort;
  health?: HealthCheckResult;
  onSave: (p: ProjectPort) => void;
  onRemove: (id: string) => void;
}) {
  const [p, setP] = useState(pt);

  // Sync with parent when pt changes (e.g. after auto-detect sync)
  useEffect(() => { setP(pt); }, [pt]);

  function save() { onSave(p); }

  return (
    <div className="bg-slate-950 border border-slate-800 rounded p-4">
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-3"><Field label="Label"><Input value={p.label} onChange={e => setP({ ...p, label: e.target.value })} onBlur={save} /></Field></div>
        <div className="col-span-2"><Field label="Port"><Input type="number" value={p.port} onChange={e => setP({ ...p, port: Number(e.target.value) })} onBlur={save} /></Field></div>
        <div className="col-span-2"><Field label="Protocol">
          <Select value={p.protocol} onChange={e => { const u = { ...p, protocol: e.target.value }; setP(u); onSave(u); }}>
            <option>http</option><option>https</option><option>tcp</option><option>ws</option>
          </Select>
        </Field></div>
        <div className="col-span-5"><Field label="Local URL"><UrlInputRow value={p.local_url} onChange={e => setP({ ...p, local_url: e.target.value })} onBlur={save} openLabel="Open local URL" /></Field></div>
        <div className="col-span-10"><Field label="Health URL"><UrlInputRow placeholder="e.g. http://127.0.0.1:3000/api/health" value={p.health_url} onChange={e => setP({ ...p, health_url: e.target.value })} onBlur={save} openLabel="Open health URL" /></Field></div>
        <div className="col-span-2 flex items-end justify-end gap-2 pb-0.5">
          <Button variant="danger" onClick={() => onRemove(p.id)}><Trash2 className="w-3 h-3" /></Button>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-800">
        <HealthBadge result={health} />
        {!p.health_url && (
          <span className="text-xs text-slate-500">Add a health URL to enable HTTP monitoring.</span>
        )}
        <BodyPreview result={health} />
      </div>
    </div>
  );
}

export function PortsTab({ scope, onChange }: { scope: ProjectScope; onChange: () => void }) {
  const daemonOnline = useDaemonOnline();
  const currentMachine = useCurrentMachine();
  const repoPath = getEffectiveRepoPath(scope, currentMachine);
  const [syncing, setSyncing] = useState(false);
  const [healthMap, setHealthMap] = useState<HealthMap>({});
  const [checking, setChecking] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const runHealthChecks = useCallback(async () => {
    const targets = scope.ports
      .filter(p => p.health_url && p.health_url.trim())
      .map(p => ({ id: p.id, url: p.health_url.trim() }));
    if (targets.length === 0) return;
    if (!daemonOnline) return;
    setChecking(true);
    try {
      const results = await probeHealthUrls(targets);
      const map: HealthMap = {};
      for (const r of results) map[r.id] = r;
      setHealthMap(map);
    } catch {
      // daemon might be unreachable; leave stale results
    } finally {
      setChecking(false);
    }
  }, [scope.ports, daemonOnline]);

  // Auto-poll every 15 seconds when daemon is online and there are health URLs
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    const hasTargets = scope.ports.some(p => p.health_url && p.health_url.trim());
    if (!daemonOnline || !hasTargets) return;

    // Run immediately on mount / when ports change
    runHealthChecks();
    intervalRef.current = setInterval(runHealthChecks, 15_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [daemonOnline, runHealthChecks]);

  async function syncFromDaemon() {
    if (!repoPath) return;
    setSyncing(true);
    try {
      const detected = await detectProject(repoPath);
      const existing = new Set(scope.ports.map(p => p.port));
      const toAdd = detected.ports.filter(p => !existing.has(p.port));
      for (const p of toAdd) {
        await upsertRow<ProjectPort>('project_ports', {
          project_id: scope.project.id,
          label: p.label, port: p.port, protocol: p.protocol,
          local_url: p.local_url, health_url: p.health_url ?? '', notes: 'auto-detected',
        } as any);
      }
      if (toAdd.length > 0) { onChange(); alert(`Added ${toAdd.length} port(s).`); }
      else alert('Nothing new detected — all ports already configured or none found.');
    } catch (e: any) {
      alert(`Auto-fill failed: ${e.message}\n\nMake sure the daemon is running the latest version: stop and re-run "ldc daemon"`);
    } finally { setSyncing(false); }
  }

  async function add() {
    await upsertRow<ProjectPort>('project_ports', { project_id: scope.project.id, label: 'New port', port: 3000, protocol: 'http', local_url: 'http://127.0.0.1:3000' } as any);
    onChange();
  }
  async function update(p: ProjectPort) {
    const prev = scope.ports.find(x => x.id === p.id);
    if (prev && prev.port !== p.port && p.port > 0) {
      await updatePortNumber(p.id, prev.port, p.port);
      if (p.label !== prev.label || p.protocol !== prev.protocol || p.notes !== prev.notes) {
        await upsertRow<ProjectPort>('project_ports', p);
      }
    } else {
      await upsertRow<ProjectPort>('project_ports', p);
    }
    onChange();
  }
  async function remove(id: string) {
    await deleteRow('project_ports', id);
    setHealthMap(prev => { const next = { ...prev }; delete next[id]; return next; });
    onChange();
  }

  const hasHealthUrls = scope.ports.some(p => p.health_url && p.health_url.trim());

  return (
    <Card>
      <CardHeader title="Ports" action={
        <div className="flex items-center gap-2">
          {daemonOnline && hasHealthUrls && (
            <Button variant="ghost" disabled={checking} onClick={runHealthChecks} title="Run health checks now">
              {checking
                ? <RefreshCw className="w-3 h-3 animate-spin" />
                : <Activity className="w-3 h-3" />}
            </Button>
          )}
          {daemonOnline && repoPath && (
            <Button variant="ghost" disabled={syncing} onClick={syncFromDaemon} title="Auto-fill from project files">
              <Zap className="w-3 h-3" />
            </Button>
          )}
          <Button onClick={add}><Plus className="w-3 h-3 inline mr-1" />Add</Button>
        </div>
      } />
      <div className="p-5 space-y-3">
        {scope.ports.length === 0 && <div className="text-sm text-slate-500">No ports configured.</div>}
        {scope.ports.map(pt => (
          <PortRow key={pt.id} pt={pt} health={healthMap[pt.id]} onSave={update} onRemove={remove} />
        ))}
        {daemonOnline && hasHealthUrls && (
          <div className="text-[10px] text-slate-600 pt-1">
            Health checks auto-refresh every 15s while daemon is online.
          </div>
        )}
      </div>
    </Card>
  );
}
