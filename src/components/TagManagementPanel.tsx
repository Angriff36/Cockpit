import { useState, useMemo, useCallback } from 'react';
import { Plus, Pencil, Trash2, X, Check, FolderGit2, Loader2, ArrowRight } from 'lucide-react';
import type { Project } from '../lib/types';
import { getTagAggregates, renameTag, deleteTag, getTagColors, setTagColor, saveTagColors } from '../lib/api';
import { Modal, Button } from './ui';

// ── Color palette for tags ──────────────────────────────────────────────────

const TAG_COLOR_OPTIONS = [
  { name: 'Slate', bg: 'bg-slate-700/50', text: 'text-slate-300', border: 'border-slate-600/40', hex: '#475569' },
  { name: 'Red', bg: 'bg-rose-500/10', text: 'text-rose-300', border: 'border-rose-500/30', hex: '#f43f5e' },
  { name: 'Orange', bg: 'bg-orange-500/10', text: 'text-orange-300', border: 'border-orange-500/30', hex: '#f97316' },
  { name: 'Amber', bg: 'bg-amber-500/10', text: 'text-amber-300', border: 'border-amber-500/30', hex: '#f59e0b' },
  { name: 'Yellow', bg: 'bg-yellow-500/10', text: 'text-yellow-300', border: 'border-yellow-500/30', hex: '#eab308' },
  { name: 'Lime', bg: 'bg-lime-500/10', text: 'text-lime-300', border: 'border-lime-500/30', hex: '#84cc16' },
  { name: 'Green', bg: 'bg-emerald-500/10', text: 'text-emerald-300', border: 'border-emerald-500/30', hex: '#10b981' },
  { name: 'Cyan', bg: 'bg-cyan-500/10', text: 'text-cyan-300', border: 'border-cyan-500/30', hex: '#06b6d4' },
  { name: 'Blue', bg: 'bg-blue-500/10', text: 'text-blue-300', border: 'border-blue-500/30', hex: '#3b82f6' },
  { name: 'Violet', bg: 'bg-violet-500/10', text: 'text-violet-300', border: 'border-violet-500/30', hex: '#8b5cf6' },
  { name: 'Purple', bg: 'bg-purple-500/10', text: 'text-purple-300', border: 'border-purple-500/30', hex: '#a855f7' },
  { name: 'Pink', bg: 'bg-pink-500/10', text: 'text-pink-300', border: 'border-pink-500/30', hex: '#ec4899' },
];

function getColorForTag(tagName: string, colors: Record<string, string>) {
  const colorName = colors[tagName];
  return TAG_COLOR_OPTIONS.find(c => c.name === colorName) || TAG_COLOR_OPTIONS[0];
}

// ── Inline edit for tag name ────────────────────────────────────────────────

function InlineEdit({ value, onSave, onCancel }: {
  value: string;
  onSave: (newValue: string) => void;
  onCancel: () => void;
}) {
  const [editValue, setEditValue] = useState(value);
  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        value={editValue}
        onChange={e => setEditValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && editValue.trim()) onSave(editValue.trim());
          if (e.key === 'Escape') onCancel();
        }}
        autoFocus
        className="bg-slate-950 border border-emerald-500/50 rounded px-2 py-0.5 text-sm text-slate-100 focus:outline-none w-40"
      />
      <button onClick={() => editValue.trim() && onSave(editValue.trim())} className="text-emerald-400 hover:text-emerald-300 p-0.5">
        <Check className="w-3.5 h-3.5" />
      </button>
      <button onClick={onCancel} className="text-slate-500 hover:text-slate-300 p-0.5">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Color picker popover ────────────────────────────────────────────────────

