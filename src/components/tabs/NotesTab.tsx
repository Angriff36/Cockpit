import { useState, useMemo } from 'react';
import { Save, Plus, Trash2, Pin, PinOff, Search, X, AlertTriangle, BookOpen, Lightbulb, Bug, Database, Wrench } from 'lucide-react';
import type { ProjectScope, ProjectNote } from '../../lib/types';
import { upsertRow, deleteRow } from '../../lib/api';
import { Card, CardHeader, Field, Input, Textarea, Select, Button, Badge } from '../ui';

const CATEGORIES = [
  { value: 'general', label: 'General', icon: BookOpen, tone: 'slate' as const },
  { value: 'gotcha', label: 'Gotcha', icon: AlertTriangle, tone: 'amber' as const },
  { value: 'tip', label: 'Tip', icon: Lightbulb, tone: 'emerald' as const },
  { value: 'bug', label: 'Known Bug', icon: Bug, tone: 'rose' as const },
  { value: 'database', label: 'Database', icon: Database, tone: 'blue' as const },
  { value: 'setup', label: 'Setup', icon: Wrench, tone: 'slate' as const },
];

function categoryMeta(cat: string) {
  return CATEGORIES.find(c => c.value === cat) || CATEGORIES[0];
}

function emptyNote(projectId: string): Partial<ProjectNote> {
  return {
    project_id: projectId,
    title: '',
    content: '',
    category: 'general',
    tags: '',
    pinned: false,
  };
}

