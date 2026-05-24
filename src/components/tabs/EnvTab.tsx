import { useState, useEffect } from 'react';
import { Plus, Trash2, Eye, EyeOff, KeyRound, ShieldAlert, Zap, GitCompareArrows, AlertTriangle, FileQuestion, Loader2, CheckCircle2, XCircle, HelpCircle, RefreshCw } from 'lucide-react';
import type { ProjectScope, EnvKey, InfisicalRef } from '../../lib/types';
import { upsertRow, deleteRow, getEffectiveRepoPath } from '../../lib/api';
import { detectProject, fetchEnvDiff, checkInfisicalSync } from '../../lib/daemon';
import type { EnvDiffResult, InfisicalSyncResult } from '../../lib/daemon';
import { useDaemonOnline } from '../../lib/useDaemonOnline';
import { useCurrentMachine } from '../../lib/useCurrentMachine';
import { Card, CardHeader, Field, Input, Select, Button, Badge, Textarea } from '../ui';

const CLASSIFICATIONS = ['public-browser', 'build-time', 'server-runtime', 'migrate-only', 'ci-only', 'unknown'];
const SOURCES = ['infisical', 'vercel-env', '.env', '.env.local', '.env.example', 'manual', 'other'];

function InfisicalRefRow({ i: initial, onSave, onRemove }: { i: InfisicalRef; onSave: (i: InfisicalRef) => void; onRemove: (id: string) => void }) {
  const [i, setI] = useState(initial);

  useEffect(() => {
    setI(initial);
  }, [initial]);

  const isDirty = i.infisical_project_id !== initial.infisical_project_id ||
                  i.workspace_name !== initial.workspace_name ||
                  i.environment !== initial.environment ||
                  i.secret_path !== initial.secret_path ||
                  i.run_command_pattern !== initial.run_command_pattern;

  function save() { onSave(i); }

  return (
    <div className="bg-slate-950 border border-slate-800 rounded p-4 grid grid-cols-12 gap-3">
      <div className="col-span-4">
        <Field label="Infisical project ID">
          <Input className="font-mono" value={i.infisical_project_id} onChange={e => setI({ ...i, infisical_project_id: e.target.value })} onBlur={save} placeholder="UUID from Infisical" />
        </Field>
      </div>
      <div className="col-span-4">
        <Field label="Label">
          <Input value={i.workspace_name} onChange={e => setI({ ...i, workspace_name: e.target.value })} onBlur={save} placeholder="e.g. API secrets" />
        </Field>
      </div>
      <div className="col-span-2"><Field label="Environment"><Input value={i.environment} onChange={e => setI({ ...i, environment: e.target.value })} onBlur={save} placeholder="dev" /></Field></div>
      <div className="col-span-2"><Field label="Secret path"><Input className="font-mono" value={i.secret_path} onChange={e => setI({ ...i, secret_path: e.target.value })} onBlur={save} placeholder="/" /></Field></div>
      <div className="col-span-12"><Field label="Run command pattern"><Input className="font-mono" value={i.run_command_pattern} onChange={e => setI({ ...i, run_command_pattern: e.target.value })} onBlur={save} /></Field></div>
      <div className="col-span-12 flex justify-end gap-2">
        {isDirty && (
          <Button onClick={save}>Save changes</Button>
        )}
        <Button variant="danger" onClick={() => onRemove(i.id)}><Trash2 className="w-3 h-3" /></Button>
      </div>
    </div>
  );
}

