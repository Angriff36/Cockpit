import { useState, useMemo, useRef, useCallback, useEffect, Fragment } from 'react';
import { Plus, Trash2, Search, X, Clock, Terminal, RefreshCw, Settings, Zap, AlertTriangle, Play, Loader2, Regex, Info, AlertCircle } from 'lucide-react';
import type { ProjectScope, ActivityLogEntry } from '../../lib/types';
import { insertActivityLog, deleteActivityLogEntry, clearActivityLog, listActivityLogPaged } from '../../lib/api';
import { Card, CardHeader, Field, Input, Textarea, Select, Button, Badge } from '../ui';

const PAGE_SIZE = 50;

const EVENT_CATEGORIES = [
  { value: 'daemon', label: 'Daemon', icon: Play, tone: 'emerald' as const },
  { value: 'sync', label: 'Sync', icon: RefreshCw, tone: 'blue' as const },
  { value: 'command', label: 'Command', icon: Terminal, tone: 'slate' as const },
  { value: 'config', label: 'Config Change', icon: Settings, tone: 'amber' as const },
  { value: 'deploy', label: 'Deploy', icon: Zap, tone: 'blue' as const },
  { value: 'error', label: 'Error', icon: AlertTriangle, tone: 'rose' as const },
  { value: 'general', label: 'General', icon: Clock, tone: 'slate' as const },
];

function categoryMeta(cat: string) {
  return EVENT_CATEGORIES.find(c => c.value === cat) || EVENT_CATEGORIES[EVENT_CATEGORIES.length - 1];
}

const SOURCE_OPTIONS = ['manual', 'daemon', 'cli', 'ui', 'webhook', 'ci'];

function emptyEntry(projectId: string): Partial<ActivityLogEntry> {
  return {
    project_id: projectId,
    event_type: '',
    category: 'general',
    title: '',
    detail: '',
    metadata: {},
    source: 'manual',
  };
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  let relative: string;
  if (diffMin < 1) relative = 'just now';
  else if (diffMin < 60) relative = `${diffMin}m ago`;
  else if (diffHr < 24) relative = `${diffHr}h ago`;
  else if (diffDay < 7) relative = `${diffDay}d ago`;
  else relative = d.toLocaleDateString();

  return relative;
}

function formatTimestampFull(iso: string): string {
  return new Date(iso).toLocaleString();
}

type LogLevel = 'error' | 'warn' | 'info' | 'all';

const LEVEL_MAP: Record<string, LogLevel> = {
  error: 'error',
  sync: 'info',
  command: 'info',
  config: 'warn',
  deploy: 'info',
  daemon: 'info',
  general: 'info',
};

const LEVEL_FILTERS: { value: LogLevel; label: string; icon: typeof AlertTriangle; color: string; activeColor: string }[] = [
  { value: 'error', label: 'Error', icon: AlertTriangle, color: 'text-rose-500', activeColor: 'bg-rose-500/15 text-rose-300 border-rose-500/40' },
  { value: 'warn', label: 'Warn', icon: AlertCircle, color: 'text-amber-500', activeColor: 'bg-amber-500/15 text-amber-300 border-amber-500/40' },
  { value: 'info', label: 'Info', icon: Info, color: 'text-blue-400', activeColor: 'bg-blue-500/15 text-blue-300 border-blue-500/40' },
];

function getLevel(category: string): LogLevel {
  return LEVEL_MAP[category] || 'info';
}

function HighlightText({ text, query, isRegex }: { text: string; query: string; isRegex: boolean }) {
  if (!query.trim()) return <>{text}</>;

  let regex: RegExp | null = null;
  if (isRegex) {
    try { regex = new RegExp(query, 'gi'); } catch { return <>{text}</>; }
  } else {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    regex = new RegExp(escaped, 'gi');
  }

  const parts: { text: string; match: boolean }[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push({ text: text.slice(lastIndex, match.index), match: false });
    parts.push({ text: match[0], match: true });
    lastIndex = regex.lastIndex;
    if (!match[0].length) { regex.lastIndex++; }
  }
  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex), match: false });
  if (parts.length === 0) return <>{text}</>;

  return <>
    {parts.map((p, i) => p.match
      ? <mark key={i} className="bg-amber-400/25 text-amber-200 rounded-sm px-px">{p.text}</mark>
      : <Fragment key={i}>{p.text}</Fragment>
    )}
  </>;
}

