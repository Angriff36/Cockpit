import { useState } from 'react';
import { AlertTriangle, Check, Loader2, RefreshCw, ArrowRight } from 'lucide-react';
import type { PortConflict } from '../lib/types';
import {
  updatePortNumber,
  updateCommandExpectedPort,
  regenerateAffectedContexts,
  insertActivityLog,
} from '../lib/api';
import { Badge, Button } from './ui';

type EditState = Record<string, number>; // keyed by `${port}-${project_id}`

function editKey(port: number, projectId: string) {
  return `${port}-${projectId}`;
}

function ConflictRow({
  entry,
  originalPort,
  editValue,
  onEdit,
  saving,
}: {
  entry: PortConflict['projects'][0];
  originalPort: number;
  editValue: number;
  onEdit: (val: number) => void;
  saving: boolean;
}) {
  const changed = editValue !== originalPort;

  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="text-sm text-slate-300 truncate min-w-0 flex-1">
        {entry.project_name}
      </span>
      <Badge tone={entry.source === 'command' ? 'blue' : 'slate'}>
        {entry.source === 'command' ? 'cmd' : 'port'}
      </Badge>
      <span className="text-[11px] text-slate-500 shrink-0">{entry.label}</span>
      <div className="flex items-center gap-1.5 shrink-0">
        {changed && (
          <span className="text-[11px] text-slate-500 font-mono">{originalPort}</span>
        )}
        {changed && <ArrowRight className="w-3 h-3 text-amber-400/60" />}
        <input
          type="number"
          value={editValue}
          onChange={e => onEdit(Number(e.target.value))}
          disabled={saving}
          className="w-20 px-2 py-1 text-sm font-mono bg-slate-950 border rounded text-slate-200 focus:outline-none focus:border-emerald-500/50 disabled:opacity-50 border-slate-700"
        />
      </div>
    </div>
  );
}

export function PortConflictPanel({
  conflicts,
  onRefresh,
  loading,
  onNavigate,
}: {
  conflicts: PortConflict[];
  onRefresh: () => void;
  loading: boolean;
  onNavigate: (slug: string) => void;
}) {
  const [edits, setEdits] = useState<EditState>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (conflicts.length === 0) return null;

  function getEditValue(port: number, projectId: string): number {
    const key = editKey(port, projectId);
    return edits[key] ?? port;
  }

  function setEditValue(port: number, projectId: string, value: number) {
    setEdits(prev => ({ ...prev, [editKey(port, projectId)]: value }));
    setSaved(false);
    setError(null);
  }

  // Collect all changes across all conflict groups
  function collectChanges() {
    const changes: {
      originalPort: number;
      newPort: number;
      entry: PortConflict['projects'][0];
    }[] = [];

    for (const c of conflicts) {
      for (const entry of c.projects) {
        const val = getEditValue(c.port, entry.project_id);
        if (val !== c.port && val > 0 && val <= 65535) {
          changes.push({ originalPort: c.port, newPort: val, entry });
        }
      }
    }
    return changes;
  }

  async function handleSave() {
    const changes = collectChanges();
    if (changes.length === 0) return;

    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      // Apply all port changes
      for (const { originalPort, newPort, entry } of changes) {
        if (entry.source === 'port') {
          await updatePortNumber(entry.source_id, originalPort, newPort);
        } else {
          await updateCommandExpectedPort(entry.source_id, newPort);
        }

        // Log activity
        await insertActivityLog({
          project_id: entry.project_id,
          event_type: 'port_conflict_resolved',
          category: 'ports',
          title: 'Port conflict resolved',
          detail: `Port ${originalPort} → ${newPort} (${entry.label})`,
          metadata: { old_port: originalPort, new_port: newPort, source: entry.source, label: entry.label },
          source: 'cockpit',
        });
      }

      // Regenerate agent contexts for affected projects
      const affectedSlugs = [...new Set(changes.map(c => c.entry.project_slug))];
      await regenerateAffectedContexts(affectedSlugs);

      setSaved(true);
      setEdits({});
      onRefresh();
    } catch (e: any) {
      setError(e.message || 'Failed to save port changes');
    } finally {
      setSaving(false);
    }
  }

  const changes = collectChanges();
  const hasChanges = changes.length > 0;

  return (
    <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg">
      {/* Header */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-amber-500/10">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
        <span className="text-sm font-medium text-amber-300">
          Port conflict{conflicts.length > 1 ? 's' : ''} detected
        </span>
        <span className="text-xs text-amber-400/60">
          {conflicts.length} port{conflicts.length > 1 ? 's' : ''} shared across projects
        </span>
        <div className="ml-auto flex items-center gap-2">
          {saved && (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <Check className="w-3 h-3" /> Saved &amp; contexts regenerated
            </span>
          )}
          {error && (
            <span className="text-xs text-rose-400 max-w-xs truncate" title={error}>
              {error}
            </span>
          )}
          <Button
            variant="ghost"
            disabled={loading}
            onClick={onRefresh}
            title="Re-check conflicts"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Conflict groups */}
      <div className="px-5 py-3 space-y-4">
        {conflicts.map(c => (
          <div key={c.port} className="bg-slate-950/50 rounded-lg px-4 py-3">
            <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-800">
              <span className="text-sm font-mono font-medium text-amber-300">
                :{c.port}
              </span>
              <span className="text-[11px] text-slate-500">
                used by {c.projects.length} projects
              </span>
            </div>
            <div className="space-y-0.5">
              {c.projects.map(entry => (
                <ConflictRow
                  key={entry.project_id}
                  entry={entry}
                  originalPort={c.port}
                  editValue={getEditValue(c.port, entry.project_id)}
                  onEdit={val => setEditValue(c.port, entry.project_id, val)}
                  saving={saving}
                />
              ))}
            </div>
            <div className="mt-2 pt-2 border-t border-slate-800/50">
              <div className="flex gap-1.5 flex-wrap">
                {c.projects.map(p => (
                  <button
                    key={p.project_id}
                    onClick={() => onNavigate(p.project_slug)}
                    className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors underline decoration-dotted underline-offset-2"
                  >
                    open {p.project_name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      {hasChanges && (
        <div className="flex items-center gap-3 px-5 py-3 border-t border-amber-500/10 bg-slate-950/30 rounded-b-lg">
          <span className="text-xs text-slate-400">
            {changes.length} change{changes.length > 1 ? 's' : ''} pending
          </span>
          <span className="text-[10px] text-slate-500">
            Affected projects: {[...new Set(changes.map(c => c.entry.project_name))].join(', ')}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => { setEdits({}); setError(null); }}
              disabled={saving}
            >
              Reset
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? (
                <><Loader2 className="w-3 h-3 animate-spin inline mr-1" />Saving...</>
              ) : (
                'Apply & Regenerate Contexts'
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