function ColorPicker({ currentColor, onSelect }: {
  currentColor: string;
  onSelect: (colorName: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 p-2 bg-slate-800 border border-slate-700 rounded-lg shadow-xl">
      {TAG_COLOR_OPTIONS.map(c => (
        <button
          key={c.name}
          onClick={() => onSelect(c.name)}
          className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${currentColor === c.name ? 'border-white scale-110' : 'border-transparent'}`}
          style={{ backgroundColor: c.hex }}
          title={c.name}
        />
      ))}
    </div>
  );
}

// ── Bulk reassign dialog ────────────────────────────────────────────────────

function BulkReassignDialog({
  tagName,
  projects,
  open,
  onClose,
  onConfirm,
  busy,
}: {
  tagName: string;
  projects: Project[];
  open: boolean;
  onClose: () => void;
  onConfirm: (targetTag: string) => void;
  busy: boolean;
}) {
  const [targetTag, setTargetTag] = useState('');

  return (
    <Modal open={open} onClose={onClose} title={`Reassign "${tagName}"`}>
      <div className="space-y-4">
        <p className="text-sm text-slate-400">
          Replace <span className="text-slate-200 font-medium">{tagName}</span> with a different tag across {projects.length} project{projects.length !== 1 ? 's' : ''}.
        </p>
        <div>
          <label className="block text-[11px] uppercase tracking-wider font-medium text-slate-500 mb-1.5">
            New tag name
          </label>
          <input
            type="text"
            value={targetTag}
            onChange={e => setTargetTag(e.target.value)}
            placeholder="Enter new tag name"
            className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 text-sm placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
            onKeyDown={e => { if (e.key === 'Enter' && targetTag.trim()) onConfirm(targetTag.trim()); }}
            autoFocus
          />
        </div>
        <div className="max-h-32 overflow-y-auto rounded border border-slate-800 bg-slate-950">
          {projects.map(p => (
            <div key={p.id} className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-800/50 last:border-b-0">
              <FolderGit2 className="w-3 h-3 text-slate-500 shrink-0" />
              <span className="text-xs text-slate-300 truncate">{p.name || p.slug}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => targetTag.trim() && onConfirm(targetTag.trim())}
            disabled={busy || !targetTag.trim()}
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5 inline" /> : null}
            Reassign
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Delete confirmation ─────────────────────────────────────────────────────

function DeleteTagDialog({
  tagName,
  projectCount,
  open,
  onClose,
  onConfirm,
  busy,
}: {
  tagName: string;
  projectCount: number;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={`Delete tag "${tagName}"`}>
      <div className="space-y-4">
        <p className="text-sm text-slate-400">
          This will remove <span className="text-slate-200 font-medium">{tagName}</span> from {projectCount} project{projectCount !== 1 ? 's' : ''}.
          This cannot be undone.
        </p>
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5 inline" /> : null}
            Delete tag
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Tag Management Panel ────────────────────────────────────────────────────

type Props = {
  projects: Project[];
  open: boolean;
  onClose: () => void;
  onReload: () => void;
  onNavigateToProject: (slug: string) => void;
};

export function TagManagementPanel({ projects, open, onClose, onReload, onNavigateToProject }: Props) {
  const [search, setSearch] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [tagColors, setTagColorsLocal] = useState<Record<string, string>>(getTagColors);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [colorPickerTag, setColorPickerTag] = useState<string | null>(null);
  const [reassignTag, setReassignTag] = useState<string | null>(null);
  const [deleteTagState, setDeleteTagState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expandedTag, setExpandedTag] = useState<string | null>(null);

  // Aggregate tag data
  const tagData = useMemo(() => {
    const aggregates = getTagAggregates(projects);
    const entries = [...aggregates.entries()]
      .map(([name, data]) => ({ name, count: data.count, projects: data.projects }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter(e => e.name.toLowerCase().includes(q));
  }, [projects, search]);

  const totalTags = tagData.length;
  const totalTaggings = tagData.reduce((sum, e) => sum + e.count, 0);

  const refreshColors = useCallback(() => {
    setTagColorsLocal(getTagColors());
  }, []);

  async function handleRename(oldName: string, newName: string) {
    if (oldName === newName) { setEditingTag(null); return; }
    setBusy(true);
    try {
      await renameTag(oldName, newName, projects);
      // Transfer color
      const colors = getTagColors();
      if (colors[oldName]) {
        colors[newName] = colors[oldName];
        delete colors[oldName];
        saveTagColors(colors);
      }
      refreshColors();
      setEditingTag(null);
      onReload();
    } catch (err: any) {
      alert(`Rename failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(tagName: string) {
    setBusy(true);
    try {
      await deleteTag(tagName, projects);
      // Clean up color
      const colors = getTagColors();
      delete colors[tagName];
      saveTagColors(colors);
      refreshColors();
      setDeleteTagState(null);
      onReload();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleReassign(oldTag: string, newTag: string) {
    setBusy(true);
    try {
      await renameTag(oldTag, newTag, projects);
      // Transfer color
      const colors = getTagColors();
      if (colors[oldTag]) {
        colors[newTag] = colors[oldTag];
        delete colors[oldTag];
        saveTagColors(colors);
      }
      refreshColors();
      setReassignTag(null);
      onReload();
    } catch (err: any) {
      alert(`Reassign failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    if (!newTagName.trim()) return;
    setBusy(true);
    try {
      // "Creating" a tag just means setting a color for it so it appears in the panel
      // even before it's assigned to a project
      setTagColor(newTagName.trim(), tagColors[newTagName.trim()] || 'Slate');
      refreshColors();
      setNewTagName('');
    } catch (err: any) {
      alert(`Create failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  function handleColorChange(tagName: string, colorName: string) {
    setTagColor(tagName, colorName);
    refreshColors();
    setColorPickerTag(null);
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="Tag Management" width="max-w-2xl">
        <div className="space-y-4">
          {/* Summary */}
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span>{totalTags} unique tags</span>
            <span className="text-slate-700">|</span>
            <span>{totalTaggings} assignments across {projects.length} projects</span>
          </div>

          {/* Search + Create row */}
          <div className="flex gap-2">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search tags..."
              className="flex-1 bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 text-sm placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
            />
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={newTagName}
                onChange={e => setNewTagName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
                placeholder="New tag..."
                className="w-36 bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 text-sm placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
              />
              <Button variant="secondary" onClick={handleCreate} disabled={!newTagName.trim()}>
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {/* Tag list */}
          <div className="max-h-[50vh] overflow-y-auto rounded border border-slate-800 bg-slate-950">
            {tagData.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-slate-500">
                {search ? 'No tags match your search' : 'No tags yet. Add tags to projects to see them here.'}
              </div>
            )}
            {tagData.map(entry => {
              const color = getColorForTag(entry.name, tagColors);
              const isEditing = editingTag === entry.name;
              const isExpanded = expandedTag === entry.name;

              return (
                <div key={entry.name} className="border-b border-slate-800/50 last:border-b-0">
                  {/* Main row */}
                  <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-800/30 transition-colors">
                    {/* Color dot */}
                    <div className="relative">
                      <button
                        onClick={() => setColorPickerTag(colorPickerTag === entry.name ? null : entry.name)}
                        className="w-4 h-4 rounded-full border border-slate-600 hover:border-slate-400 transition-colors"
                        style={{ backgroundColor: color.hex }}
                        title="Change color"
                      />
                      {colorPickerTag === entry.name && (
                        <div className="absolute top-6 left-0 z-50">
                          <ColorPicker
                            currentColor={tagColors[entry.name] || 'Slate'}
                            onSelect={(c) => handleColorChange(entry.name, c)}
                          />
                        </div>
                      )}
                    </div>

                    {/* Tag name (editable) */}
                    {isEditing ? (
                      <InlineEdit
                        value={entry.name}
                        onSave={(newName) => handleRename(entry.name, newName)}
                        onCancel={() => setEditingTag(null)}
                      />
                    ) : (
                      <button
                        onClick={() => setExpandedTag(isExpanded ? null : entry.name)}
                        className="flex-1 text-left text-sm text-slate-200 font-medium hover:text-emerald-300 transition-colors truncate"
                      >
                        {entry.name}
                      </button>
                    )}

                    {/* Usage count */}
                    <span className="text-[11px] text-slate-500 tabular-nums shrink-0">
                      {entry.count} project{entry.count !== 1 ? 's' : ''}
                    </span>

                    {/* Actions */}
                    {!isEditing && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => setEditingTag(entry.name)}
                          className="text-slate-600 hover:text-slate-300 p-1 transition-colors"
                          title="Rename tag"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => setReassignTag(entry.name)}
                          className="text-slate-600 hover:text-slate-300 p-1 transition-colors"
                          title="Reassign tag"
                        >
                          <ArrowRight className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => setDeleteTagState(entry.name)}
                          className="text-slate-600 hover:text-rose-400 p-1 transition-colors"
                          title="Delete tag"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Expanded project list */}
                  {isExpanded && (
                    <div className="px-4 pb-2.5 pl-11 space-y-0.5">
                      {entry.projects.map(p => (
                        <button
                          key={p.id}
                          onClick={() => { onClose(); onNavigateToProject(p.slug); }}
                          className="flex items-center gap-2 w-full text-left px-2 py-1 rounded hover:bg-slate-800/50 transition-colors group"
                        >
                          <FolderGit2 className="w-3 h-3 text-slate-600 shrink-0" />
                          <span className="text-xs text-slate-400 group-hover:text-slate-200 truncate transition-colors">{p.name || p.slug}</span>
                          <span className="text-[10px] text-slate-600 font-mono ml-auto shrink-0">{p.slug}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Close */}
          <div className="flex justify-end pt-1">
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </div>
        </div>
      </Modal>

      {/* Reassign dialog */}
      {reassignTag && (
        <BulkReassignDialog
          tagName={reassignTag}
          projects={tagData.find(e => e.name === reassignTag)?.projects || []}
          open={!!reassignTag}
          onClose={() => setReassignTag(null)}
          onConfirm={(newTag) => handleReassign(reassignTag, newTag)}
          busy={busy}
        />
      )}

      {/* Delete confirmation */}
      {deleteTagState && (
        <DeleteTagDialog
          tagName={deleteTagState}
          projectCount={tagData.find(e => e.name === deleteTagState)?.count || 0}
          open={!!deleteTagState}
          onClose={() => setDeleteTagState(null)}
          onConfirm={() => handleDelete(deleteTagState)}
          busy={busy}
        />
      )}
    </>
  );
}
