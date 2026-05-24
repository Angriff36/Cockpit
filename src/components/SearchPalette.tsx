import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, FolderGit2, Terminal, Tag, CornerDownLeft } from 'lucide-react';
import type { Project, CommandProfile } from '../lib/types';
import { supabase } from '../lib/supabase';

type Props = {
  open: boolean;
  onClose: () => void;
  projects: Project[];
  onSelectProject: (slug: string) => void;
};

type SearchResult = {
  type: 'project' | 'command';
  project: Project;
  /** For command results, the matching command */
  command?: CommandProfile;
  /** Which field matched */
  matchField: string;
  /** The matched text snippet */
  matchText: string;
  /** Search score (lower = better) */
  score: number;
};

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

function scoreMatch(field: string, query: string, fieldPriority: number): number {
  const lower = field.toLowerCase();
  const q = query.toLowerCase();
  // Exact match
  if (lower === q) return fieldPriority;
  // Starts with
  if (lower.startsWith(q)) return fieldPriority + 1;
  // Word boundary match
  const words = lower.split(/[\s,_\-/]+/);
  if (words.some(w => w.startsWith(q))) return fieldPriority + 2;
  // Contains
  if (lower.includes(q)) return fieldPriority + 3;
  return -1;
}

function searchProjects(
  projects: Project[],
  commands: Map<string, CommandProfile[]>,
  query: string,
): SearchResult[] {
  if (!query.trim()) return [];

  const q = normalize(query);
  const results: SearchResult[] = [];

  for (const project of projects) {
    let bestScore = Infinity;
    let bestField = '';
    let bestText = '';

    // Search name (highest priority)
    const nameScore = scoreMatch(project.name || '', q, 0);
    if (nameScore >= 0 && nameScore < bestScore) {
      bestScore = nameScore;
      bestField = 'name';
      bestText = project.name;
    }

    // Search slug
    const slugScore = scoreMatch(project.slug, q, 10);
    if (slugScore >= 0 && slugScore < bestScore) {
      bestScore = slugScore;
      bestField = 'slug';
      bestText = project.slug;
    }

    // Search description
    if (project.description) {
      const descScore = scoreMatch(project.description, q, 20);
      if (descScore >= 0 && descScore < bestScore) {
        bestScore = descScore;
        bestField = 'description';
        bestText = project.description;
      }
    }

    // Search tags
    if (project.tags) {
      const tags = project.tags.split(',').map(t => t.trim()).filter(Boolean);
      for (const tag of tags) {
        const tagScore = scoreMatch(tag, q, 15);
        if (tagScore >= 0 && tagScore < bestScore) {
          bestScore = tagScore;
          bestField = 'tag';
          bestText = tag;
        }
      }
    }

    if (bestScore < Infinity) {
      results.push({
        type: 'project',
        project,
        matchField: bestField,
        matchText: bestText,
        score: bestScore,
      });
    }

    // Search commands for this project
    const projectCommands = commands.get(project.id) || [];
    for (const cmd of projectCommands) {
      const cmdNameScore = scoreMatch(cmd.name || '', q, 30);
      const cmdTextScore = scoreMatch(cmd.command || '', q, 35);
      const cmdScore = Math.min(
        cmdNameScore >= 0 ? cmdNameScore : Infinity,
        cmdTextScore >= 0 ? cmdTextScore : Infinity,
      );

      if (cmdScore < Infinity) {
        results.push({
          type: 'command',
          project,
          command: cmd,
          matchField: cmdNameScore >= 0 && cmdNameScore <= cmdTextScore ? 'command name' : 'command',
          matchText: cmdNameScore >= 0 && cmdNameScore <= cmdTextScore ? cmd.name : cmd.command,
          score: cmdScore,
        });
      }
    }
  }

  // Sort by score, then alphabetically by project name
  results.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return (a.project.name || a.project.slug).localeCompare(b.project.name || b.project.slug);
  });

  return results.slice(0, 20);
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;

  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return <>{text}</>;

  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length);

  return (
    <>
      {before}
      <span className="text-emerald-400 font-semibold">{match}</span>
      {after}
    </>
  );
}