export function NotesTab({ scope, onChange }: { scope: ProjectScope; onChange: () => void }) {
  const [notes, setNotes] = useState<ProjectNote[]>(scope.notes || []);
  const [editing, setEditing] = useState<Partial<ProjectNote> | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');

  const filtered = useMemo(() => {
    let result = notes;
    if (filterCat !== 'all') result = result.filter(n => n.category === filterCat);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(n =>
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q) ||
        n.tags.toLowerCase().includes(q)
      );
    }
    return result;
  }, [notes, filterCat, search]);

  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      const saved = await upsertRow<ProjectNote>('project_notes', {
        ...editing,
        updated_at: new Date().toISOString(),
      } as any);
      if (editing.id) {
        setNotes(prev => prev.map(n => n.id === saved.id ? saved : n));
      } else {
        setNotes(prev => [saved, ...prev]);
      }
      setEditing(null);
      onChange();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this note?')) return;
    await deleteRow('project_notes', id);
    setNotes(prev => prev.filter(n => n.id !== id));
    if (editing?.id === id) setEditing(null);
    onChange();
  }

  async function togglePin(note: ProjectNote) {
    const updated = { ...note, pinned: !note.pinned, updated_at: new Date().toISOString() };
    const saved = await upsertRow<ProjectNote>('project_notes', updated as any);
    setNotes(prev => prev.map(n => n.id === saved.id ? saved : n).sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    }));
  }

  const gotchaCount = notes.filter(n => n.category === 'gotcha').length;
  const pinnedCount = notes.filter(n => n.pinned).length;

  return (
    <div className="space-y-4">
      {/* Header info */}
      <div className="bg-blue-500/5 border border-blue-500/20 rounded px-4 py-3 flex items-start gap-2">
        <BookOpen className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
        <div className="text-xs text-blue-200/80">
          Project notes capture institutional knowledge, gotchas, and tips. All notes are included in the AI Agent Context export and are searchable across projects.
          {gotchaCount > 0 && <span className="text-amber-300/80 ml-1">{gotchaCount} gotcha{gotchaCount !== 1 ? 's' : ''} documented.</span>}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <Button onClick={() => setEditing(emptyNote(scope.project.id))}>
          <Plus className="w-3 h-3 inline mr-1" />New Note
        </Button>
        <div className="flex-1 relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search notes..."
            className="w-full bg-slate-950 border border-slate-800 rounded pl-9 pr-8 py-1.5 text-slate-100 text-xs placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setFilterCat('all')}
            className={`px-2 py-1 rounded text-[10px] uppercase tracking-wider font-medium transition-colors ${
              filterCat === 'all' ? 'bg-slate-700 text-slate-100' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            All ({notes.length})
          </button>
          {CATEGORIES.map(cat => {
            const count = notes.filter(n => n.category === cat.value).length;
            if (count === 0) return null;
            return (
              <button
                key={cat.value}
                onClick={() => setFilterCat(filterCat === cat.value ? 'all' : cat.value)}
                className={`px-2 py-1 rounded text-[10px] uppercase tracking-wider font-medium transition-colors ${
                  filterCat === cat.value ? 'bg-slate-700 text-slate-100' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {cat.label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Editor */}
      {editing && (
        <Card>
          <CardHeader title={editing.id ? 'Edit Note' : 'New Note'} action={
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={save} disabled={saving || !editing.title?.trim()}>
                <Save className="w-3 h-3 inline mr-1" />{saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          } />
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <Field label="Title">
                  <Input
                    value={editing.title || ''}
                    onChange={e => setEditing({ ...editing, title: e.target.value })}
                    placeholder="What's this note about?"
                    autoFocus
                  />
                </Field>
              </div>
              <Field label="Category">
                <Select
                  value={editing.category || 'general'}
                  onChange={e => setEditing({ ...editing, category: e.target.value })}
                >
                  {CATEGORIES.map(cat => (
                    <option key={cat.value} value={cat.value}>{cat.label}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Content">
              <Textarea
                rows={8}
                value={editing.content || ''}
                onChange={e => setEditing({ ...editing, content: e.target.value })}
                placeholder="Write your note here. Supports plain text. Use line breaks for structure."
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Tags (comma separated)">
                <Input
                  value={editing.tags || ''}
                  onChange={e => setEditing({ ...editing, tags: e.target.value })}
                  placeholder="deploy, auth, migration"
                />
              </Field>
              <div className="flex items-end pb-0.5">
                <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editing.pinned || false}
                    onChange={e => setEditing({ ...editing, pinned: e.target.checked })}
                    className="rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-emerald-500"
                  />
                  Pin to top
                </label>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Notes list */}
      {filtered.length === 0 ? (
        <Card>
          <div className="px-5 py-8 text-center text-xs text-slate-500">
            {notes.length === 0
              ? 'No notes yet. Click "New Note" to capture project knowledge.'
              : 'No notes match your search.'}
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(note => {
            const meta = categoryMeta(note.category);
            const Icon = meta.icon;
            const tags = note.tags.split(',').map(s => s.trim()).filter(Boolean);
            return (
              <Card key={note.id}>
                <div className="px-5 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${
                        meta.tone === 'amber' ? 'text-amber-400' :
                        meta.tone === 'rose' ? 'text-rose-400' :
                        meta.tone === 'emerald' ? 'text-emerald-400' :
                        meta.tone === 'blue' ? 'text-blue-400' :
                        'text-slate-400'
                      }`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {note.pinned && <Pin className="w-3 h-3 text-emerald-400 shrink-0" />}
                          <span className="text-sm font-medium text-slate-100 truncate">{note.title}</span>
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                        </div>
                        <div className="text-xs text-slate-400 whitespace-pre-wrap line-clamp-3">{note.content}</div>
                        {tags.length > 0 && (
                          <div className="flex gap-1.5 mt-2">
                            {tags.map(tag => (
                              <span key={tag} className="text-[10px] text-slate-500 bg-slate-800/50 rounded px-1.5 py-0.5">#{tag}</span>
                            ))}
                          </div>
                        )}
                        <div className="text-[10px] text-slate-600 mt-1.5">
                          {new Date(note.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" onClick={() => togglePin(note)}>
                        {note.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                      </Button>
                      <Button variant="ghost" onClick={() => setEditing(note)}>
                        Edit
                      </Button>
                      <Button variant="ghost" onClick={() => remove(note.id)}>
                        <Trash2 className="w-3 h-3 text-rose-400/60" />
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Summary card */}
      {notes.length > 0 && (
        <Card>
          <CardHeader title="Notes summary" />
          <div className="p-5 grid grid-cols-3 gap-4 text-xs">
            <div className="flex justify-between"><span className="text-slate-500">Total notes</span><span className="text-slate-200 font-mono">{notes.length}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Pinned</span><span className="text-slate-200 font-mono">{pinnedCount}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Gotchas</span><span className="text-amber-300 font-mono">{gotchaCount}</span></div>
          </div>
        </Card>
      )}
    </div>
  );
}
