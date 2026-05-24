import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Loader2, Pencil, Save, Trash2 } from 'lucide-react';
import type { PortConflict, ProjectPort, ProjectScope, UptimeStats } from '../lib/types';
import {
  deleteRow,
  insertActivityLog,
  regenerateAffectedContexts,
  updateCommandExpectedPort,
  updatePortNumber,
  upsertRow,
} from '../lib/api';
import { Badge, Button, Card, CardHeader, Sparkline } from './ui';
import { ExternalHref } from './ExternalLink';

function EditablePortCard({
  port,
  live,
  stats,
  hasConflict,
  saving,
  onSave,
  onDelete,
}: {
  port: ProjectPort;
  live?: boolean;
  stats?: UptimeStats;
  hasConflict: boolean;
  saving: boolean;
  onSave: (portId: string, oldPort: number, newPort: number, label: string) => Promise<void>;
  onDelete: (portId: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [portValue, setPortValue] = useState(port.port);
  const [labelValue, setLabelValue] = useState(port.label);

  useEffect(() => {
    setPortValue(port.port);
    setLabelValue(port.label);
  }, [port.port, port.label]);

  function reset() {
    setPortValue(port.port);
    setLabelValue(port.label);
    setEditing(false);
  }

  async function save() {
    const newPort = portValue;
    if (newPort <= 0 || newPort > 65535) return;
    if (newPort !== port.port || labelValue !== port.label) {
      await onSave(port.id, port.port, newPort, labelValue);
    }
    setEditing(false);
  }

  return (
    <div className={`bg-slate-950 border rounded-lg p-3 ${hasConflict ? 'border-amber-500/40' : 'border-slate-800'}`}>
      <div className="flex items-start justify-between gap-2 mb-1">
        {editing ? (
          <input
            type="number"
            value={portValue}
            onChange={e => setPortValue(Number(e.target.value))}
            className="w-20 px-2 py-0.5 text-sm font-mono bg-slate-900 border border-slate-700 rounded text-slate-100 focus:border-emerald-500 focus:outline-none"
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') reset(); }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 text-sm font-mono font-medium text-slate-200 hover:text-emerald-300 transition-colors group"
            title="Click to edit port"
          >
            :{port.port}
            <Pencil className="w-3 h-3 text-slate-600 group-hover:text-emerald-400" />
          </button>
        )}
        <div className="flex items-center gap-1">
          {hasConflict && <Badge tone="amber">conflict</Badge>}
          {live === true && <Badge tone="emerald">live</Badge>}
          {live === false && <Badge tone="rose">closed</Badge>}
          {live === undefined && <Badge>–</Badge>}
        </div>
      </div>

      {editing ? (
        <input
          type="text"
          value={labelValue}
          onChange={e => setLabelValue(e.target.value)}
          className="w-full mt-1 px-2 py-0.5 text-[11px] bg-slate-900 border border-slate-700 rounded text-slate-300 focus:border-emerald-500 focus:outline-none"
          placeholder="Label"
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') reset(); }}
        />
      ) : (
        <div className="text-[11px] text-slate-500 truncate">{port.label || port.protocol}</div>
      )}

      {port.local_url && !editing && (
        <ExternalHref href={port.local_url} className="text-[11px] font-mono truncate block mt-0.5">
          {port.local_url}
        </ExternalHref>
      )}
      {port.health_url && !editing && (
        <ExternalHref href={port.health_url} className="text-[11px] font-mono truncate block mt-0.5 text-slate-500">
          health: {port.health_url}
        </ExternalHref>
      )}

      {stats && stats.totalSamples > 0 && !editing && (
        <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-slate-800/60">
          <Sparkline data={stats.samples.map(s => s.up)} width={56} height={10} />
          <span className={`text-[10px] font-mono ${stats.uptimePct >= 99 ? 'text-emerald-400' : stats.uptimePct >= 95 ? 'text-amber-400' : 'text-rose-400'}`}>
            {stats.uptimePct}%
          </span>
        </div>
      )}

      {editing && (
        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-slate-800">
          <Button variant="primary" disabled={saving} onClick={save}>
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          </Button>
          <Button variant="ghost" disabled={saving} onClick={reset}>Cancel</Button>
          <button
            type="button"
            onClick={() => onDelete(port.id)}
            className="ml-auto p-1.5 text-slate-600 hover:text-rose-400 transition-colors"
            title="Remove port"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function ConflictEditor({
  conflicts,
  projectId,
  saving,
  onApply,
}: {
  conflicts: PortConflict[];
  projectId: string;
  saving: boolean;
  onApply: (changes: { originalPort: number; newPort: number; entry: PortConflict['projects'][0] }[]) => Promise<void>;
}) {
  const [edits, setEdits] = useState<Record<string, number>>({});

  function editKey(port: number, entryId: string) {
    return `${port}-${entryId}`;
  }

  function getValue(conflictPort: number, entry: PortConflict['projects'][0]): number {
    return edits[editKey(conflictPort, entry.project_id)] ?? conflictPort;
  }

  const changes = useMemo(() => {
    const out: { originalPort: number; newPort: number; entry: PortConflict['projects'][0] }[] = [];
    for (const c of conflicts) {
      for (const entry of c.projects.filter(p => p.project_id === projectId)) {
        const val = getValue(c.port, entry);
        if (val !== c.port && val > 0 && val <= 65535) {
          out.push({ originalPort: c.port, newPort: val, entry });
        }
      }
    }
    return out;
  }, [conflicts, edits, projectId]);

  if (conflicts.length === 0) return null;

  return (
    <div className="mx-5 mt-4 mb-1 bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <span className="text-xs font-medium text-amber-300">
          Port conflict{conflicts.length > 1 ? 's' : ''} — edit your port below to resolve
        </span>
      </div>

      <div className="space-y-3">
        {conflicts.map(c => {
          const mine = c.projects.filter(p => p.project_id === projectId);
          const others = c.projects.filter(p => p.project_id !== projectId);
          return (
            <div key={c.port} className="bg-slate-950/60 rounded-lg px-3 py-2.5 border border-slate-800">
              <div className="text-[11px] text-slate-500 mb-2">
                <span className="font-mono text-amber-300">:{c.port}</span> shared with {others.map(o => o.project_name).join(', ')}
              </div>
              {mine.map(entry => {
                const val = getValue(c.port, entry);
                const changed = val !== c.port;
                return (
                  <div key={entry.source_id} className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-slate-300 shrink-0">{entry.label}</span>
                    <Badge tone={entry.source === 'command' ? 'blue' : 'slate'}>
                      {entry.source === 'command' ? 'cmd' : 'port'}
                    </Badge>
                    {changed && (
                      <>
                        <span className="text-[11px] font-mono text-slate-500">:{c.port}</span>
                        <ArrowRight className="w-3 h-3 text-amber-400/60" />
                      </>
                    )}
                    <input
                      type="number"
                      value={val}
                      onChange={e => setEdits(prev => ({ ...prev, [editKey(c.port, entry.project_id)]: Number(e.target.value) }))}
                      disabled={saving}
                      className="w-20 px-2 py-1 text-sm font-mono bg-slate-900 border border-slate-700 rounded text-slate-100 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {changes.length > 0 && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-amber-500/10">
          <span className="text-[11px] text-slate-400">{changes.length} change{changes.length > 1 ? 's' : ''} ready</span>
          <Button
            variant="primary"
            className="ml-auto"
            disabled={saving}
            onClick={() => onApply(changes).then(() => setEdits({}))}
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null}
            Apply changes
          </Button>
        </div>
      )}
    </div>
  );
}

type Props = {
  scope: ProjectScope;
  portStatus: Record<number, boolean>;
  uptimeMap: Map<number, UptimeStats>;
  localConflicts: PortConflict[];
  onChange: () => void;
  onConflictsRefresh: () => void;
};

export function PortStatusSection({
  scope,
  portStatus,
  uptimeMap,
  localConflicts,
  onChange,
  onConflictsRefresh,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conflictPorts = useMemo(
    () => new Set(localConflicts.map(c => c.port)),
    [localConflicts],
  );

  async function savePort(portId: string, oldPort: number, newPort: number, label: string) {
    setSaving(true);
    setError(null);
    try {
      const existing = scope.ports.find(p => p.id === portId);
      if (!existing) return;

      if (newPort !== oldPort) {
        await updatePortNumber(portId, oldPort, newPort);
      }
      if (label !== existing.label) {
        await upsertRow<ProjectPort>('project_ports', { ...existing, port: newPort, label });
      }

      if (newPort !== oldPort) {
        await insertActivityLog({
          project_id: scope.project.id,
          event_type: 'port_updated',
          category: 'ports',
          title: 'Port updated',
          detail: `Port ${oldPort} → ${newPort}`,
          metadata: { old_port: oldPort, new_port: newPort },
          source: 'cockpit',
        });
      }

      setSaved(true);
      onChange();
      onConflictsRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save port');
    } finally {
      setSaving(false);
    }
  }

  async function removePort(portId: string) {
    if (!confirm('Remove this port from the project?')) return;
    setSaving(true);
    try {
      await deleteRow('project_ports', portId);
      onChange();
      onConflictsRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function applyConflictChanges(
    changes: { originalPort: number; newPort: number; entry: PortConflict['projects'][0] }[],
  ) {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      for (const { originalPort, newPort, entry } of changes) {
        if (entry.source === 'port') {
          await updatePortNumber(entry.source_id, originalPort, newPort);
        } else {
          await updateCommandExpectedPort(entry.source_id, newPort);
        }
        await insertActivityLog({
          project_id: scope.project.id,
          event_type: 'port_conflict_resolved',
          category: 'ports',
          title: 'Port conflict resolved',
          detail: `Port ${originalPort} → ${newPort} (${entry.label})`,
          metadata: { old_port: originalPort, new_port: newPort, source: entry.source },
          source: 'cockpit',
        });
      }
      await regenerateAffectedContexts([scope.project.slug]);
      setSaved(true);
      onChange();
      onConflictsRefresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to apply changes');
    } finally {
      setSaving(false);
    }
  }

  if (scope.ports.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title="Port Status"
        action={
          <div className="flex items-center gap-2">
            {saved && (
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <Check className="w-3 h-3" /> Saved
              </span>
            )}
            {error && <span className="text-xs text-rose-400 max-w-[200px] truncate" title={error}>{error}</span>}
          </div>
        }
      />

      <ConflictEditor
        conflicts={localConflicts}
        projectId={scope.project.id}
        saving={saving}
        onApply={applyConflictChanges}
      />

      <div className="px-5 pt-2 pb-1">
        <p className="text-[11px] text-slate-500">Click a port number to edit. URLs update automatically.</p>
      </div>

      <div className="p-5 pt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {scope.ports.map(p => (
          <EditablePortCard
            key={p.id}
            port={p}
            live={portStatus[p.port]}
            stats={uptimeMap.get(p.port)}
            hasConflict={conflictPorts.has(p.port)}
            saving={saving}
            onSave={savePort}
            onDelete={removePort}
          />
        ))}
      </div>
    </Card>
  );
}