function EnvKeyRow({ k: initial, reveal, onSave, onRemove }: { k: EnvKey; reveal: boolean; onSave: (k: EnvKey) => void; onRemove: (id: string) => void }) {
  const [k, setK] = useState(initial);

  function save() { onSave(k); }

  return (
    <div className="bg-slate-950 border border-slate-800 rounded p-3 grid grid-cols-12 gap-3 items-start">
      <div className="col-span-3"><Field label="Key name">
        <div className="flex items-center gap-2">
          <KeyRound className="w-3 h-3 text-slate-500" />
          <input
            value={reveal ? k.key_name : mask(k.key_name)}
            onChange={e => setK({ ...k, key_name: e.target.value })}
            onBlur={save}
            disabled={!reveal}
            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-100 text-xs font-mono focus:border-emerald-500 focus:outline-none disabled:text-slate-500"
          />
        </div>
      </Field></div>
      <div className="col-span-2"><Field label="Classification">
        <Select value={k.classification} onChange={e => { const u = { ...k, classification: e.target.value }; setK(u); onSave(u); }}>{CLASSIFICATIONS.map(c => <option key={c}>{c}</option>)}</Select>
      </Field></div>
      <div className="col-span-2"><Field label="Source">
        <Select value={k.source_type} onChange={e => { const u = { ...k, source_type: e.target.value }; setK(u); onSave(u); }}>{SOURCES.map(s => <option key={s}>{s}</option>)}</Select>
      </Field></div>
      <div className="col-span-2"><Field label="Env scope"><Input value={k.env_scope} onChange={e => setK({ ...k, env_scope: e.target.value })} onBlur={save} placeholder="dev | prod" /></Field></div>
      <div className="col-span-2"><Field label="Infisical path"><Input className="font-mono" value={k.infisical_path} onChange={e => setK({ ...k, infisical_path: e.target.value })} onBlur={save} /></Field></div>
      <div className="col-span-1 flex items-end justify-end pb-1"><Button variant="danger" onClick={() => onRemove(k.id)}><Trash2 className="w-3 h-3" /></Button></div>
      <div className="col-span-12"><Field label="Purpose"><Textarea rows={1} value={k.purpose} onChange={e => setK({ ...k, purpose: e.target.value })} onBlur={save} placeholder="DATABASE_URL = runtime database" /></Field></div>
      <div className="col-span-12 flex items-center gap-2">
        <Badge tone={k.required ? 'rose' : 'slate'}>{k.required ? 'required' : 'optional'}</Badge>
        <label className="text-xs text-slate-400 flex items-center gap-1.5">
          <input type="checkbox" checked={k.required} onChange={e => { const u = { ...k, required: e.target.checked }; setK(u); onSave(u); }} /> required
        </label>
        <Badge>value never stored</Badge>
      </div>
    </div>
  );
}

// ── Env Diff Panel ────────────────────────────────────────────────────────────

type DiffState = { loading: boolean; error: string | null; result: EnvDiffResult | null };

