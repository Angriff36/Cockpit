import { useState, useMemo, useEffect, useCallback } from 'react';
import { Copy, Check, Save, Bot, History, GitCompare, Trash2, ChevronDown, ChevronUp, Link2 } from 'lucide-react';
import type { ProjectScope, AgentContextOverride, AgentContextSnapshot, ContextShareLink } from '../../lib/types';
import {
  buildAgentContext, upsertRow, saveSnapshot, listSnapshots, getSnapshot, deleteSnapshot, diffContexts,
  createShareLink, listShareLinks, deleteShareLink, isShareLinkExpired, isShareLinkExhausted,
} from '../../lib/api';
import type { DiffEntry } from '../../lib/api';
import { useCurrentMachine } from '../../lib/useCurrentMachine';
import { Card, CardHeader, Field, Textarea, Button, Badge, Input, Modal, Select } from '../ui';

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function DiffView({ diffs }: { diffs: DiffEntry[] }) {
  if (!diffs.length) return <div className="text-xs text-slate-500 italic px-5 py-3">No changes between these versions.</div>;
  return (
    <div className="divide-y divide-slate-800">
      {diffs.map((d, i) => (
        <div key={i} className="px-5 py-2 text-xs font-mono">
          <span className={
            d.type === 'added' ? 'text-emerald-400' :
            d.type === 'removed' ? 'text-rose-400' :
            'text-amber-400'
          }>
            {d.type === 'added' ? '+' : d.type === 'removed' ? '-' : '~'} {d.path}
          </span>
          {d.type === 'changed' && (
            <div className="ml-4 mt-1 space-y-0.5">
              <div className="text-rose-400/70">- {JSON.stringify(d.oldValue)}</div>
              <div className="text-emerald-400/70">+ {JSON.stringify(d.newValue)}</div>
            </div>
          )}
          {d.type === 'added' && (
            <div className="ml-4 mt-1 text-emerald-400/70">+ {JSON.stringify(d.newValue)}</div>
          )}
          {d.type === 'removed' && (
            <div className="ml-4 mt-1 text-rose-400/70">- {JSON.stringify(d.oldValue)}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function ShareLinkModal({
  open,
  onClose,
  onCreated,
  projectId,
  contextJson,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (link: ContextShareLink) => void;
  projectId: string;
  contextJson: Record<string, unknown>;
}) {
  const [label, setLabel] = useState('');
  const [expiresIn, setExpiresIn] = useState('24');
  const [maxAccess, setMaxAccess] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdLink, setCreatedLink] = useState<ContextShareLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function reset() {
    setLabel('');
    setExpiresIn('24');
    setMaxAccess('');
    setCreatedLink(null);
    setCopied(false);
    setCreateError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      const link = await createShareLink(projectId, contextJson, {
        label: label || undefined,
        expiresInHours: expiresIn === 'never' ? undefined : Number(expiresIn),
        maxAccessCount: maxAccess ? Number(maxAccess) : undefined,
      });
      setCreatedLink(link);
      onCreated(link);
    } catch (e: any) {
      setCreateError(e?.message || 'Failed to create share link');
    } finally {
      setCreating(false);
    }
  }

  const shareUrl = createdLink ? `${window.location.origin}/share/${createdLink.token}` : '';

  return (
    <Modal open={open} onClose={handleClose} title="Create shareable link" width="max-w-md">
      {createdLink ? (
        <div className="space-y-4">
          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded px-4 py-3">
            <p className="text-xs text-emerald-200/80">Link created. Anyone with this URL can access the agent context JSON without logging in.</p>
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider font-medium text-slate-500 mb-1.5">Share URL</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs text-emerald-300 font-mono bg-slate-950 border border-slate-800 rounded px-3 py-2 break-all">{shareUrl}</code>
              <Button
                variant="secondary"
                onClick={() => {
                  navigator.clipboard.writeText(shareUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <><Check className="w-3 h-3 inline mr-1" />Copied</> : <><Copy className="w-3 h-3 inline mr-1" />Copy</>}
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={handleClose}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Label (optional)">
            <Input
              placeholder="e.g. for Claude agent"
              value={label}
              onChange={e => setLabel(e.target.value)}
            />
          </Field>
          <Field label="Expires in">
            <Select value={expiresIn} onChange={e => setExpiresIn(e.target.value)}>
              <option value="1">1 hour</option>
              <option value="6">6 hours</option>
              <option value="24">24 hours</option>
              <option value="72">3 days</option>
              <option value="168">7 days</option>
              <option value="never">Never</option>
            </Select>
          </Field>
          <Field label="Max access count (optional)">
            <Input
              type="number"
              min="1"
              placeholder="Unlimited"
              value={maxAccess}
              onChange={e => setMaxAccess(e.target.value)}
            />
          </Field>
          {createError && (
            <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded px-3 py-2">
              {createError}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={handleClose}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? 'Creating...' : <><Link2 className="w-3 h-3 inline mr-1" />Create link</>}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function AgentContextTab({ scope, onChange }: { scope: ProjectScope; onChange: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const currentMachine = useCurrentMachine();
  const [o, setO] = useState<Partial<AgentContextOverride>>(scope.overrides || {
    project_id: scope.project.id,
    database_notes: '', migration_notes: '', danger_zones: '', gotchas: '',
    recommended_commands: '', must_confirm_commands: '',
  } as any);
  const [saving, setSaving] = useState(false);

  // Snapshot state
  const [snapshots, setSnapshots] = useState<AgentContextSnapshot[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [diffResult, setDiffResult] = useState<DiffEntry[] | null>(null);
  const [diffLabel, setDiffLabel] = useState('');
  const [loadingDiff, setLoadingDiff] = useState(false);

  // Share link state
  const [shareLinks, setShareLinks] = useState<ContextShareLink[]>([]);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showShareLinks, setShowShareLinks] = useState(false);

  const ctx = useMemo(() => buildAgentContext({ ...scope, overrides: o as AgentContextOverride }, currentMachine), [scope, o, currentMachine]);
  const json = useMemo(() => JSON.stringify(ctx, null, 2), [ctx]);
  const cliCmd = `ldc project agent-context ${scope.project.slug} --json`;

  const loadSnapshots = useCallback(async () => {
    try {
      const list = await listSnapshots(scope.project.id);
      setSnapshots(list);
    } catch { /* ignore */ }
  }, [scope.project.id]);

  const loadShareLinks = useCallback(async () => {
    try {
      const list = await listShareLinks(scope.project.id);
      setShareLinks(list);
    } catch { /* ignore */ }
  }, [scope.project.id]);

  useEffect(() => { loadSnapshots(); loadShareLinks(); }, [loadSnapshots, loadShareLinks]);

  async function copyAndSnapshot(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
    if (label === 'json') {
      try {
        await saveSnapshot(scope.project.id, ctx, 'copy');
        await loadSnapshots();
      } catch { /* best-effort */ }
    }
  }

  async function save() {
    setSaving(true);
    try {
      await upsertRow<AgentContextOverride>('agent_context_overrides', { ...o, project_id: scope.project.id } as any);
      onChange();
    } finally {
      setSaving(false);
    }
  }

  async function handleDiffWithCurrent(snapshotId: string, snapshotDate: string) {
    setLoadingDiff(true);
    try {
      const snap = await getSnapshot(snapshotId);
      if (!snap) return;
      const diffs = diffContexts(snap.context_json, ctx);
      setDiffResult(diffs);
      setDiffLabel(`${formatDate(snapshotDate)} vs. Current`);
    } finally {
      setLoadingDiff(false);
    }
  }

  async function handleDiffAdjacent(index: number) {
    if (index >= snapshots.length - 1) return;
    setLoadingDiff(true);
    try {
      const newer = await getSnapshot(snapshots[index].id);
      const older = await getSnapshot(snapshots[index + 1].id);
      if (!newer || !older) return;
      const diffs = diffContexts(older.context_json, newer.context_json);
      setDiffResult(diffs);
      setDiffLabel(`${formatDate(snapshots[index + 1].created_at)} vs. ${formatDate(snapshots[index].created_at)}`);
    } finally {
      setLoadingDiff(false);
    }
  }

  async function handleDeleteSnapshot(id: string) {
    try {
      await deleteSnapshot(id);
      setSnapshots(s => s.filter(snap => snap.id !== id));
      if (diffResult) { setDiffResult(null); setDiffLabel(''); }
    } catch { /* ignore */ }
  }

  async function handleDeleteShareLink(id: string) {
    try {
      await deleteShareLink(id);
      setShareLinks(s => s.filter(l => l.id !== id));
    } catch { /* ignore */ }
  }

  function copyShareUrl(token: string) {
    const url = `${window.location.origin}/share/${token}`;
    navigator.clipboard.writeText(url);
    setCopied(`share-${token}`);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="space-y-4">
      <div className="bg-emerald-500/5 border border-emerald-500/20 rounded px-4 py-3 flex items-start gap-2">
        <Bot className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
        <div className="text-xs text-emerald-200/80">
          This is exactly what the <span className="font-mono">/api/projects/{scope.project.slug}/agent-context</span> endpoint returns. Safe to share with an AI coding agent. No raw secrets are ever included.
          {snapshots.length > 0 && (
            <span className="text-slate-500 ml-1">A snapshot is saved each time you copy the JSON.</span>
          )}
        </div>
      </div>

      <Card>
        <CardHeader title="Agent overrides (written into context)" action={
          <Button onClick={save} disabled={saving}><Save className="w-3 h-3 inline mr-1" />{saving ? 'Saving...' : 'Save'}</Button>
        } />
        <div className="p-5 grid grid-cols-2 gap-4">
          <Field label="Database notes"><Textarea rows={2} value={o.database_notes || ''} onChange={e => setO({ ...o, database_notes: e.target.value })} /></Field>
          <Field label="Migration notes"><Textarea rows={2} value={o.migration_notes || ''} onChange={e => setO({ ...o, migration_notes: e.target.value })} /></Field>
          <Field label="Danger zones (one per line)"><Textarea rows={3} value={o.danger_zones || ''} onChange={e => setO({ ...o, danger_zones: e.target.value })} /></Field>
          <Field label="Known gotchas (one per line)"><Textarea rows={3} value={o.gotchas || ''} onChange={e => setO({ ...o, gotchas: e.target.value })} /></Field>
          <Field label="Recommended commands (one per line)"><Textarea rows={3} value={o.recommended_commands || ''} onChange={e => setO({ ...o, recommended_commands: e.target.value })} /></Field>
          <Field label="Must-confirm commands (one per line)"><Textarea rows={3} value={o.must_confirm_commands || ''} onChange={e => setO({ ...o, must_confirm_commands: e.target.value })} /></Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="CLI command" action={
          <Button variant="secondary" onClick={() => copyAndSnapshot(cliCmd, 'cli')}>
            {copied === 'cli' ? <><Check className="w-3 h-3 inline mr-1" />Copied</> : <><Copy className="w-3 h-3 inline mr-1" />Copy</>}
          </Button>
        } />
        <div className="p-5">
          <code className="text-sm text-emerald-300 font-mono bg-slate-950 border border-slate-800 rounded px-3 py-2 block">{cliCmd}</code>
        </div>
      </Card>

      <Card>
        <CardHeader title="Agent context JSON" action={
          <div className="flex items-center gap-2">
            <Badge tone="emerald">sanitized</Badge>
            <Button variant="secondary" onClick={() => setShowShareModal(true)}>
              <Link2 className="w-3 h-3 inline mr-1" />Share
            </Button>
            <Button variant="secondary" onClick={() => copyAndSnapshot(json, 'json')}>
              {copied === 'json' ? <><Check className="w-3 h-3 inline mr-1" />Copied</> : <><Copy className="w-3 h-3 inline mr-1" />Copy JSON</>}
            </Button>
          </div>
        } />
        <pre className="p-5 text-xs text-slate-300 font-mono overflow-x-auto max-h-[600px] overflow-y-auto">{json}</pre>
      </Card>

      {/* Shareable Links */}
      {shareLinks.length > 0 && (
        <Card>
          <CardHeader
            title={`Share links (${shareLinks.length})`}
            action={
              <Button variant="ghost" onClick={() => setShowShareLinks(!showShareLinks)}>
                <Link2 className="w-3 h-3 inline mr-1" />
                {showShareLinks ? <ChevronUp className="w-3 h-3 inline ml-0.5" /> : <ChevronDown className="w-3 h-3 inline ml-0.5" />}
              </Button>
            }
          />
          {showShareLinks && (
            <div className="divide-y divide-slate-800">
              {shareLinks.map(link => {
                const expired = isShareLinkExpired(link);
                const exhausted = isShareLinkExhausted(link);
                const inactive = expired || exhausted;
                return (
                  <div key={link.id} className="px-5 py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs text-slate-300 font-mono truncate max-w-[200px]">
                        {link.label || link.token.slice(0, 12) + '...'}
                      </span>
                      {inactive && (
                        <Badge tone="rose">{expired ? 'expired' : 'exhausted'}</Badge>
                      )}
                      {!inactive && link.expires_at && (
                        <Badge tone="amber">exp {formatDate(link.expires_at)}</Badge>
                      )}
                      {!inactive && !link.expires_at && (
                        <Badge tone="emerald">active</Badge>
                      )}
                      <span className="text-xs text-slate-500">{link.access_count} access{link.access_count !== 1 ? 'es' : ''}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" onClick={() => copyShareUrl(link.token)} disabled={inactive}>
                        {copied === `share-${link.token}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      </Button>
                      <Button variant="ghost" onClick={() => handleDeleteShareLink(link.id)}>
                        <Trash2 className="w-3 h-3 text-rose-400/60" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* Version History */}
      <Card>
        <CardHeader
          title={`Version history (${snapshots.length})`}
          action={
            <Button variant="ghost" onClick={() => setShowHistory(!showHistory)}>
              <History className="w-3 h-3 inline mr-1" />
              {showHistory ? <><ChevronUp className="w-3 h-3 inline ml-0.5" /></> : <><ChevronDown className="w-3 h-3 inline ml-0.5" /></>}
            </Button>
          }
        />
        {showHistory && (
          <div>
            {snapshots.length === 0 ? (
              <div className="px-5 py-4 text-xs text-slate-500">No snapshots yet. Copy the JSON above to create the first version.</div>
            ) : (
              <div className="divide-y divide-slate-800">
                {snapshots.map((snap, i) => (
                  <div key={snap.id} className="px-5 py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs text-slate-400 font-mono shrink-0">v{snapshots.length - i}</span>
                      <span className="text-xs text-slate-300 truncate">{formatDate(snap.created_at)}</span>
                      <Badge tone={snap.trigger === 'copy' ? 'blue' : snap.trigger === 'cli' ? 'amber' : 'slate'}>
                        {snap.trigger}
                      </Badge>
                      {snap.label && <span className="text-xs text-slate-500 truncate">{snap.label}</span>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" onClick={() => handleDiffWithCurrent(snap.id, snap.created_at)} disabled={loadingDiff}>
                        <GitCompare className="w-3 h-3" />
                        <span className="ml-1">vs Current</span>
                      </Button>
                      {i < snapshots.length - 1 && (
                        <Button variant="ghost" onClick={() => handleDiffAdjacent(i)} disabled={loadingDiff}>
                          <GitCompare className="w-3 h-3" />
                          <span className="ml-1">vs Prev</span>
                        </Button>
                      )}
                      <Button variant="ghost" onClick={() => handleDeleteSnapshot(snap.id)}>
                        <Trash2 className="w-3 h-3 text-rose-400/60" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Diff Result */}
      {diffResult && (
        <Card>
          <CardHeader
            title={`Diff: ${diffLabel}`}
            action={
              <div className="flex items-center gap-2">
                <Badge tone={diffResult.length === 0 ? 'emerald' : 'amber'}>
                  {diffResult.length} change{diffResult.length !== 1 ? 's' : ''}
                </Badge>
                <Button variant="ghost" onClick={() => { setDiffResult(null); setDiffLabel(''); }}>
                  Close
                </Button>
              </div>
            }
          />
          <DiffView diffs={diffResult} />
        </Card>
      )}

      {/* Share Link Creation Modal */}
      <ShareLinkModal
        open={showShareModal}
        onClose={() => setShowShareModal(false)}
        onCreated={() => loadShareLinks()}
        projectId={scope.project.id}
        contextJson={ctx}
      />
    </div>
  );
}