export function ActivityLogTab({ scope, onChange }: { scope: ProjectScope; onChange: () => void }) {
  const [entries, setEntries] = useState<ActivityLogEntry[]>(scope.activity_log || []);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<ActivityLogEntry>>(emptyEntry(scope.project.id));
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const [filterLevel, setFilterLevel] = useState<LogLevel>('all');
  const [regexMode, setRegexMode] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [regexError, setRegexError] = useState<string | null>(null);

  // Infinite scroll state
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Initialize hasMore based on initial data
  useEffect(() => {
    setHasMore((scope.activity_log || []).length >= PAGE_SIZE);
  }, [scope.activity_log]);

  // Reset entries when scope changes
  useEffect(() => {
    setEntries(scope.activity_log || []);
    setHasMore((scope.activity_log || []).length >= PAGE_SIZE);
  }, [scope.project.id]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const result = await listActivityLogPaged(scope.project.id, entries.length, PAGE_SIZE);
      setEntries(prev => [...prev, ...result.data]);
      setHasMore(result.hasMore);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, entries.length, scope.project.id]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (observerEntries) => {
        if (observerEntries[0].isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  const searchRegex = useMemo(() => {
    if (!search.trim()) { setRegexError(null); return null; }
    if (regexMode) {
      try { const r = new RegExp(search, 'gi'); setRegexError(null); return r; }
      catch (e) { setRegexError((e as Error).message); return null; }
    }
    setRegexError(null);
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escaped, 'gi');
  }, [search, regexMode]);

  const filtered = useMemo(() => {
    let result = entries;
    if (filterCat !== 'all') result = result.filter(e => e.category === filterCat);
    if (filterLevel !== 'all') result = result.filter(e => getLevel(e.category) === filterLevel);
    if (search.trim() && searchRegex) {
      result = result.filter(e => {
        const testStr = `${e.title} ${e.detail} ${e.event_type}`;
        searchRegex.lastIndex = 0;
        return searchRegex.test(testStr);
      });
    }
    return result;
  }, [entries, filterCat, filterLevel, search, searchRegex]);

  async function save() {
    if (!draft.title?.trim()) return;
    setSaving(true);
    try {
      const saved = await insertActivityLog(draft);
      setEntries(prev => [saved, ...prev]);
      setDraft(emptyEntry(scope.project.id));
      setAdding(false);
      onChange();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      await deleteActivityLogEntry(id);
      setEntries(prev => prev.filter(e => e.id !== id));
      onChange();
    } catch { /* ignore */ }
  }

  async function handleClear() {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setClearing(true);
    try {
      await clearActivityLog(scope.project.id);
      setEntries([]);
      setHasMore(false);
      setConfirmClear(false);
      onChange();
    } finally {
      setClearing(false);
    }
  }

  // Group entries by date
  const grouped = useMemo(() => {
    const groups: { label: string; entries: ActivityLogEntry[] }[] = [];
    const map = new Map<string, ActivityLogEntry[]>();

    for (const entry of filtered) {
      const d = new Date(entry.created_at);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      let label: string;
      if (d.toDateString() === today.toDateString()) label = 'Today';
      else if (d.toDateString() === yesterday.toDateString()) label = 'Yesterday';
      else label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(entry);
    }

    for (const [label, entries] of map) {
      groups.push({ label, entries });
    }
    return groups;
  }, [filtered]);

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <Input
            placeholder={regexMode ? 'Search with regex...' : 'Search activity...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`!pl-9 !pr-16 ${regexError ? '!border-rose-500' : ''}`}
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <button
              onClick={() => setRegexMode(r => !r)}
              className={`p-1 rounded transition-colors ${regexMode ? 'text-amber-400 bg-amber-500/15' : 'text-slate-500 hover:text-slate-300'}`}
              title={regexMode ? 'Disable regex mode' : 'Enable regex mode'}
            >
              <Regex className="w-3.5 h-3.5" />
            </button>
            {search && (
              <button onClick={() => setSearch('')} className="text-slate-500 hover:text-slate-300 p-0.5">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <Select
          value={filterCat}
          onChange={e => setFilterCat(e.target.value)}
          className="!w-40"
        >
          <option value="all">All categories</option>
          {EVENT_CATEGORIES.map(c => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </Select>

        {/* Level filter buttons */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setFilterLevel('all')}
            className={`px-2 py-1 rounded text-[10px] font-medium uppercase tracking-wider border transition-colors ${
              filterLevel === 'all'
                ? 'bg-slate-700 text-slate-200 border-slate-600'
                : 'text-slate-500 border-transparent hover:text-slate-300'
            }`}
          >
            All
          </button>
          {LEVEL_FILTERS.map(lf => {
            const Icon = lf.icon;
            const active = filterLevel === lf.value;
            return (
              <button
                key={lf.value}
                onClick={() => setFilterLevel(active ? 'all' : lf.value)}
                className={`px-2 py-1 rounded text-[10px] font-medium uppercase tracking-wider border transition-colors flex items-center gap-1 ${
                  active ? lf.activeColor : 'text-slate-500 border-transparent hover:text-slate-300'
                }`}
                title={`Filter by ${lf.label}`}
              >
                <Icon className="w-3 h-3" />
                {lf.label}
              </button>
            );
          })}
        </div>

        <Button variant="primary" onClick={() => { setAdding(true); setDraft(emptyEntry(scope.project.id)); }}>
          <Plus className="w-3.5 h-3.5 inline mr-1" />
          Log Event
        </Button>

        {entries.length > 0 && (
          <Button
            variant={confirmClear ? 'danger' : 'ghost'}
            onClick={handleClear}
            disabled={clearing}
            onBlur={() => setConfirmClear(false)}
          >
            {confirmClear ? 'Confirm clear?' : 'Clear all'}
          </Button>
        )}
      </div>

      {/* Regex error display */}
      {regexError && (
        <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded px-3 py-1.5">
          Invalid regex: {regexError}
        </div>
      )}

      {/* Add new entry form */}
      {adding && (
        <Card>
          <CardHeader title="Log New Event" action={
            <button onClick={() => setAdding(false)} className="text-slate-500 hover:text-slate-300">
              <X className="w-4 h-4" />
            </button>
          } />
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <Field label="Title">
                <Input
                  placeholder="e.g. Daemon started"
                  value={draft.title || ''}
                  onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                />
              </Field>
              <Field label="Category">
                <Select
                  value={draft.category || 'general'}
                  onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}
                >
                  {EVENT_CATEGORIES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Source">
                <Select
                  value={draft.source || 'manual'}
                  onChange={e => setDraft(d => ({ ...d, source: e.target.value }))}
                >
                  {SOURCE_OPTIONS.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Event Type">
              <Input
                placeholder="e.g. daemon.start, sync.complete, field.update"
                value={draft.event_type || ''}
                onChange={e => setDraft(d => ({ ...d, event_type: e.target.value }))}
              />
            </Field>
            <Field label="Detail">
              <Textarea
                rows={2}
                placeholder="Optional description or context..."
                value={draft.detail || ''}
                onChange={e => setDraft(d => ({ ...d, detail: e.target.value }))}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
              <Button onClick={save} disabled={saving || !draft.title?.trim()}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Summary stats */}
      {entries.length > 0 && (
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span>{entries.length} event{entries.length !== 1 ? 's' : ''} loaded</span>
          {(filterCat !== 'all' || filterLevel !== 'all') && <span>{filtered.length} matching filter</span>}
          {hasMore && <span className="text-slate-600">· scroll for more</span>}
        </div>
      )}

      {/* Timeline */}
      {grouped.length === 0 ? (
        <div className="text-center py-12 text-slate-600 text-sm">
          {entries.length === 0 ? 'No activity logged yet.' : 'No events match your search.'}
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(group => (
            <div key={group.label}>
              <div className="text-[11px] uppercase tracking-wider font-medium text-slate-500 mb-2 px-1">
                {group.label}
              </div>
              <Card>
                <div className="divide-y divide-slate-800">
                  {group.entries.map(entry => {
                    const meta = categoryMeta(entry.category);
                    const Icon = meta.icon;
                    return (
                      <div key={entry.id} className="flex items-start gap-3 px-5 py-3 group hover:bg-slate-800/30 transition-colors">
                        <div className="mt-0.5 shrink-0">
                          <Icon className="w-4 h-4 text-slate-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm text-slate-200 font-medium">
                              <HighlightText text={entry.title} query={search} isRegex={regexMode} />
                            </span>
                            <Badge tone={meta.tone}>{meta.label}</Badge>
                            {entry.event_type && (
                              <span className="text-[10px] text-slate-500 font-mono">
                                <HighlightText text={entry.event_type} query={search} isRegex={regexMode} />
                              </span>
                            )}
                            {entry.source !== 'manual' && (
                              <span className="text-[10px] text-slate-600 font-mono">via {entry.source}</span>
                            )}
                          </div>
                          {entry.detail && (
                            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                              <HighlightText text={entry.detail} query={search} isRegex={regexMode} />
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] text-slate-600" title={formatTimestampFull(entry.created_at)}>
                            {formatTimestamp(entry.created_at)}
                          </span>
                          <button
                            onClick={() => remove(entry.id)}
                            className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-rose-400 transition-all"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>
          ))}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="flex justify-center py-4">
        {loadingMore && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Loading more...
          </div>
        )}
      </div>
    </div>
  );
}
