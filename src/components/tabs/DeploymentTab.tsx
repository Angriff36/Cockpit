import { useEffect, useRef, useState, useMemo } from 'react';
import { Plus, Trash2, ExternalLink, Zap, Rocket, ChevronDown, ChevronUp, Square, Loader2, ArrowUpDown, History, FileJson } from 'lucide-react';
import type { ProjectScope, DeploymentTarget, DeploymentHistoryEntry } from '../../lib/types';
import { upsertRow, deleteRow, insertDeploymentHistory, updateDeploymentHistory, listDeploymentHistory, getEffectiveRepoPath } from '../../lib/api';
import { useCurrentMachine } from '../../lib/useCurrentMachine';
import { detectProject, triggerDeploy, stopProcess, listProcesses, streamLogs, type DaemonLogEntry, type DaemonProcess } from '../../lib/daemon';
import { useDaemonOnline } from '../../lib/useDaemonOnline';
import { Card, CardHeader, Field, Input, Select, Button, Badge, Textarea } from '../ui';
import { UrlField, UrlInputRow } from '../ExternalLink';
import { GitHubDeployButton } from '../GitHubDeployButton';
import { ansiToHtml } from '../../lib/ansi';
import { JsonImportPanel } from '../JsonImportPanel';

const DEPLOYMENT_TEMPLATE = [
  {
    platform: 'vercel',
    environment: 'production',
    branch: 'main',
    region: 'iad1',
    platform_project_id: '',
    platform_project_name: 'my-app',
    team_or_org: '',
    deploy_command: 'vercel --prod',
    build_command: 'npm run build',
    production_url: 'https://my-app.vercel.app',
    preview_url_pattern: 'https://my-app-{{branch}}.vercel.app',
    dashboard_url: 'https://vercel.com/dashboard',
    logs_url: '',
    github_workflow_file: 'deploy.yml',
    domains: 'my-app.com, www.my-app.com',
    env_source: '',
    notes: '',
  },
];

// ── Deploy log panel ─────────────────────────────────────────────────────────