function EnvDiffPanel({ scope, onChange }: { scope: ProjectScope; onChange: () => void }) {
  const currentMachine = useCurrentMachine();
  const repoPath = getEffectiveRepoPath(scope, currentMachine);
  const [diff, setDiff] = useState<DiffState>({ loading: false, error: null, result: null });
  const [adding, setAdding] = useState<Set<string>>(new Set());

  async function runDiff() {
    if (!repoPath) return;
    setDiff({ loading: true, error: null, result: null });
    try {
      const result = await fetchEnvDiff(repoPath);
      setDiff({ loading: false, error: null, result });
    } catch (e: any) {
      setDiff({ loading: false, error: e.message, result: null });
    }
  }

  const registered = new Set(scope.env_keys.map(k => k.key_name));
  const localKeys = diff.result ? new Set(diff.result.all_keys) : new Set<string>();

  // Keys registered in Cockpit but missing from all local .env files
  const missingLocally = scope.env_keys.filter(k => diff.result && !localKeys.has(k.key_name));
  // Keys in local .env files but not registered in Cockpit
  const undocumented = diff.result ? diff.result.all_keys.filter(k => !registered.has(k)) : [];
  // Keys that are both registered and present locally
  const inSync = scope.env_keys.filter(k => diff.result && localKeys.has(k.key_name));

  async function addUndocumented(keyName: string) {
    setAdding(prev => new Set(prev).add(keyName));
    try {
      // Determine source_type from which file it was found in
      let sourceType = 'manual';
      if (diff.result) {
        for (const [fileName] of Object.entries(diff.result.files)) {
          if (diff.result.files[fileName].includes(keyName)) {
            if (fileName === '.env.example') sourceType = '.env.example';
            else if (fileName === '.env.local') sourceType = '.env.local';
            else if (fileName === '.env') sourceType = '.env';
            break;
          }
        }
      }
      await upsertRow<EnvKey>('env_keys', {
        project_id: scope.project.id,
        key_name: keyName,
        classification: 'unknown',
        source_type: sourceType,
        required: false,
      } as any);
      onChange();
    } finally {
      setAdding(prev => { const n = new Set(prev); n.delete(keyName); return n; });
    }
  }

  async function addAllUndocumented() {
    for (const k of undocumented) {
      if (!registered.has(k)) await addUndocumented(k);
    }
  }

  // Find which files contain a given key
  function filesForKey(keyName: string): string[] {
    if (!diff.result) return [];
    return Object.entries(diff.result.files)
      .filter(([, keys]) => keys.includes(keyName))
      .map(([file]) => file);
  }

  return (
    <Card>
      <CardHeader title="Env key diff" action={
        <Button variant="secondary" onClick={runDiff} disabled={diff.loading || !repoPath}>
          {diff.loading
            ? <><Loader2 className="w-3 h-3 inline mr-1 animate-spin" />Scanning...</>
            : <><GitCompareArrows className="w-3 h-3 inline mr-1" />Run diff</>
          }
        </Button>
      } />
      <div className="p-5">
        {!diff.result && !diff.loading && !diff.error && (
          <div className="text-sm text-slate-500">
            Compare registered env keys against local .env files.
            {!repoPath && <span className="block mt-1 text-amber-400/70">Set the project repo path first.</span>}
          </div>
        )}

        {diff.error && (
          <div className="text-sm text-rose-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {diff.error}
          </div>
        )}

        {diff.result && (
          <div className="space-y-4">
            {/* Files scanned summary */}
            <div className="text-xs text-slate-500">
              Scanned: {Object.keys(diff.result.files).length === 0
                ? 'no .env files found'
                : Object.keys(diff.result.files).map(f => <code key={f} className="mx-1 px-1.5 py-0.5 bg-slate-800 rounded text-slate-400">{f}</code>)
              }
            </div>

            {/* In sync */}
            {inSync.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Badge tone="emerald">in sync</Badge>
                  <span className="text-xs text-slate-400">{inSync.length} key{inSync.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {inSync.map(k => (
                    <span key={k.id} className="px-2 py-0.5 text-xs font-mono bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 rounded">
                      {k.key_name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Missing locally */}
            {missingLocally.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Badge tone="amber">missing locally</Badge>
                  <span className="text-xs text-slate-400">{missingLocally.length} key{missingLocally.length !== 1 ? 's' : ''} registered but not in any .env file</span>
                </div>
                <div className="space-y-1">
                  {missingLocally.map(k => (
                    <div key={k.id} className="flex items-center gap-3 px-3 py-1.5 bg-amber-500/5 border border-amber-500/15 rounded">
                      <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                      <code className="text-xs font-mono text-amber-200">{k.key_name}</code>
                      {k.required && <Badge tone="rose">required</Badge>}
                      {k.purpose && <span className="text-[11px] text-slate-500 truncate">{k.purpose}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Undocumented */}
            {undocumented.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Badge tone="blue">undocumented</Badge>
                  <span className="text-xs text-slate-400">{undocumented.length} key{undocumented.length !== 1 ? 's' : ''} in .env but not registered</span>
                  <Button variant="ghost" onClick={addAllUndocumented} className="ml-auto text-[11px]">
                    <Plus className="w-3 h-3 inline mr-0.5" />Add all
                  </Button>
                </div>
                <div className="space-y-1">
                  {undocumented.map(k => (
                    <div key={k} className="flex items-center gap-3 px-3 py-1.5 bg-blue-500/5 border border-blue-500/15 rounded">
                      <FileQuestion className="w-3 h-3 text-blue-400 shrink-0" />
                      <code className="text-xs font-mono text-blue-200">{k}</code>
                      <span className="text-[11px] text-slate-500">{filesForKey(k).join(', ')}</span>
                      <Button variant="ghost" onClick={() => addUndocumented(k)} disabled={adding.has(k)} className="ml-auto">
                        <Plus className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* All clear */}
            {missingLocally.length === 0 && undocumented.length === 0 && inSync.length > 0 && (
              <div className="text-sm text-emerald-400">All registered keys are present locally. No undocumented keys found.</div>
            )}

            {/* Nothing at all */}
            {Object.keys(diff.result.files).length === 0 && scope.env_keys.length === 0 && (
              <div className="text-sm text-slate-500">No .env files found and no keys registered.</div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Infisical Sync Status ─────────────────────────────────────────────────────

type SyncState = {
  loading: boolean;
  results: InfisicalSyncResult[];
  cli_available: boolean | null;
  error: string | null;
};

function SyncStatusIcon({ status }: { status: InfisicalSyncResult['status'] }) {
  if (status === 'reachable') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
  if (status === 'error') return <XCircle className="w-3.5 h-3.5 text-rose-400" />;
  return <HelpCircle className="w-3.5 h-3.5 text-slate-500" />;
}

function InfisicalSyncPanel({ refs }: { refs: InfisicalRef[] }) {
  const [sync, setSync] = useState<SyncState>({ loading: false, results: [], cli_available: null, error: null });

  async function runCheck() {
    setSync({ loading: true, results: [], cli_available: null, error: null });
    try {
      const payload = refs.map(r => ({
        id: r.id,
        infisical_project_id: r.infisical_project_id,
        environment: r.environment,
        secret_path: r.secret_path,
      }));
      const resp = await checkInfisicalSync(payload);
      setSync({ loading: false, results: resp.results, cli_available: resp.cli_available, error: null });
    } catch (e: any) {
      setSync({ loading: false, results: [], cli_available: null, error: e.message });
    }
  }

  const resultMap = new Map(sync.results.map(r => [r.id, r]));
  const allReachable = sync.results.length > 0 && sync.results.every(r => r.status === 'reachable');
  const anyError = sync.results.some(r => r.status === 'error');

  return (
    <Card>
      <CardHeader title="Infisical sync status" action={
        <Button variant="secondary" onClick={runCheck} disabled={sync.loading || refs.length === 0}>
          {sync.loading
            ? <><Loader2 className="w-3 h-3 inline mr-1 animate-spin" />Checking...</>
            : <><RefreshCw className="w-3 h-3 inline mr-1" />Check sync</>
          }
        </Button>
      } />
      <div className="p-5">
        {refs.length === 0 && (
          <div className="text-sm text-slate-500">No Infisical references to check.</div>
        )}

        {refs.length > 0 && sync.results.length === 0 && !sync.loading && !sync.error && (
          <div className="text-sm text-slate-500">
            Verify that Infisical secret references are reachable via the CLI.
          </div>
        )}

        {sync.error && (
          <div className="text-sm text-rose-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {sync.error}
          </div>
        )}

        {sync.cli_available === false && (
          <div className="bg-amber-500/5 border border-amber-500/20 rounded px-3 py-2 mb-3 text-xs text-amber-200/80 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            Infisical CLI not found. Install it to enable sync checking.
          </div>
        )}

        {sync.results.length > 0 && (
          <div className="space-y-2">
            {/* Summary badge */}
            <div className="flex items-center gap-2 mb-3">
              {allReachable && <Badge tone="emerald">all synced</Badge>}
              {anyError && !allReachable && <Badge tone="rose">sync issues</Badge>}
              {!allReachable && !anyError && sync.results.length > 0 && <Badge tone="amber">unknown</Badge>}
              {sync.results[0]?.checked_at && (
                <span className="text-[11px] text-slate-500">
                  checked {new Date(sync.results[0].checked_at).toLocaleTimeString()}
                </span>
              )}
            </div>

            {/* Per-ref results */}
            {refs.map(ref => {
              const r = resultMap.get(ref.id);
              if (!r) return null;
              return (
                <div key={ref.id} className={`flex items-center gap-3 px-3 py-2 rounded border ${
                  r.status === 'reachable' ? 'bg-emerald-500/5 border-emerald-500/15' :
                  r.status === 'error' ? 'bg-rose-500/5 border-rose-500/15' :
                  'bg-slate-800/50 border-slate-700'
                }`}>
                  <SyncStatusIcon status={r.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-mono text-slate-200 truncate">
                        {ref.workspace_name || (ref.infisical_project_id ? `${ref.infisical_project_id.slice(0, 8)}…` : 'unnamed')}
                      </code>
                      <span className="text-[11px] text-slate-500">{ref.environment}{ref.secret_path !== '/' ? ` ${ref.secret_path}` : ''}</span>
                    </div>
                    {r.status === 'reachable' && r.secret_count !== undefined && (
                      <div className="text-[11px] text-emerald-400/70 mt-0.5">{r.secret_count} secret{r.secret_count !== 1 ? 's' : ''} found</div>
                    )}
                    {r.status === 'error' && r.error && (
                      <div className="text-[11px] text-rose-300/70 mt-0.5 truncate">{r.error}</div>
                    )}
                    {r.status === 'unknown' && r.error && (
                      <div className="text-[11px] text-slate-500 mt-0.5">{r.error}</div>
                    )}
                  </div>
                  {r.response_ms !== undefined && (
                    <span className="text-[10px] text-slate-600 tabular-nums">{r.response_ms}ms</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Main Tab ──────────────────────────────────────────────────────────────────

export function EnvTab({ scope, onChange }: { scope: ProjectScope; onChange: () => void }) {
  const daemonOnline = useDaemonOnline();
  const currentMachine = useCurrentMachine();
  const repoPath = getEffectiveRepoPath(scope, currentMachine);
  const [reveal, setReveal] = useState(false);
  const [syncing, setSyncing] = useState(false);

  async function importInfisicalFromRepo() {
    if (!repoPath) return;
    setSyncing(true);
    try {
      const detected = await detectProject(repoPath);
      const ref = detected.infisical_refs?.[0];
      if (!ref) {
        alert('No .infisical.json found in the repo root.');
        return;
      }
      const duplicate = scope.infisical_refs.some(r =>
        r.infisical_project_id === ref.infisical_project_id
        && r.environment === ref.environment
        && r.secret_path === ref.secret_path,
      );
      if (duplicate) {
        alert('Infisical reference already configured.');
        return;
      }
      await upsertRow<InfisicalRef>('infisical_refs', {
        project_id: scope.project.id,
        infisical_project_id: ref.infisical_project_id,
        workspace_name: '',
        environment: ref.environment,
        secret_path: ref.secret_path,
        run_command_pattern: ref.run_command_pattern,
        notes: ref.notes || 'imported from .infisical.json',
      } as any);
      onChange();
    } catch (e: any) {
      alert(`Import failed: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  }

  async function syncFromDaemon() {
    if (!repoPath) return;
    setSyncing(true);
    try {
      const detected = await detectProject(repoPath);
      const existing = new Set(scope.env_keys.map(k => k.key_name));
      const toAdd = detected.env_keys.filter(k => !existing.has(k.key_name));
      for (const k of toAdd) {
        await upsertRow<EnvKey>('env_keys', {
          project_id: scope.project.id,
          key_name: k.key_name, classification: k.classification ?? 'unknown',
          source_type: 'manual', required: false,
        } as any);
      }
      if (toAdd.length > 0) { onChange(); alert(`Added ${toAdd.length} env key(s).`); }
      else alert('Nothing new detected — all env keys already configured or none found.');
    } catch (e: any) {
      alert(`Auto-fill failed: ${e.message}\n\nMake sure the daemon is running the latest version: stop and re-run "ldc daemon"`);
    } finally { setSyncing(false); }
  }

  async function addKey() {
    await upsertRow<EnvKey>('env_keys', { project_id: scope.project.id, key_name: 'NEW_KEY', classification: 'server-runtime', source_type: 'infisical', required: true } as any);
    onChange();
  }
  async function updateKey(k: EnvKey) { await upsertRow<EnvKey>('env_keys', k); onChange(); }
  async function removeKey(id: string) { await deleteRow('env_keys', id); onChange(); }

  async function addInfi() {
    await upsertRow<InfisicalRef>('infisical_refs', { project_id: scope.project.id, environment: 'dev', secret_path: '/', run_command_pattern: 'infisical run --env=dev --path=/ -- ' } as any);
    onChange();
  }
  async function updateInfi(i: InfisicalRef) { await upsertRow<InfisicalRef>('infisical_refs', i); onChange(); }
  async function removeInfi(id: string) { await deleteRow('infisical_refs', id); onChange(); }

  function handleReveal() {
    if (reveal) { setReveal(false); return; }
    if (confirm('This will reveal key names only — no secret values are ever stored. Continue?')) setReveal(true);
  }

  return (
    <div className="space-y-4">
      <div className="bg-amber-500/5 border border-amber-500/20 rounded px-4 py-3 flex items-start gap-2">
        <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-200/80">
          Local Dev Cockpit never stores or displays raw secret values. This tab tracks key names, sources, and purposes only.
        </div>
      </div>

      {daemonOnline && (
        <EnvDiffPanel scope={scope} onChange={onChange} />
      )}

      <Card>
        <CardHeader title="Infisical references" action={
          <div className="flex gap-2">
            {daemonOnline && repoPath && (
              <Button variant="ghost" disabled={syncing} onClick={importInfisicalFromRepo} title="Read .infisical.json from repo">
                <Zap className="w-3 h-3" />
              </Button>
            )}
            <Button onClick={addInfi}><Plus className="w-3 h-3 inline mr-1" />Add</Button>
          </div>
        } />
        <div className="px-5 pt-4 pb-0">
          <p className="text-xs text-slate-500 leading-relaxed">
            Point at your Infisical project ID + environment. Use the ⚡ button to import from <span className="font-mono">.infisical.json</span> in the repo.
          </p>
        </div>
        <div className="p-5 space-y-3">
          {scope.infisical_refs.length === 0 && <div className="text-sm text-slate-500">No Infisical references.</div>}
          {scope.infisical_refs.map(i => (
            <InfisicalRefRow key={i.id} i={i} onSave={updateInfi} onRemove={removeInfi} />
          ))}
        </div>
      </Card>

      {daemonOnline && scope.infisical_refs.length > 0 && (
        <InfisicalSyncPanel refs={scope.infisical_refs} />
      )}

      <Card>
        <CardHeader title="Expected env keys" action={
          <div className="flex gap-2">
            {daemonOnline && repoPath && (
              <Button variant="ghost" disabled={syncing} onClick={syncFromDaemon} title="Auto-fill from project files">
                <Zap className="w-3 h-3" />
              </Button>
            )}
            <Button variant="secondary" onClick={handleReveal}>{reveal ? <><EyeOff className="w-3 h-3 inline mr-1" />Mask</> : <><Eye className="w-3 h-3 inline mr-1" />Show names</>}</Button>
            <Button onClick={addKey}><Plus className="w-3 h-3 inline mr-1" />Add key</Button>
          </div>
        } />
        <div className="p-5 space-y-2">
          {scope.env_keys.length === 0 && <div className="text-sm text-slate-500">No env keys yet.</div>}
          {scope.env_keys.map(k => (
            <EnvKeyRow key={k.id} k={k} reveal={reveal} onSave={updateKey} onRemove={removeKey} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function mask(s: string) {
  if (!s) return '';
  if (s.length <= 4) return '•'.repeat(s.length);
  return s.slice(0, 2) + '•'.repeat(Math.max(4, s.length - 4)) + s.slice(-2);
}
