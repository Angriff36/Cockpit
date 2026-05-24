import { useMemo } from 'react';
import { Terminal, LogOut, Shield, X } from 'lucide-react';
import type { Project } from '../lib/types';
import { supabase } from '../lib/supabase';
import { getTagColors } from '../lib/api';
import { GitHubStatus } from './GitHubStatus';
import { ProjectTabNav } from './ProjectTabNav';
import type { ProjectTabId } from './projectTabs';

type Props = {
  projects: Project[];
  activeSlug: string | null;
  activeTab: ProjectTabId;
  onTabChange: (tabId: ProjectTabId) => void;
  onDashboard: () => void;
  selectedTags: Set<string>;
  onToggleTag: (tag: string) => void;
  onClearTags: () => void;
  tagFilterMode: 'and' | 'or';
  onToggleFilterMode: () => void;
};

const TAG_COLOR_OPTIONS = [
  { name: 'Slate', bg: 'bg-slate-700/50', text: 'text-slate-300', border: 'border-slate-600/40' },
  { name: 'Red', bg: 'bg-rose-500/10', text: 'text-rose-300', border: 'border-rose-500/30' },
  { name: 'Orange', bg: 'bg-orange-500/10', text: 'text-orange-300', border: 'border-orange-500/30' },
  { name: 'Amber', bg: 'bg-amber-500/10', text: 'text-amber-300', border: 'border-amber-500/30' },
  { name: 'Yellow', bg: 'bg-yellow-500/10', text: 'text-yellow-300', border: 'border-yellow-500/30' },
  { name: 'Lime', bg: 'bg-lime-500/10', text: 'text-lime-300', border: 'border-lime-500/30' },
  { name: 'Green', bg: 'bg-emerald-500/10', text: 'text-emerald-300', border: 'border-emerald-500/30' },
  { name: 'Cyan', bg: 'bg-cyan-500/10', text: 'text-cyan-300', border: 'border-cyan-500/30' },
  { name: 'Blue', bg: 'bg-blue-500/10', text: 'text-blue-300', border: 'border-blue-500/30' },
  { name: 'Violet', bg: 'bg-violet-500/10', text: 'text-violet-300', border: 'border-violet-500/30' },
  { name: 'Purple', bg: 'bg-purple-500/10', text: 'text-purple-300', border: 'border-purple-500/30' },
  { name: 'Pink', bg: 'bg-pink-500/10', text: 'text-pink-300', border: 'border-pink-500/30' },
];

const DEFAULT_COLOR = TAG_COLOR_OPTIONS[0];

function getColorForTag(tagName: string, colors: Record<string, string>) {
  const colorName = colors[tagName];
  return TAG_COLOR_OPTIONS.find(c => c.name === colorName) || DEFAULT_COLOR;
}

export function Sidebar({
  projects, activeSlug, activeTab, onTabChange, onDashboard,
  selectedTags, onToggleTag, onClearTags, tagFilterMode, onToggleFilterMode,
}: Props) {
  const activeProjects = useMemo(() => projects.filter(p => p.status !== 'archived'), [projects]);
  const inProject = activeSlug !== null;

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const p of activeProjects) {
      if (p.tags) {
        for (const t of p.tags.split(',')) {
          const trimmed = t.trim();
          if (trimmed) tagSet.add(trimmed);
        }
      }
    }
    return [...tagSet].sort();
  }, [activeProjects]);

  const tagColors = useMemo(() => getTagColors(), [allTags.length]);
  const hasTags = allTags.length > 0;
  const hasSelected = selectedTags.size > 0;

  return (
    <aside className="w-56 bg-slate-950 border-r border-slate-800 flex flex-col shrink-0">
      <button
        type="button"
        onClick={onDashboard}
        className="p-4 border-b border-slate-800 text-left hover:bg-slate-900/50 transition-colors group"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center group-hover:bg-emerald-500/20 transition-colors">
            <Terminal className="w-4.5 h-4.5 text-emerald-400" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-100">Local Dev Cockpit</div>
            <div className="text-[10px] text-slate-500 flex items-center gap-1">
              <Shield className="w-3 h-3" /> 127.0.0.1 mode
            </div>
          </div>
        </div>
      </button>

      {inProject ? (
        <ProjectTabNav activeTab={activeTab} onTabChange={onTabChange} />
      ) : (
        <div className="flex-1 px-4 py-6">
          <p className="text-xs text-slate-500 leading-relaxed">
            Pick a project from the dropdown above, or browse all projects on the dashboard.
          </p>
        </div>
      )}

      {!inProject && hasTags && (
        <div className="px-3 pb-2 shrink-0">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
              Filter by tag
            </div>
            {hasSelected && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onToggleFilterMode}
                  className="text-[10px] text-slate-500 hover:text-slate-300 font-mono transition-colors"
                  title={tagFilterMode === 'and' ? 'Switch to OR (match any tag)' : 'Switch to AND (match all tags)'}
                >
                  {tagFilterMode.toUpperCase()}
                </button>
                <button
                  type="button"
                  onClick={onClearTags}
                  className="text-slate-600 hover:text-slate-300 transition-colors"
                  title="Clear tag filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {allTags.map(tag => {
              const isActive = selectedTags.has(tag);
              const color = getColorForTag(tag, tagColors);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onToggleTag(tag)}
                  className={`text-[10px] font-medium px-1.5 py-0.5 rounded border transition-colors ${
                    isActive
                      ? `${color.bg} ${color.text} ${color.border}`
                      : 'bg-transparent text-slate-600 border border-slate-800 hover:text-slate-400 hover:border-slate-700'
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-auto p-3 border-t border-slate-800 space-y-1 shrink-0">
        <GitHubStatus />
        <button
          type="button"
          onClick={() => supabase.auth.signOut()}
          className="w-full flex items-center gap-2 text-slate-500 hover:text-slate-300 text-xs px-2 py-1.5"
        >
          <LogOut className="w-3.5 h-3.5" /> Sign out
        </button>
      </div>
    </aside>
  );
}