export function SearchPalette({ open, onClose, projects, onSelectProject }: Props) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [commands, setCommands] = useState<Map<string, CommandProfile[]>>(new Map());
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Load commands for all projects on open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function loadCommands() {
      try {
        const { data } = await supabase.from('command_profiles').select('*');
        if (cancelled || !data) return;
        const map = new Map<string, CommandProfile[]>();
        for (const cmd of data as CommandProfile[]) {
          const existing = map.get(cmd.project_id) || [];
          existing.push(cmd);
          map.set(cmd.project_id, existing);
        }
        setCommands(map);
      } catch {
        // Silently ignore — search still works for projects
      }
    }

    loadCommands();
    return () => { cancelled = true; };
  }, [open]);

  const results = useMemo(
    () => searchProjects(projects, commands, query),
    [projects, commands, query],
  );

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      // Focus input after mount
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(0);
  }, [results.length, query]);

  // Scroll active item into view
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const activeEl = container.children[activeIndex] as HTMLElement | undefined;
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const handleSelect = useCallback((result: SearchResult) => {
    onSelectProject(result.project.slug);
    onClose();
  }, [onSelectProject, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex(i => Math.min(i + 1, results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (results[activeIndex]) handleSelect(results[activeIndex]);
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  }, [results, activeIndex, handleSelect, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Palette */}
      <div className="relative w-full max-w-xl mx-4 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl shadow-black/50 overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
          <Search className="w-4 h-4 text-slate-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search projects, tags, commands..."
            className="flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden sm:inline-flex items-center gap-0.5 text-[10px] text-slate-500 bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[360px] overflow-y-auto">
          {query.trim() === '' ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-slate-500">Type to search across all projects</p>
              <p className="text-xs text-slate-600 mt-1">
                Search by name, slug, description, tags, or commands
              </p>
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-slate-500">No results for "{query}"</p>
            </div>
          ) : (
            results.map((result, i) => (
              <button
                key={`${result.project.id}-${result.type}-${result.command?.id || ''}`}
                onClick={() => handleSelect(result)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  i === activeIndex
                    ? 'bg-emerald-500/10'
                    : 'hover:bg-slate-800/50'
                }`}
              >
                {/* Icon */}
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  result.type === 'command'
                    ? 'bg-violet-500/10 border border-violet-500/30'
                    : 'bg-slate-800 border border-slate-700'
                }`}>
                  {result.type === 'command'
                    ? <Terminal className="w-3.5 h-3.5 text-violet-400" />
                    : <FolderGit2 className="w-3.5 h-3.5 text-slate-400" />
                  }
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-100 truncate font-medium">
                      {result.type === 'command' ? (
                        <HighlightMatch
                          text={result.command?.name || result.command?.command || ''}
                          query={query}
                        />
                      ) : (
                        <HighlightMatch
                          text={result.project.name || result.project.slug}
                          query={query}
                        />
                      )}
                    </span>
                    {result.matchField === 'tag' && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-500 bg-slate-800 border border-slate-700/50 rounded px-1.5 py-0.5">
                        <Tag className="w-2.5 h-2.5" />
                        <HighlightMatch text={result.matchText} query={query} />
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {result.type === 'command' && (
                      <span className="text-[11px] text-slate-500 truncate">
                        in {result.project.name || result.project.slug}
                      </span>
                    )}
                    {result.type === 'project' && result.matchField === 'description' && (
                      <span className="text-[11px] text-slate-500 truncate">
                        <HighlightMatch text={result.matchText} query={query} />
                      </span>
                    )}
                    {result.type === 'project' && result.matchField === 'slug' && result.project.name && (
                      <span className="text-[11px] text-slate-500 font-mono truncate">
                        <HighlightMatch text={result.matchText} query={query} />
                      </span>
                    )}
                  </div>
                </div>

                {/* Right side */}
                {i === activeIndex && (
                  <div className="flex items-center gap-1 text-[10px] text-slate-500 shrink-0">
                    <CornerDownLeft className="w-3 h-3" />
                    <span>open</span>
                  </div>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        {results.length > 0 && (
          <div className="flex items-center gap-4 px-4 py-2 border-t border-slate-800 text-[10px] text-slate-600">
            <span className="flex items-center gap-1">
              <kbd className="bg-slate-800 border border-slate-700 rounded px-1 py-0.5 font-mono">↑↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="bg-slate-800 border border-slate-700 rounded px-1 py-0.5 font-mono">↵</kbd>
              open
            </span>
            <span className="flex items-center gap-1">
              <kbd className="bg-slate-800 border border-slate-700 rounded px-1 py-0.5 font-mono">esc</kbd>
              close
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
