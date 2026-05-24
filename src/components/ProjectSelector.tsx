import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, FolderGit2, FolderOpen, LayoutDashboard, Loader2, Plus, Search } from 'lucide-react';
import type { Project } from '../lib/types';
import { checkHealth, pickDirectory } from '../lib/daemon';
import { findProjectByRepoPath } from '../lib/projectPathMatch';

type Props = {
  projects: Project[];
  activeSlug: string | null;
  onSelect: (slug: string) => void;
  onDashboard: () => void;
  onNew: () => void;
};

export function ProjectSelector({ projects, activeSlug, onSelect, onDashboard, onNew }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeProjects = useMemo(
    () => projects.filter(p => p.status !== 'archived'),
    [projects],
  );

  const active = activeProjects.find(p => p.slug === activeSlug);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activeProjects;
    return activeProjects.filter(p => {
      const name = (p.name || p.slug).toLowerCase();
      return name.includes(q) || p.slug.toLowerCase().includes(q);
    });
  }, [activeProjects, query]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    function handleClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function close() {
    setOpen(false);
    setQuery('');
  }

  function pickDashboard() {
    onDashboard();
    close();
  }

  function pickProject(slug: string) {
    onSelect(slug);
    close();
  }

  async function browseFolder() {
    setBrowseError(null);
    setBrowsing(true);
    try {
      await checkHealth();
      const result = await pickDirectory();
      if (result.cancelled || !result.path) return;

      const match = findProjectByRepoPath(projects, result.path);
      if (match) {
        pickProject(match.slug);
        return;
      }

      setBrowseError(`No project registered for:\n${result.path}\n\nAdd it via New project, or set repo path in Overview.`);
      setOpen(true);
    } catch {
      setBrowseError('Folder picker requires the ldc daemon. Run: ldc daemon');
      setOpen(true);
    } finally {
      setBrowsing(false);
    }
  }

  return (
    <div ref={containerRef} className="relative flex items-center gap-2">
      <button
        type="button"
        onClick={browseFolder}
        disabled={browsing}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-800 bg-slate-900 hover:border-slate-700 hover:bg-slate-800/80 transition-colors text-sm text-slate-300 shrink-0"
        title="Browse for a project folder on disk"
      >
        {browsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderOpen className="w-4 h-4" />}
        <span className="hidden sm:inline">Browse</span>
      </button>

      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 min-w-[200px] max-w-[320px] px-3 py-2 rounded-lg border border-slate-800 bg-slate-900 hover:border-slate-700 hover:bg-slate-800/80 transition-colors text-left"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {active ? (
          <>
            <FolderGit2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-sm font-medium text-slate-100 truncate flex-1">
              {active.name || active.slug}
            </span>
          </>
        ) : (
          <>
            <LayoutDashboard className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="text-sm font-medium text-slate-300 flex-1">All projects</span>
          </>
        )}
        <ChevronDown className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 w-[min(320px,calc(100vw-2rem))] z-50 rounded-lg border border-slate-700 bg-slate-900 shadow-xl shadow-black/40 overflow-hidden">
          <div className="p-2 border-b border-slate-800">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => { setQuery(e.target.value); setBrowseError(null); }}
                placeholder="Search projects…"
                className="w-full pl-8 pr-3 py-1.5 text-sm bg-slate-950 border border-slate-800 rounded text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            {browseError && (
              <p className="mt-2 text-[11px] text-amber-300/90 whitespace-pre-line leading-relaxed">{browseError}</p>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto py-1" role="listbox">
            <button
              type="button"
              onClick={pickDashboard}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${
                !activeSlug ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <LayoutDashboard className="w-4 h-4 shrink-0" />
              All projects
            </button>

            {filtered.length > 0 && (
              <div className="my-1 border-t border-slate-800" />
            )}

            {filtered.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => pickProject(p.slug)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${
                  activeSlug === p.slug
                    ? 'bg-emerald-500/10 text-emerald-200'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                }`}
              >
                <FolderGit2 className="w-4 h-4 shrink-0 text-slate-500" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.name || p.slug}</div>
                  {p.name && (
                    <div className="text-[11px] text-slate-600 font-mono truncate">{p.slug}</div>
                  )}
                </div>
              </button>
            ))}

            {filtered.length === 0 && (
              <div className="px-3 py-4 text-xs text-slate-500 text-center">No projects match</div>
            )}
          </div>

          <div className="p-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => { onNew(); close(); }}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New project
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