function DeployLogPanel({ slug, cmdId, daemonOnline }: { slug: string; cmdId: string; daemonOnline: boolean }) {
  const [logs, setLogs] = useState<DaemonLogEntry[]>([]);
  const logsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (!daemonOnline) return;
    const close = streamLogs(slug, cmdId, {
      onBacklog: (lines) => setLogs(lines),
      onLines: (newLines) => setLogs(prev => {
        const merged = [...prev, ...newLines];
        return merged.length > 500 ? merged.slice(-500) : merged;
      }),
    });
    return close;
  }, [daemonOnline, slug, cmdId]);

  return (
    <div
      ref={logsRef}
      className="border-t border-slate-800 bg-black/40 px-4 py-3 h-52 overflow-y-auto"
    >
      {logs.length === 0 ? (
        <span className="text-xs text-slate-600 italic">Waiting for output…</span>
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
  );
}

// ── Deployment status type ───────────────────────────────────────────────────

type DeployStatus = 'idle' | 'deploying' | 'success' | 'failed';

function statusBadge(status: DeployStatus) {
  switch (status) {
    case 'deploying': return <Badge tone="amber">● deploying</Badge>;
    case 'success': return <Badge tone="emerald">✓ deployed</Badge>;
    case 'failed': return <Badge tone="rose">✗ failed</Badge>;
    default: return null;
  }
}

// ── Deployment row ───────────────────────────────────────────────────────────

function DeploymentRow({
  d: initial,
  project,
  slug,
  repoPath,
  projectId,
  daemonOnline,
  processes,
  onSave,
  onRemove,
  onProcessChange,
  onHistoryChange,
}: {
  d: DeploymentTarget;
  project: ProjectScope['project'];
  slug: string;
  repoPath: string;
  projectId: string;
  daemonOnline: boolean;
  processes: DaemonProcess[];
  onSave: (d: DeploymentTarget) => void;
  onRemove: (id: string) => void;
  onProcessChange: () => void;
  onHistoryChange: () => void;
}) {
  const [d, setD] = useState(initial);
  const [showLogs, setShowLogs] = useState(false);
  const [busy, setBusy] = useState(false);
  const pendingHistoryRef = useRef<string | null>(null);
  const prevRunningRef = useRef(false);

  const cmdId = `deploy:${d.id}`;
  const proc = processes.find(p => p.slug === slug && p.cmdId === cmdId);
  const running = proc?.running ?? false;

  // Derive deploy status from process state
  const deployStatus: DeployStatus = running
    ? 'deploying'
    : proc
      ? proc.exitCode === 0 ? 'success' : 'failed'
      : 'idle';

  // Update history entry when deploy finishes
  useEffect(() => {
    if (prevRunningRef.current && !running && pendingHistoryRef.current && proc) {
      const historyId = pendingHistoryRef.current;
      const status = proc.exitCode === 0 ? 'success' : 'failed';
      const duration = proc.exitedAt && proc.startedAt
        ? proc.exitedAt - proc.startedAt
        : null;
      updateDeploymentHistory(historyId, {
        status,
        finished_at: new Date().toISOString(),
        duration_ms: duration,
      }).then(() => onHistoryChange()).catch((err: unknown) => { console.error('Failed to update deployment history:', err); });
      pendingHistoryRef.current = null;
    }
    prevRunningRef.current = running;
  }, [running, proc]);

  function save() { onSave(d); }

  async function handleDeploy() {
    if (!d.deploy_command) return;
    if (!confirm(`Deploy to ${d.platform} (${d.environment})?\n\nCommand: ${d.deploy_command}`)) return;
    setBusy(true);
    try {
      await triggerDeploy({
        slug,
        deploymentId: d.id,
        command: d.deploy_command,
        cwd: repoPath || undefined,
        platform: d.platform,
        environment: d.environment,
      });
      // Record deployment history entry
      try {
        const entry = await insertDeploymentHistory({
          project_id: projectId,
          deployment_target_id: d.id,
          platform: d.platform,
          environment: d.environment,
          trigger_source: 'cockpit',
          status: 'deploying',
          deploy_command: d.deploy_command,
          branch: d.branch,
          deployment_url: d.production_url,
        });
        // Track this entry to update on completion
        pendingHistoryRef.current = entry.id;
        onHistoryChange();
      } catch { /* history recording is best-effort */ }
      setShowLogs(true);
      onProcessChange();
    } catch (e: any) {
      alert(`Deploy failed to start: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    setBusy(true);
    try {
      await stopProcess(slug, cmdId);
      onProcessChange();
    } catch (e: any) {
      alert(`Failed to stop: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  const canDeploy = daemonOnline && !!d.deploy_command;
  const canGitHubDeploy = !!project.repo_url?.includes('github.com') && d.platform === 'vercel';

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
      <div className="p-4">
        {/* Header: badges + deploy button */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone="blue">{d.platform}</Badge>
            <Badge tone="emerald">{d.environment}</Badge>
            {d.branch && <Badge>{d.branch}</Badge>}
            {statusBadge(deployStatus)}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {running ? (
              <Button variant="danger" disabled={busy} onClick={handleStop}>
                <Square className="w-3 h-3 inline mr-1" />Stop
              </Button>
            ) : (
              <>
                {canGitHubDeploy && (
                  <GitHubDeployButton
                    scope={{ project, deployments: [d] }}
                    deployment={d}
                    onDeployed={onHistoryChange}
                    compact
                  />
                )}
                {canDeploy && (
                  <Button disabled={busy} onClick={handleDeploy}>
                    {busy
                      ? <Loader2 className="w-3 h-3 inline mr-1 animate-spin" />
                      : <Rocket className="w-3 h-3 inline mr-1" />
                    }
                    Local
                  </Button>
                )}
              </>
            )}
            {(proc || showLogs) && (
              <Button variant="ghost" title="Toggle deploy logs" onClick={() => setShowLogs(v => !v)}>
                {showLogs ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </Button>
            )}
          </div>
        </div>

        {/* Config fields */}
        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-3"><Field label="Platform">
            <Select value={d.platform} onChange={e => { const u = { ...d, platform: e.target.value }; setD(u); onSave(u); }}>
              {['vercel', 'render', 'fly', 'railway', 'supabase', 'self-hosted', 'vps', 'custom'].map(p => <option key={p}>{p}</option>)}
            </Select>
          </Field></div>
          <div className="col-span-3"><Field label="Environment"><Input value={d.environment} onChange={e => setD({ ...d, environment: e.target.value })} onBlur={save} /></Field></div>
          <div className="col-span-3"><Field label="Region"><Input value={d.region} onChange={e => setD({ ...d, region: e.target.value })} onBlur={save} /></Field></div>
          <div className="col-span-3"><Field label="Branch"><Input value={d.branch} onChange={e => setD({ ...d, branch: e.target.value })} onBlur={save} /></Field></div>
          <div className="col-span-6"><Field label="Project ID"><Input className="font-mono" value={d.platform_project_id} onChange={e => setD({ ...d, platform_project_id: e.target.value })} onBlur={save} /></Field></div>
          <div className="col-span-6"><Field label="Project name"><Input value={d.platform_project_name} onChange={e => setD({ ...d, platform_project_name: e.target.value })} onBlur={save} /></Field></div>
          <div className="col-span-6"><Field label="Team / org"><Input value={d.team_or_org} onChange={e => setD({ ...d, team_or_org: e.target.value })} onBlur={save} /></Field></div>
          <div className="col-span-6"><Field label="Env source"><Input value={d.env_source} onChange={e => setD({ ...d, env_source: e.target.value })} onBlur={save} placeholder="vercel-env | infisical | .env" /></Field></div>
          <UrlField label="Production URL" value={d.production_url}>
            <UrlInputRow value={d.production_url} onChange={e => setD({ ...d, production_url: e.target.value })} onBlur={save} openLabel="Open production site" />
          </UrlField>
          <Field label="Preview URL pattern"><Input className="font-mono" value={d.preview_url_pattern} onChange={e => setD({ ...d, preview_url_pattern: e.target.value })} onBlur={save} placeholder="https://{project}-{branch}.vercel.app" /></Field>
          <UrlField label="Dashboard URL" value={d.dashboard_url}>
            <UrlInputRow value={d.dashboard_url} onChange={e => setD({ ...d, dashboard_url: e.target.value })} onBlur={save} openLabel="Open dashboard" />
          </UrlField>
          <UrlField label="Logs URL" value={d.logs_url}>
            <UrlInputRow value={d.logs_url} onChange={e => setD({ ...d, logs_url: e.target.value })} onBlur={save} openLabel="Open logs" />
          </UrlField>
          <div className="col-span-6"><Field label="Deploy command"><Input className="font-mono" value={d.deploy_command} onChange={e => setD({ ...d, deploy_command: e.target.value })} onBlur={save} placeholder="vercel --prod" /></Field></div>
          <div className="col-span-6"><Field label="GitHub workflow file"><Input className="font-mono" value={d.github_workflow_file ?? ''} onChange={e => setD({ ...d, github_workflow_file: e.target.value })} onBlur={save} placeholder="deploy.yml (optional, auto-detect if empty)" /></Field></div>
          <div className="col-span-6"><Field label="Build command"><Input className="font-mono" value={d.build_command} onChange={e => setD({ ...d, build_command: e.target.value })} onBlur={save} /></Field></div>
          <div className="col-span-12"><Field label="Domains"><Input value={d.domains} onChange={e => setD({ ...d, domains: e.target.value })} onBlur={save} placeholder="app.example.com, www.example.com" /></Field></div>
          <div className="col-span-12"><Field label="Notes"><Textarea rows={2} value={d.notes} onChange={e => setD({ ...d, notes: e.target.value })} onBlur={save} /></Field></div>
        </div>

        {/* Footer: links + delete */}
        <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-slate-800">
          {d.production_url && <a href={d.production_url} target="_blank" rel="noreferrer"><Button variant="secondary"><ExternalLink className="w-3 h-3 inline mr-1" />Prod</Button></a>}
          {d.dashboard_url && <a href={d.dashboard_url} target="_blank" rel="noreferrer"><Button variant="secondary"><ExternalLink className="w-3 h-3 inline mr-1" />Dashboard</Button></a>}
          {d.logs_url && <a href={d.logs_url} target="_blank" rel="noreferrer"><Button variant="secondary"><ExternalLink className="w-3 h-3 inline mr-1" />Logs</Button></a>}
          <Button variant="danger" onClick={() => onRemove(d.id)}><Trash2 className="w-3 h-3" /></Button>
        </div>
      </div>

      {/* Live deploy log panel */}
      {showLogs && (
        <DeployLogPanel slug={slug} cmdId={cmdId} daemonOnline={daemonOnline} />
      )}
    </div>
  );
}

// ── History table ─────────────────────────────────────────────────────────────

type SortField = 'started_at' | 'platform' | 'status' | 'trigger_source' | 'duration_ms';
type SortDir = 'asc' | 'desc';

function historyStatusBadge(status: string) {
  switch (status) {
    case 'deploying': return <Badge tone="amber">● deploying</Badge>;
    case 'success': return <Badge tone="emerald">✓ success</Badge>;
    case 'failed': return <Badge tone="rose">✗ failed</Badge>;
    default: return <Badge>{status}</Badge>;
  }
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function DeploymentHistoryTable({ history }: { history: DeploymentHistoryEntry[] }) {
  const [sortField, setSortField] = useState<SortField>('started_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  }

  const sorted = useMemo(() => {
    const copy = [...history];
    copy.sort((a, b) => {
      let av: string | number, bv: string | number;
      switch (sortField) {
        case 'started_at': av = a.started_at; bv = b.started_at; break;
        case 'platform': av = a.platform; bv = b.platform; break;
        case 'status': av = a.status; bv = b.status; break;
        case 'trigger_source': av = a.trigger_source; bv = b.trigger_source; break;
        case 'duration_ms': av = a.duration_ms ?? -1; bv = b.duration_ms ?? -1; break;
        default: av = ''; bv = '';
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
  }, [history, sortField, sortDir]);

  function SortHeader({ field, children }: { field: SortField; children: React.ReactNode }) {
    return (
      <th
        className="px-3 py-2 text-left text-xs font-medium text-slate-400 cursor-pointer select-none hover:text-slate-200 transition-colors"
        onClick={() => toggleSort(field)}
      >
        <span className="inline-flex items-center gap-1">
          {children}
          {sortField === field && (
            <ArrowUpDown className="w-3 h-3 opacity-60" />
          )}
        </span>
      </th>
    );
  }

  if (history.length === 0) {
    return <div className="text-sm text-slate-500 py-2">No deployment history yet.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-800">
            <SortHeader field="started_at">Time</SortHeader>
            <SortHeader field="platform">Platform</SortHeader>
            <th className="px-3 py-2 text-left text-xs font-medium text-slate-400">Env</th>
            <SortHeader field="trigger_source">Trigger</SortHeader>
            <SortHeader field="status">Status</SortHeader>
            <SortHeader field="duration_ms">Duration</SortHeader>
            <th className="px-3 py-2 text-left text-xs font-medium text-slate-400">URL</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(h => (
            <tr key={h.id} className="border-b border-slate-800/50 hover:bg-slate-900/50">
              <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{formatTime(h.started_at)}</td>
              <td className="px-3 py-2"><Badge tone="blue">{h.platform}</Badge></td>
              <td className="px-3 py-2 text-slate-400">{h.environment}</td>
              <td className="px-3 py-2 text-slate-400">{h.trigger_source}</td>
              <td className="px-3 py-2">{historyStatusBadge(h.status)}</td>
              <td className="px-3 py-2 text-slate-400 font-mono text-xs">{formatDuration(h.duration_ms)}</td>
              <td className="px-3 py-2">
                {h.deployment_url && (
                  <a href={h.deployment_url} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300 text-xs font-mono truncate max-w-[200px] inline-block">
                    {h.deployment_url.replace(/^https?:\/\//, '')}
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main tab ─────────────────────────────────────────────────────────────────

export function DeploymentTab({ scope, onChange }: { scope: ProjectScope; onChange: () => void }) {
  const daemonOnline = useDaemonOnline();
  const [syncing, setSyncing] = useState(false);
  const [importMode, setImportMode] = useState(false);
  const [processes, setProcesses] = useState<DaemonProcess[]>([]);
  const [history, setHistory] = useState<DeploymentHistoryEntry[]>(scope.deployment_history || []);
  const [showHistory, setShowHistory] = useState(true);

  async function importTargets(items: unknown[]) {
    for (let i = 0; i < items.length; i++) {
      const t = items[i] as any;
      if (typeof t !== 'object' || t === null) throw new Error(`Item ${i + 1}: must be an object`);
      if (typeof t.platform !== 'string' || !t.platform.trim()) throw new Error(`Item ${i + 1}: "platform" (string) is required`);
    }
    for (const item of items) {
      const t = item as any;
      await upsertRow<DeploymentTarget>('deployment_targets', {
        project_id: scope.project.id,
        platform: t.platform.trim(),
        environment: t.environment?.trim() || 'production',
        branch: t.branch?.trim() || '',
        region: t.region?.trim() || '',
        platform_project_id: t.platform_project_id?.trim() || '',
        platform_project_name: t.platform_project_name?.trim() || '',
        team_or_org: t.team_or_org?.trim() || '',
        deploy_command: t.deploy_command?.trim() || '',
        build_command: t.build_command?.trim() || '',
        production_url: t.production_url?.trim() || '',
        preview_url_pattern: t.preview_url_pattern?.trim() || '',
        dashboard_url: t.dashboard_url?.trim() || '',
        logs_url: t.logs_url?.trim() || '',
        github_workflow_file: t.github_workflow_file?.trim() || '',
        domains: t.domains?.trim() || '',
        env_source: t.env_source?.trim() || '',
        notes: t.notes?.trim() || '',
      } as any);
    }
    setImportMode(false);
    onChange();
  }

  const currentMachine = useCurrentMachine();

  const slug = scope.project.slug;
  const repoPath = getEffectiveRepoPath(scope, currentMachine);
  const projectId = scope.project.id;

  function refreshHistory() {
    listDeploymentHistory(projectId).then(setHistory).catch((err: unknown) => { console.error('Failed to refresh deployment history:', err); });
  }

  // Poll daemon for deploy process status
  useEffect(() => {
    if (!daemonOnline) {
      setProcesses([]);
      return;
    }

    let cancelled = false;

    async function poll() {
      try {
        const all = await listProcesses();
        if (!cancelled) {
          // Only keep deploy processes for this project
          setProcesses(all.filter(p => p.slug === slug && p.cmdId.startsWith('deploy:')));
        }
      } catch {}
    }

    poll();
    const id = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [daemonOnline, slug]);

  function refreshProcesses() {
    listProcesses().then(all => {
      setProcesses(all.filter(p => p.slug === slug && p.cmdId.startsWith('deploy:')));
    }).catch(() => {});
  }

  async function syncFromDaemon() {
    if (!repoPath) return;
    setSyncing(true);
    try {
      const detected = await detectProject(repoPath);
      const existing = new Set(scope.deployments.map(d => `${d.platform}:${d.environment}`));
      const toAdd = detected.deployments.filter(d => !existing.has(`${d.platform}:${d.environment}`));
      for (const d of toAdd) {
        await upsertRow<DeploymentTarget>('deployment_targets', {
          project_id: scope.project.id,
          platform: d.platform, environment: d.environment,
          production_url: d.production_url ?? '', notes: 'auto-detected',
        } as any);
      }
      if (toAdd.length > 0) { onChange(); alert(`Added ${toAdd.length} deployment target(s).`); }
      else alert('Nothing new detected — all deployments already configured or none found.');
    } catch (e: any) {
      alert(`Auto-fill failed: ${e.message}\n\nMake sure the daemon is running the latest version: stop and re-run "ldc daemon"`);
    } finally { setSyncing(false); }
  }

  async function add() {
    await upsertRow<DeploymentTarget>('deployment_targets', { project_id: scope.project.id, platform: 'vercel', environment: 'production' } as any);
    onChange();
  }
  async function update(d: DeploymentTarget) { await upsertRow<DeploymentTarget>('deployment_targets', d); onChange(); }
  async function remove(id: string) { await deleteRow('deployment_targets', id); onChange(); }

  return (
    <div className="space-y-6">
      {importMode && (
        <JsonImportPanel
          title="Import Deployment Targets from JSON"
          template={DEPLOYMENT_TEMPLATE}
          schemaHint={'Required: platform\nOptional: environment, branch, region, platform_project_id, platform_project_name, team_or_org, deploy_command, build_command, production_url, preview_url_pattern, dashboard_url, logs_url, github_workflow_file, domains, env_source, notes'}
          onImport={importTargets}
          onClose={() => setImportMode(false)}
        />
      )}

      <Card>
        <CardHeader title="Deployment targets" action={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setImportMode(m => !m)}>
              <FileJson className="w-3 h-3 inline mr-1" />Import JSON
            </Button>
            {daemonOnline && repoPath && (
              <Button variant="ghost" disabled={syncing} onClick={syncFromDaemon} title="Auto-fill from project files">
                <Zap className="w-3 h-3" />
              </Button>
            )}
            <Button onClick={add}><Plus className="w-3 h-3 inline mr-1" />Add</Button>
          </div>
        } />
        <div className="p-5 space-y-4">
          {scope.deployments.length === 0 && <div className="text-sm text-slate-500">No deployment targets configured.</div>}
          {scope.deployments.map(d => (
            <DeploymentRow
              key={d.id}
              d={d}
              project={scope.project}
              slug={slug}
              repoPath={repoPath}
              projectId={projectId}
              daemonOnline={daemonOnline}
              processes={processes}
              onSave={update}
              onRemove={remove}
              onProcessChange={() => setTimeout(refreshProcesses, 500)}
              onHistoryChange={refreshHistory}
            />
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Deployment history" action={
          <Button variant="ghost" onClick={() => setShowHistory(v => !v)} title="Toggle history">
            <History className="w-3 h-3 inline mr-1" />
            {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </Button>
        } />
        {showHistory && (
          <div className="p-5">
            <DeploymentHistoryTable history={history} />
          </div>
        )}
      </Card>
    </div>
  );
}
