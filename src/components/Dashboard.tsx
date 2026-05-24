import { useState, useEffect } from 'react';
import { Plus, ExternalLink, FolderGit2, GitBranch, Package, ArrowRight, Terminal, Loader2, LayoutGrid, List, CheckCircle2, XCircle, CircleDot, Archive, RotateCcw, Layers, Activity, Globe, Rocket, Download, Tag, Trash2, X, CheckSquare, Copy, Pin, Columns3, GripVertical, Edit3, Save, ChevronDown, ChevronRight } from 'lucide-react';
import type { Project, GitHubWorkflowRun, LayoutSection, LayoutCardSize } from '../lib/types';
import { launchProject } from '../lib/daemon';
import type { DaemonProcess } from '../lib/daemon';
import type { DashboardMetrics } from '../lib/api';
import { useGitHubWorkflows } from '../lib/useGitHubWorkflows';
import { getActionsUrl } from '../lib/github';
import { ExternalHref } from './ExternalLink';
import { StaleIndicator, Checkbox, Modal, Button } from './ui';
import { PortConflictPanel } from './PortConflictPanel';
import { TagManagementPanel } from './TagManagementPanel';
import { useDashboardState } from './useDashboardState';

type MetricFilter = 'all' | 'running' | 'ports' | 'deploying';
type BulkAction = 'archive' | 'delete' | 'tag' | 'export';

const PLATFORM_LABEL: Record<string, string> = {
  vercel: 'Vercel', render: 'Render', fly: 'Fly.io', railway: 'Railway',
  supabase: 'Supabase', 'self-hosted': 'Self-hosted', vps: 'VPS', custom: 'Custom',
};

const PLATFORM_COLOR: Record<string, string> = {
  vercel: 'text-slate-200 bg-slate-700/50 border-slate-600/40',
  render: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  fly: 'text-violet-300 bg-violet-500/10 border-violet-500/30',
  railway: 'text-purple-300 bg-purple-500/10 border-purple-500/30',
  supabase: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
};

const STATUS_COLOR: Record<string, string> = {
  active: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  archived: 'text-slate-500 bg-slate-700/30 border-slate-600/30',
  paused: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
};

function ciIcon(run: GitHubWorkflowRun) {
  if (run.status !== 'completed') return <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />;
  switch (run.conclusion) {
    case 'success': return <CheckCircle2 className="w-3 h-3 text-emerald-400" />;
    case 'failure': return <XCircle className="w-3 h-3 text-rose-400" />;
    default: return <CircleDot className="w-3 h-3 text-slate-500" />;
  }
}

function CIIndicator({ repoUrl }: { repoUrl: string }) {
  const { runs, error } = useGitHubWorkflows(repoUrl);
  if (!repoUrl.includes('github.com')) return null;
  if (error && runs.length === 0) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-slate-600" title="GitHub API error — check token">
        <CircleDot className="w-3 h-3" /> CI unavailable
      </span>
    );
  }
  if (runs.length === 0) return null;
  // Show worst status across all workflows
  const hasFailure = runs.some(r => r.conclusion === 'failure');
  const hasRunning = runs.some(r => r.status !== 'completed');
  const representative = hasFailure
    ? runs.find(r => r.conclusion === 'failure')!
    : hasRunning
      ? runs.find(r => r.status !== 'completed')!
      : runs[0];
  const label = representative.status !== 'completed'
    ? 'CI running'
    : representative.conclusion === 'success'
      ? 'CI passing'
      : representative.conclusion === 'failure'
        ? 'CI failing'
        : 'CI';
  const ciHref = representative.html_url || getActionsUrl(repoUrl) || repoUrl;

  return (
    <ExternalHref href={ciHref} className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300" title={label}>
      {ciIcon(representative)} {label}
    </ExternalHref>
  );
}

function MetricChip({
  icon, label, count, active, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3.5 py-2 rounded-lg border text-sm transition-colors ${
        active
          ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
          : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-300'
      }`}
    >
      {icon}
      <span className="font-semibold tabular-nums">{count}</span>
      <span className="text-xs hidden sm:inline">{label}</span>
    </button>
  );
}

function MetricsSummaryBar({
  projects,
  runningProcesses,
  metrics,
  activeFilter,
  onFilter,
}: {
  projects: Project[];
  runningProcesses: DaemonProcess[];
  metrics: DashboardMetrics | null;
  activeFilter: MetricFilter;
  onFilter: (filter: MetricFilter) => void;
}) {
  const totalProjects = projects.length;
  const runningCount = runningProcesses.filter(p => p.running).length;
  const portsCount = metrics ? metrics.projectsWithPorts.size : 0;
  const deployingCount = metrics ? metrics.projectsWithPendingDeploys.size : 0;

  function toggle(filter: MetricFilter) {
    onFilter(activeFilter === filter ? 'all' : filter);
  }

  return (
    <div className="flex flex-wrap gap-2">
      <MetricChip
        icon={<Layers className="w-3.5 h-3.5" />}
        label="Projects"
        count={totalProjects}
        active={activeFilter === 'all'}
        onClick={() => onFilter('all')}
      />
      <MetricChip
        icon={<Activity className="w-3.5 h-3.5" />}
        label="Running"
        count={runningCount}
        active={activeFilter === 'running'}
        onClick={() => toggle('running')}
      />
      <MetricChip
        icon={<Globe className="w-3.5 h-3.5" />}
        label="Active Ports"
        count={portsCount}
        active={activeFilter === 'ports'}
        onClick={() => toggle('ports')}
      />
      <MetricChip
        icon={<Rocket className="w-3.5 h-3.5" />}
        label="Deploying"
        count={deployingCount}
        active={activeFilter === 'deploying'}
        onClick={() => toggle('deploying')}
      />
    </div>
  );
}

function ProjectCard({
  project, onOpen, onClone, onPin, daemonOnline, overridePath, selectMode, selected, onToggleSelect, onLaunched,
}: {
  project: Project;
  onOpen: () => void;
  onClone: () => void;
  onPin: () => void;
  daemonOnline: boolean;
  overridePath?: string;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onLaunched?: () => void;
}) {
  const [launching, setLaunching] = useState(false);
  const platformStyle = PLATFORM_COLOR[project.hosting_platform] || 'text-slate-400 bg-slate-700/30 border-slate-600/30';
  const statusStyle = STATUS_COLOR[project.status] || 'text-slate-400 bg-slate-700/30 border-slate-600/30';
  const tags = project.tags ? project.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  const effectivePath = overridePath || project.repo_path;

  async function launch(e: React.MouseEvent) {
    e.stopPropagation();
    if (!effectivePath || launching) return;
    setLaunching(true);
    try {
      const result = await launchProject(effectivePath, project.slug);
      if (!result.command) {
        alert(`No dev command detected for ${project.name || project.slug} — configure one in the Commands tab.`);
      } else if (!result.already) {
        onLaunched?.();
      }
    } catch (err: any) {
      alert(`Launch failed: ${err.message}`);
    } finally {
      setLaunching(false);
    }
  }

  function handleClick() {
    if (selectMode) {
      onToggleSelect();
    } else {
      onOpen();
    }
  }

  return (
    <div
      onClick={handleClick}
      className={`bg-slate-900 border rounded-lg p-5 flex flex-col gap-3 transition-colors group cursor-pointer ${
        selected
          ? 'border-emerald-500/60 ring-1 ring-emerald-500/20'
          : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex items-start gap-2">
          {selectMode && (
            <Checkbox checked={selected} onChange={onToggleSelect} className="mt-0.5" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <FolderGit2 className="w-4 h-4 text-slate-500 shrink-0" />
              <h3 className="text-sm font-semibold text-slate-100 truncate">{project.name || project.slug}</h3>
              {project.pinned && <Pin className="w-3 h-3 text-amber-400 shrink-0" />}
            </div>
            <span className="text-[11px] text-slate-500 font-mono">{project.slug}</span>
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {project.status && (
            <span className={`text-[10px] font-semibold uppercase tracking-wider border rounded px-1.5 py-0.5 ${statusStyle}`}>
              {project.status}
            </span>
          )}
          {project.hosting_platform && (
            <span className={`text-[10px] font-semibold uppercase tracking-wider border rounded px-1.5 py-0.5 ${platformStyle}`}>
              {PLATFORM_LABEL[project.hosting_platform] || project.hosting_platform}
            </span>
          )}
        </div>
      </div>

      {/* Description */}
      {project.description && (
        <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">{project.description}</p>
      )}

      {/* Meta row */}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {project.package_manager && (
          <span className="flex items-center gap-1 text-[11px] text-slate-500">
            <Package className="w-3 h-3" />{project.package_manager}
          </span>
        )}
        {project.default_branch && (
          <span className="flex items-center gap-1 text-[11px] text-slate-500">
            <GitBranch className="w-3 h-3" />{project.default_branch}
          </span>
        )}
        {effectivePath && (
          <span className="text-[11px] text-slate-600 font-mono truncate max-w-[180px]" title={effectivePath}>
            {effectivePath.replace(/\\/g, '/').split('/').slice(-2).join('/')}
          </span>
        )}
        {project.repo_url && <CIIndicator repoUrl={project.repo_url} />}
      </div>

      {/* Tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 4).map(tag => (
            <span key={tag} className="text-[10px] text-slate-500 bg-slate-800 border border-slate-700/50 rounded px-1.5 py-0.5">{tag}</span>
          ))}
          {tags.length > 4 && <span className="text-[10px] text-slate-600">+{tags.length - 4}</span>}
        </div>
      )}

      {/* Footer actions */}
      {!selectMode && (
        <div className="flex items-center justify-between pt-1 mt-auto border-t border-slate-800">
          <div className="flex gap-2 items-center">
            {project.repo_url && (
              <a
                href={project.repo_url}
                target="_blank"
                rel="noreferrer"
                onClick={e => e.stopPropagation()}
                className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
              >
                <ExternalLink className="w-3 h-3" /> Repo
              </a>
            )}
            {daemonOnline && effectivePath && (
              <button
                onClick={launch}
                disabled={launching}
                title="Open terminal and run dev command"
                className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
              >
                {launching
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <Terminal className="w-3 h-3" />}
                Launch
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onClone(); }}
              title="Clone project configuration"
              className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
            >
              <Copy className="w-3 h-3" /> Clone
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onPin(); }}
              title={project.pinned ? 'Unpin project' : 'Pin to top'}
              className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded transition-colors ${
                project.pinned
                  ? 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Pin className="w-3 h-3" /> {project.pinned ? 'Unpin' : 'Pin'}
            </button>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-emerald-400 font-medium transition-colors group-hover:text-slate-300"
          >
            Open <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function NewProjectCard({ onNew }: { onNew: () => void }) {
  return (
    <button
      onClick={onNew}
      className="bg-slate-900/50 border border-dashed border-slate-700 rounded-lg p-5 flex flex-col items-center justify-center gap-2 text-slate-500 hover:border-emerald-500/40 hover:text-emerald-400 hover:bg-emerald-500/5 transition-colors min-h-[160px]"
    >
      <Plus className="w-6 h-6" />
      <span className="text-sm font-medium">New project</span>
    </button>
  );
}

function ProjectListRow({
  project, onOpen, onClone, onPin, daemonOnline, overridePath, selectMode, selected, onToggleSelect, onLaunched,
}: {
  project: Project;
  onOpen: () => void;
  onClone: () => void;
  onPin: () => void;
  daemonOnline: boolean;
  overridePath?: string;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onLaunched?: () => void;
}) {
  const [launching, setLaunching] = useState(false);
  const statusStyle = STATUS_COLOR[project.status] || 'text-slate-400 bg-slate-700/30 border-slate-600/30';
  const platformStyle = PLATFORM_COLOR[project.hosting_platform] || 'text-slate-400 bg-slate-700/30 border-slate-600/30';
  const effectivePath = overridePath || project.repo_path;

  async function launch(e: React.MouseEvent) {
    e.stopPropagation();
    if (!effectivePath || launching) return;
    setLaunching(true);
    try {
      const result = await launchProject(effectivePath, project.slug);
      if (!result.command) {
        alert(`No dev command detected for ${project.name || project.slug} — configure one in the Commands tab.`);
      } else if (!result.already) {
        onLaunched?.();
      }
    } catch (err: any) {
      alert(`Launch failed: ${err.message}`);
    } finally {
      setLaunching(false);
    }
  }

  const updatedAt = project.updated_at
    ? new Date(project.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null;

  function handleClick() {
    if (selectMode) {
      onToggleSelect();
    } else {
      onOpen();
    }
  }

  return (
    <div
      onClick={handleClick}
      className={`flex items-center gap-4 px-4 py-2.5 transition-colors cursor-pointer group border-b border-slate-800/60 last:border-b-0 ${
        selected ? 'bg-emerald-500/5' : 'hover:bg-slate-800/50'
      }`}
    >
      {/* Checkbox */}
      {selectMode && (
        <Checkbox checked={selected} onChange={onToggleSelect} />
      )}

      {/* Name + slug */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <FolderGit2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          {project.pinned && <Pin className="w-3 h-3 text-amber-400 shrink-0" />}
          <span className="text-sm font-medium text-slate-100 truncate">{project.name || project.slug}</span>
          <span className="text-[11px] text-slate-600 font-mono hidden sm:inline">{project.slug}</span>
        </div>
      </div>

      {/* Status badge */}
      <div className="w-20 shrink-0 hidden md:block">
        {project.status && (
          <span className={`text-[10px] font-semibold uppercase tracking-wider border rounded px-1.5 py-0.5 ${statusStyle}`}>
            {project.status}
          </span>
        )}
      </div>

      {/* Platform */}
      <div className="w-20 shrink-0 hidden lg:block">
        {project.hosting_platform && (
          <span className={`text-[10px] font-semibold uppercase tracking-wider border rounded px-1.5 py-0.5 ${platformStyle}`}>
            {PLATFORM_LABEL[project.hosting_platform] || project.hosting_platform}
          </span>
        )}
      </div>

      {/* Branch */}
      <div className="w-20 shrink-0 hidden lg:block">
        {project.default_branch && (
          <span className="flex items-center gap-1 text-[11px] text-slate-500">
            <GitBranch className="w-3 h-3" />{project.default_branch}
          </span>
        )}
      </div>

      {/* CI Status */}
      <div className="w-24 shrink-0 hidden lg:block">
        {project.repo_url && <CIIndicator repoUrl={project.repo_url} />}
      </div>

      {/* Last updated */}
      <div className="w-16 shrink-0 text-right hidden sm:block">
        {updatedAt && <span className="text-[11px] text-slate-500">{updatedAt}</span>}
      </div>

      {/* Actions */}
      {!selectMode && (
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onPin(); }}
            title={project.pinned ? 'Unpin project' : 'Pin to top'}
            className={`transition-colors ${project.pinned ? 'text-amber-400 hover:text-amber-300' : 'text-slate-600 hover:text-slate-300'}`}
          >
            <Pin className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onClone(); }}
            title="Clone project"
            className="text-slate-600 hover:text-slate-300 transition-colors"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          {project.repo_url && (
            <a
              href={project.repo_url}
              target="_blank"
              rel="noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-slate-600 hover:text-slate-300 transition-colors"
              title="Open repo"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          {daemonOnline && effectivePath && (
            <button
              onClick={launch}
              disabled={launching}
              title="Launch"
              className="text-slate-600 hover:text-emerald-400 transition-colors disabled:opacity-50"
            >
              {launching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Terminal className="w-3.5 h-3.5" />}
            </button>
          )}
          <ArrowRight className="w-3.5 h-3.5 text-slate-700 group-hover:text-slate-400 transition-colors" />
        </div>
      )}
    </div>
  );
}

// ── Selection Toolbar ────────────────────────────────────────────────────────

function SelectionToolbar({
  count, total, showArchived, onSelectAll, onDeselectAll, onAction, onCancel,
}: {
  count: number;
  total: number;
  showArchived: boolean;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onAction: (action: BulkAction) => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-5 py-3 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl shadow-black/40">
      <span className="text-sm text-slate-200 font-medium tabular-nums">
        {count} of {total} selected
      </span>
      <div className="w-px h-5 bg-slate-700" />
      <button
        onClick={count < total ? onSelectAll : onDeselectAll}
        className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
      >
        {count < total ? 'Select all' : 'Deselect all'}
      </button>
      <div className="w-px h-5 bg-slate-700" />
      <div className="flex items-center gap-1.5">
        {!showArchived && (
          <button
            onClick={() => onAction('archive')}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
            title="Archive selected"
          >
            <Archive className="w-3.5 h-3.5" /> Archive
          </button>
        )}
        <button
          onClick={() => onAction('tag')}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
          title="Tag selected"
        >
          <Tag className="w-3.5 h-3.5" /> Tag
        </button>
        <button
          onClick={() => onAction('export')}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
          title="Export selected"
        >
          <Download className="w-3.5 h-3.5" /> Export
        </button>
        {showArchived && (
          <button
            onClick={() => onAction('delete')}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 transition-colors"
            title="Delete selected permanently"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        )}
      </div>
      <div className="w-px h-5 bg-slate-700" />
      <button
        onClick={onCancel}
        className="text-slate-500 hover:text-slate-300 transition-colors p-1"
        title="Exit select mode"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

// ── Bulk Confirmation Dialog ─────────────────────────────────────────────────

function BulkConfirmDialog({
  action, projects, open, onClose, onConfirm, busy,
}: {
  action: BulkAction;
  projects: Project[];
  open: boolean;
  onClose: () => void;
  onConfirm: (tags?: string) => void;
  busy: boolean;
}) {
  const [tagInput, setTagInput] = useState('');

  const titles: Record<BulkAction, string> = {
    archive: `Archive ${projects.length} project${projects.length !== 1 ? 's' : ''}`,
    delete: `Permanently delete ${projects.length} project${projects.length !== 1 ? 's' : ''}`,
    tag: `Tag ${projects.length} project${projects.length !== 1 ? 's' : ''}`,
    export: `Export ${projects.length} project${projects.length !== 1 ? 's' : ''}`,
  };

  const descriptions: Record<BulkAction, string> = {
    archive: 'These projects will be moved to the archive. You can restore them later.',
    delete: 'This action is permanent and cannot be undone. All project data will be destroyed.',
    tag: 'Tags will be added to the selected projects. Existing tags are preserved.',
    export: 'Project metadata will be downloaded as a JSON file.',
  };

  function handleConfirm() {
    if (action === 'tag') {
      if (!tagInput.trim()) return;
      onConfirm(tagInput.trim());
    } else {
      onConfirm();
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={titles[action]}>
      <div className="space-y-4">
        <p className="text-sm text-slate-400">{descriptions[action]}</p>

        {/* Affected projects list */}
        <div className="max-h-48 overflow-y-auto rounded border border-slate-800 bg-slate-950">
          {projects.map(p => (
            <div key={p.id} className="flex items-center gap-2 px-3 py-2 border-b border-slate-800/50 last:border-b-0">
              <FolderGit2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span className="text-sm text-slate-200 truncate">{p.name || p.slug}</span>
              <span className="text-[11px] text-slate-600 font-mono ml-auto shrink-0">{p.slug}</span>
            </div>
          ))}
        </div>

        {/* Tag input */}
        {action === 'tag' && (
          <div>
            <label className="block text-[11px] uppercase tracking-wider font-medium text-slate-500 mb-1.5">
              Tags (comma-separated)
            </label>
            <input
              type="text"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              placeholder="e.g. frontend, v2, priority"
              className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 text-sm placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
              onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); }}
              autoFocus
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant={action === 'delete' ? 'danger' : 'primary'}
            onClick={handleConfirm}
            disabled={busy || (action === 'tag' && !tagInput.trim())}
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5 inline" /> : null}
            {action === 'archive' && 'Archive'}
            {action === 'delete' && 'Delete permanently'}
            {action === 'tag' && 'Add tags'}
            {action === 'export' && 'Download'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Layout View ─────────────────────────────────────────────────────────────

const CARD_SIZE_GRID: Record<LayoutCardSize, string> = {
  small: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5',
  medium: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
  large: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
};

function LayoutProjectCard({
  project, onOpen, onClone, onPin, daemonOnline, overridePath, cardSize,
  onDragStart, onDragEnd, onLaunched,
}: {
  project: Project;
  onOpen: () => void;
  onClone: () => void;
  onPin: () => void;
  daemonOnline: boolean;
  overridePath?: string;
  cardSize: LayoutCardSize;
  onDragStart: () => void;
  onDragEnd: () => void;
  onLaunched?: () => void;
}) {
  const [launching, setLaunching] = useState(false);
  const platformStyle = PLATFORM_COLOR[project.hosting_platform] || 'text-slate-400 bg-slate-700/30 border-slate-600/30';
  const statusStyle = STATUS_COLOR[project.status] || 'text-slate-400 bg-slate-700/30 border-slate-600/30';
  const effectivePath = overridePath || project.repo_path;

  async function launch(e: React.MouseEvent) {
    e.stopPropagation();
    if (!effectivePath || launching) return;
    setLaunching(true);
    try {
      const result = await launchProject(effectivePath, project.slug);
      if (!result.command) {
        alert(`No dev command detected for ${project.name || project.slug} — configure one in the Commands tab.`);
      } else if (!result.already) {
        onLaunched?.();
      }
    } catch (err: any) {
      alert(`Launch failed: ${err.message}`);
    } finally {
      setLaunching(false);
    }
  }

  const isCompact = cardSize === 'small';

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg transition-colors group cursor-grab active:cursor-grabbing ${
        isCompact ? 'p-3' : 'p-5'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex items-start gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <FolderGit2 className="w-4 h-4 text-slate-500 shrink-0" />
              <h3 className={`font-semibold text-slate-100 truncate ${isCompact ? 'text-xs' : 'text-sm'}`}>{project.name || project.slug}</h3>
              {project.pinned && <Pin className="w-3 h-3 text-amber-400 shrink-0" />}
            </div>
            {!isCompact && <span className="text-[11px] text-slate-500 font-mono">{project.slug}</span>}
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          {project.status && (
            <span className={`text-[10px] font-semibold uppercase tracking-wider border rounded px-1.5 py-0.5 ${statusStyle}`}>
              {project.status}
            </span>
          )}
          {project.hosting_platform && !isCompact && (
            <span className={`text-[10px] font-semibold uppercase tracking-wider border rounded px-1.5 py-0.5 ${platformStyle}`}>
              {PLATFORM_LABEL[project.hosting_platform] || project.hosting_platform}
            </span>
          )}
        </div>
      </div>

      {!isCompact && project.description && (
        <p className="text-xs text-slate-400 leading-relaxed line-clamp-2 mt-2">{project.description}</p>
      )}

      <div className={`flex items-center justify-between ${isCompact ? 'mt-2' : 'mt-3 pt-2 border-t border-slate-800'}`}>
        <div className="flex gap-2 items-center">
          <button
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-emerald-400 font-medium transition-colors"
          >
            Open <ArrowRight className="w-3 h-3" />
          </button>
          {daemonOnline && effectivePath && !isCompact && (
            <button onClick={launch} disabled={launching} className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50">
              {launching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Terminal className="w-3 h-3" />}
              Launch
            </button>
          )}
        </div>
        {!isCompact && (
          <div className="flex gap-1">
            <button onClick={(e) => { e.stopPropagation(); onPin(); }} className={`transition-colors ${project.pinned ? 'text-amber-400 hover:text-amber-300' : 'text-slate-600 hover:text-slate-300'}`}>
              <Pin className="w-3 h-3" />
            </button>
            <button onClick={(e) => { e.stopPropagation(); onClone(); }} className="text-slate-600 hover:text-slate-300 transition-colors">
              <Copy className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function LayoutSectionView({
  section, projects, onOpen, onClone, onPin, daemonOnline, getOverridePath,
  editing, onRename, onDelete, onToggleCollapse, onChangeCardSize,
  onDragOver, onDrop, onDragStart, onDragEnd, onLaunched,
}: {
  section: LayoutSection;
  projects: Project[];
  onOpen: (slug: string) => void;
  onClone: (project: Project) => void;
  onPin: (project: Project) => void;
  daemonOnline: boolean;
  getOverridePath: (id: string) => string | undefined;
  editing: boolean;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onLaunched?: () => void;
  onChangeCardSize: (id: string, size: LayoutCardSize) => void;
  onDragOver: (e: React.DragEvent, sectionId: string, index?: number) => void;
  onDrop: (e: React.DragEvent, sectionId: string, index?: number) => void;
  onDragStart: (projectId: string, sectionId: string) => void;
  onDragEnd: () => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(section.name);

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
    onDragOver(e, section.id);
  }

  function handleDragLeave() {
    setIsDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    onDrop(e, section.id);
  }

  function handleCardDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    e.stopPropagation();
    onDragOver(e, section.id, index);
  }

  function handleCardDrop(e: React.DragEvent, index: number) {
    e.preventDefault();
    e.stopPropagation();
    onDrop(e, section.id, index);
  }

  function submitRename() {
    if (renameValue.trim()) {
      onRename(section.id, renameValue.trim());
    }
    setIsRenaming(false);
  }

  return (
    <div
      className={`rounded-lg border transition-colors ${
        isDragOver
          ? 'border-emerald-500/60 bg-emerald-500/5'
          : 'border-slate-800 bg-slate-900/30'
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Section header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800/50">
        <button onClick={() => onToggleCollapse(section.id)} className="text-slate-500 hover:text-slate-300 transition-colors">
          {section.collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        <GripVertical className="w-4 h-4 text-slate-700" />
        {isRenaming ? (
          <input
            type="text"
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onBlur={submitRename}
            onKeyDown={e => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') setIsRenaming(false); }}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
            autoFocus
          />
        ) : (
          <h3
            className="text-sm font-semibold text-slate-200 flex-1"
            onDoubleClick={() => { if (editing) { setRenameValue(section.name); setIsRenaming(true); } }}
          >
            {section.name}
          </h3>
        )}
        <span className="text-[10px] text-slate-600 tabular-nums">{projects.length} project{projects.length !== 1 ? 's' : ''}</span>
        {editing && (
          <div className="flex items-center gap-1">
            {/* Card size selector */}
            {(['small', 'medium', 'large'] as LayoutCardSize[]).map(size => (
              <button
                key={size}
                onClick={() => onChangeCardSize(section.id, size)}
                className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                  section.card_size === size
                    ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                    : 'border-slate-700 text-slate-500 hover:text-slate-300'
                }`}
                title={`${size} cards`}
              >
                {size[0].toUpperCase()}
              </button>
            ))}
            <button
              onClick={() => { setRenameValue(section.name); setIsRenaming(true); }}
              className="text-slate-500 hover:text-slate-300 transition-colors p-0.5"
              title="Rename section"
            >
              <Edit3 className="w-3 h-3" />
            </button>
            <button
              onClick={() => onDelete(section.id)}
              className="text-slate-500 hover:text-rose-400 transition-colors p-0.5"
              title="Delete section"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Cards */}
      {!section.collapsed && (
        <div className={`grid gap-3 p-4 ${CARD_SIZE_GRID[section.card_size]}`}>
          {projects.map((p, idx) => (
            <div
              key={p.id}
              onDragOver={e => handleCardDragOver(e, idx)}
              onDrop={e => handleCardDrop(e, idx)}
            >
              <LayoutProjectCard
                project={p}
                onOpen={() => onOpen(p.slug)}
                onClone={() => onClone(p)}
                onPin={() => onPin(p)}
                daemonOnline={daemonOnline}
                overridePath={getOverridePath(p.id)}
                cardSize={section.card_size}
                onDragStart={() => onDragStart(p.id, section.id)}
                onDragEnd={onDragEnd}
                onLaunched={onLaunched}
              />
            </div>
          ))}
          {projects.length === 0 && (
            <div className="col-span-full py-8 text-center text-sm text-slate-500 border border-dashed border-slate-700 rounded-lg">
              {isDragOver ? 'Drop here' : 'Drag projects into this section'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NewSectionCard({ onAdd }: { onAdd: () => void }) {
  return (
    <button
      onClick={onAdd}
      className="w-full py-4 border border-dashed border-slate-700 rounded-lg text-slate-500 hover:border-emerald-500/40 hover:text-emerald-400 hover:bg-emerald-500/5 transition-colors flex items-center justify-center gap-2"
    >
      <Plus className="w-4 h-4" />
      <span className="text-sm font-medium">Add section</span>
    </button>
  );
}

function SectionNameDialog({
  open, onClose, onConfirm, initialValue,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (name: string) => void;
  initialValue: string;
}) {
  const [name, setName] = useState(initialValue);

  useEffect(() => {
    setName(initialValue);
  }, [initialValue, open]);

  return (
    <Modal open={open} onClose={onClose} title="New Section" width="max-w-sm">
      <div className="space-y-4">
        <div>
          <label className="block text-[11px] uppercase tracking-wider font-medium text-slate-500 mb-1.5">
            Section name
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Client Work, Personal"
            className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 text-sm placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
            onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onConfirm(name.trim()); }}
            autoFocus
          />
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => { if (name.trim()) onConfirm(name.trim()); }} disabled={!name.trim()}>
            Create
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Main Dashboard ───────────────────────────────────────────────────────────

type Props = {
  projects: Project[];
  onSelect: (slug: string) => void;
  onNew: () => void;
  onClone: (project: Project) => void;
  onReload: () => void;
  cachedAt?: number | null;
  selectedTags?: Set<string>;
  tagFilterMode?: 'and' | 'or';
};

export function Dashboard({ projects, onSelect, onNew, onClone, onReload, cachedAt, selectedTags, tagFilterMode }: Props) {
  const {
    daemonOnline, online,
    viewMode, switchView,
    showArchived, setShowArchived,
    activeFilter, setActiveFilter,
    runningProcesses, metrics,
    activeProjects, archivedProjects,
    filteredProjects, pinnedProjects, unpinnedProjects,
    selectMode, selectedIds, selectedProjects,
    bulkAction, bulkBusy, showTagPanel, setShowTagPanel,
    layoutSections, layoutEditing, setLayoutEditing,
    layoutDirty, layoutSaving, layoutReady,
    showNewSection, setShowNewSection,
    conflicts, conflictsLoading, refreshConflicts,
    refreshProcesses,
    getOverridePath,
    toggleSelect, enterSelectMode, exitSelectMode, selectAll, deselectAll,
    openBulkAction, executeBulkAction, setBulkAction,
    handlePin, handleRestore,
    initDefaultLayout, saveLayoutToSupabase,
    addSection, renameSection, deleteSection,
    toggleSectionCollapse, changeSectionCardSize,
    handleLayoutDragStart, handleLayoutDragEnd,
    handleLayoutDragOver, handleLayoutDrop,
  } = useDashboardState({ projects, onReload, selectedTags, tagFilterMode });

  const effectiveSelectedTags = selectedTags ?? new Set<string>();
  const effectiveTagMode = tagFilterMode ?? 'or';

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="px-8 py-6 border-b border-slate-800 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-slate-100">Projects</h1>
            {cachedAt && <StaleIndicator cachedAt={cachedAt} />}
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            {activeProjects.length} active{archivedProjects.length > 0 ? `, ${archivedProjects.length} archived` : ''}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {/* Select mode toggle */}
          {online && filteredProjects.length > 0 && (
            <button
              onClick={selectMode ? exitSelectMode : enterSelectMode}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded transition-colors ${
                selectMode
                  ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/40'
                  : 'text-slate-500 hover:text-slate-300 border border-transparent hover:border-slate-700'
              }`}
              title={selectMode ? 'Exit select mode' : 'Select multiple projects'}
            >
              <CheckSquare className="w-3.5 h-3.5" />
              {selectMode ? 'Selecting' : 'Select'}
            </button>
          )}
          {archivedProjects.length > 0 && (
            <button
              onClick={() => { setShowArchived(!showArchived); setActiveFilter('all'); exitSelectMode(); }}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded transition-colors ${
                showArchived
                  ? 'bg-slate-700 text-slate-200 border border-slate-600'
                  : 'text-slate-500 hover:text-slate-300 border border-transparent hover:border-slate-700'
              }`}
              title={showArchived ? 'Show active projects' : 'Show archived projects'}
            >
              <Archive className="w-3.5 h-3.5" />
              {showArchived ? 'Showing archived' : 'Archived'}
              <span className="text-[10px] bg-slate-800 rounded px-1 py-0.5 font-mono">{archivedProjects.length}</span>
            </button>
          )}
          {online && activeProjects.length > 0 && (
            <button
              onClick={() => setShowTagPanel(true)}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded text-slate-500 hover:text-slate-300 border border-transparent hover:border-slate-700 transition-colors"
              title="Manage tags"
            >
              <Tag className="w-3.5 h-3.5" />
              Tags
            </button>
          )}
          <div className="flex items-center bg-slate-800/50 rounded-md p-0.5">
            <button
              onClick={() => switchView('grid')}
              className={`p-1.5 rounded transition-colors ${viewMode === 'grid' ? 'bg-slate-700 text-slate-200' : 'text-slate-500 hover:text-slate-300'}`}
              title="Grid view"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => switchView('list')}
              className={`p-1.5 rounded transition-colors ${viewMode === 'list' ? 'bg-slate-700 text-slate-200' : 'text-slate-500 hover:text-slate-300'}`}
              title="List view"
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => switchView('layout')}
              className={`p-1.5 rounded transition-colors ${viewMode === 'layout' ? 'bg-slate-700 text-slate-200' : 'text-slate-500 hover:text-slate-300'}`}
              title="Layout view"
            >
              <Columns3 className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className={`w-1.5 h-1.5 rounded-full ${daemonOnline ? 'bg-emerald-400' : 'bg-slate-600'}`} />
            <span className="text-slate-500">{daemonOnline ? 'daemon online' : 'daemon offline'}</span>
          </div>
        </div>
      </div>
      <div className="p-8 space-y-6">
        {!showArchived && (
          <MetricsSummaryBar
            projects={activeProjects}
            runningProcesses={runningProcesses}
            metrics={metrics}
            activeFilter={activeFilter}
            onFilter={setActiveFilter}
          />
        )}
        {!showArchived && <PortConflictPanel conflicts={conflicts} onRefresh={refreshConflicts} loading={conflictsLoading} onNavigate={onSelect} />}
        {!showArchived && activeFilter !== 'all' && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Showing {filteredProjects.length} of {activeProjects.length} projects</span>
            <button
              onClick={() => setActiveFilter('all')}
              className="text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              Clear filter
            </button>
          </div>
        )}
        {effectiveSelectedTags.size > 0 && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Tag className="w-3 h-3" />
            <span>Tag filter ({effectiveTagMode.toUpperCase()}): {[...effectiveSelectedTags].join(', ')}</span>
            <span className="text-slate-600">— showing {filteredProjects.length} projects</span>
          </div>
        )}
        {viewMode === 'layout' ? (
          <div className="space-y-4">
            {/* Layout toolbar */}
            {!showArchived && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setLayoutEditing(!layoutEditing)}
                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded transition-colors ${
                      layoutEditing
                        ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/40'
                        : 'text-slate-500 hover:text-slate-300 border border-transparent hover:border-slate-700'
                    }`}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    {layoutEditing ? 'Editing' : 'Edit Layout'}
                  </button>
                  {layoutDirty && (
                    <button
                      onClick={saveLayoutToSupabase}
                      disabled={layoutSaving}
                      className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                    >
                      {layoutSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      Save
                    </button>
                  )}
                </div>
                {!layoutReady && (
                  <button
                    onClick={initDefaultLayout}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-600 transition-colors"
                  >
                    <Columns3 className="w-3.5 h-3.5" />
                    Create default layout
                  </button>
                )}
              </div>
            )}

            {/* Section list */}
            {layoutReady ? (
              <div className="space-y-4">
                {layoutSections.map(section => {
                  const sectionProjects = section.project_ids
                    .map(id => filteredProjects.find(p => p.id === id))
                    .filter(Boolean) as Project[];
                  return (
                    <LayoutSectionView
                      key={section.id}
                      section={section}
                      projects={sectionProjects}
                      onOpen={onSelect}
                      onClone={onClone}
                      onPin={handlePin}
                      daemonOnline={daemonOnline}
                      getOverridePath={getOverridePath}
                      editing={layoutEditing}
                      onRename={renameSection}
                      onDelete={deleteSection}
                      onToggleCollapse={toggleSectionCollapse}
                      onChangeCardSize={changeSectionCardSize}
                      onDragOver={handleLayoutDragOver}
                      onDrop={handleLayoutDrop}
                      onDragStart={handleLayoutDragStart}
                      onDragEnd={handleLayoutDragEnd}
                      onLaunched={refreshProcesses}
                    />
                  );
                })}
                {layoutEditing && <NewSectionCard onAdd={() => setShowNewSection(true)} />}

                {/* Unassigned projects (not in any section) */}
                {(() => {
                  const assignedIds = new Set(layoutSections.flatMap(s => s.project_ids));
                  const unassigned = filteredProjects.filter(p => !assignedIds.has(p.id));
                  if (unassigned.length === 0) return null;
                  return (
                    <div className="rounded-lg border border-slate-800 bg-slate-900/30">
                      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800/50">
                        <FolderGit2 className="w-4 h-4 text-slate-500" />
                        <h3 className="text-sm font-semibold text-slate-400">Unassigned</h3>
                        <span className="text-[10px] text-slate-600 tabular-nums">{unassigned.length} project{unassigned.length !== 1 ? 's' : ''}</span>
                      </div>
                      <div
                        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-4"
                        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                        onDrop={e => {
                          e.preventDefault();
                          // Move to first section or create one
                          if (layoutSections.length > 0) {
                            handleLayoutDrop(e, layoutSections[0].id);
                          }
                        }}
                      >
                        {unassigned.map(p => (
                          <LayoutProjectCard
                            key={p.id}
                            project={p}
                            onOpen={() => onSelect(p.slug)}
                            onClone={() => onClone(p)}
                            onPin={() => handlePin(p)}
                            daemonOnline={daemonOnline}
                            overridePath={getOverridePath(p.id)}
                            cardSize="medium"
                            onDragStart={() => handleLayoutDragStart(p.id, '__unassigned__')}
                            onDragEnd={handleLayoutDragEnd}
                            onLaunched={refreshProcesses}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="py-12 text-center text-sm text-slate-500">
                <Columns3 className="w-8 h-8 mx-auto mb-3 text-slate-600" />
                <p>No layout configured yet.</p>
                <p className="text-slate-600 mt-1">Click "Create default layout" to arrange your projects into sections.</p>
              </div>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          <div className="space-y-6">
            {/* Pinned projects section */}
            {pinnedProjects.length > 0 && !showArchived && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Pin className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Pinned</span>
                  <span className="text-[10px] text-slate-600 tabular-nums">{pinnedProjects.length}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {pinnedProjects.map(p => (
                    <div key={p.id} className="relative">
                      <ProjectCard
                        project={p}
                        onOpen={() => onSelect(p.slug)}
                        onClone={() => onClone(p)}
                        onPin={() => handlePin(p)}
                        daemonOnline={daemonOnline}
                        overridePath={getOverridePath(p.id)}
                        selectMode={selectMode}
                        selected={selectedIds.has(p.id)}
                        onToggleSelect={() => toggleSelect(p.id)}
                        onLaunched={refreshProcesses}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* All / unpinned projects */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {(pinnedProjects.length > 0 && !showArchived ? unpinnedProjects : filteredProjects).map(p => (
                <div key={p.id} className="relative">
                  <ProjectCard
                    project={p}
                    onOpen={() => onSelect(p.slug)}
                    onClone={() => onClone(p)}
                    onPin={() => handlePin(p)}
                    daemonOnline={daemonOnline && !showArchived}
                    overridePath={getOverridePath(p.id)}
                    selectMode={selectMode}
                    selected={selectedIds.has(p.id)}
                    onToggleSelect={() => toggleSelect(p.id)}
                    onLaunched={refreshProcesses}
                  />
                  {showArchived && online && !selectMode && (
                    <button
                      onClick={() => handleRestore(p)}
                      className="absolute top-2 right-2 flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                      title="Restore project"
                    >
                      <RotateCcw className="w-3 h-3" /> Restore
                    </button>
                  )}
                </div>
              ))}
              {!showArchived && online && activeFilter === 'all' && !selectMode && <NewProjectCard onNew={onNew} />}
            </div>
          </div>
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
            {/* List header */}
            <div className="flex items-center gap-4 px-4 py-2 border-b border-slate-800 text-[10px] uppercase tracking-wider font-medium text-slate-500">
              {selectMode && (
                <Checkbox
                  checked={selectedIds.size === filteredProjects.length && filteredProjects.length > 0}
                  indeterminate={selectedIds.size > 0 && selectedIds.size < filteredProjects.length}
                  onChange={checked => checked ? selectAll() : deselectAll()}
                />
              )}
              <div className="flex-1">Name</div>
              <div className="w-20 shrink-0 hidden md:block">Status</div>
              <div className="w-20 shrink-0 hidden lg:block">Platform</div>
              <div className="w-20 shrink-0 hidden lg:block">Branch</div>
              <div className="w-24 shrink-0 hidden lg:block">CI</div>
              <div className="w-16 shrink-0 text-right hidden sm:block">Updated</div>
              {!selectMode && <div className="w-[116px] shrink-0" />}
            </div>
            {/* Pinned rows */}
            {pinnedProjects.length > 0 && !showArchived && (
              <>
                {pinnedProjects.map(p => (
                  <div key={p.id} className="relative bg-amber-500/[0.02]">
                    <ProjectListRow
                      project={p}
                      onOpen={() => onSelect(p.slug)}
                      onClone={() => onClone(p)}
                      onPin={() => handlePin(p)}
                      daemonOnline={daemonOnline}
                      overridePath={getOverridePath(p.id)}
                      selectMode={selectMode}
                      selected={selectedIds.has(p.id)}
                      onToggleSelect={() => toggleSelect(p.id)}
                      onLaunched={refreshProcesses}
                    />
                  </div>
                ))}
                {unpinnedProjects.length > 0 && (
                  <div className="border-b border-slate-700/50" />
                )}
              </>
            )}
            {/* Unpinned / all rows */}
            {(pinnedProjects.length > 0 && !showArchived ? unpinnedProjects : filteredProjects).map(p => (
              <div key={p.id} className="relative">
                <ProjectListRow
                  project={p}
                  onOpen={() => onSelect(p.slug)}
                  onClone={() => onClone(p)}
                  onPin={() => handlePin(p)}
                  daemonOnline={daemonOnline && !showArchived}
                  overridePath={getOverridePath(p.id)}
                  selectMode={selectMode}
                  selected={selectedIds.has(p.id)}
                  onToggleSelect={() => toggleSelect(p.id)}
                  onLaunched={refreshProcesses}
                />
                {showArchived && online && !selectMode && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRestore(p); }}
                    className="absolute right-24 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                    title="Restore project"
                  >
                    <RotateCcw className="w-3 h-3" /> Restore
                  </button>
                )}
              </div>
            ))}
            {filteredProjects.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-slate-500">
                {showArchived ? 'No archived projects' : 'No projects match the current filter'}
              </div>
            )}
            {/* New project row */}
            {!showArchived && online && activeFilter === 'all' && !selectMode && <button
              onClick={onNew}
              className="flex items-center gap-2 px-4 py-2.5 w-full text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/5 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="text-sm font-medium">New project</span>
            </button>}
          </div>
        )}
      </div>

      {/* Floating selection toolbar */}
      {selectMode && selectedIds.size > 0 && (
        <SelectionToolbar
          count={selectedIds.size}
          total={filteredProjects.length}
          showArchived={showArchived}
          onSelectAll={selectAll}
          onDeselectAll={deselectAll}
          onAction={openBulkAction}
          onCancel={exitSelectMode}
        />
      )}

      {/* Bulk action confirmation dialog */}
      {bulkAction && (
        <BulkConfirmDialog
          action={bulkAction}
          projects={selectedProjects}
          open={!!bulkAction}
          onClose={() => setBulkAction(null)}
          onConfirm={executeBulkAction}
          busy={bulkBusy}
        />
      )}

      {/* Tag management panel */}
      <TagManagementPanel
        projects={projects}
        open={showTagPanel}
        onClose={() => setShowTagPanel(false)}
        onReload={onReload}
        onNavigateToProject={onSelect}
      />

      {/* New section dialog */}
      <SectionNameDialog
        open={showNewSection}
        onClose={() => setShowNewSection(false)}
        onConfirm={(name) => { addSection(name); setShowNewSection(false); }}
        initialValue=""
      />
    </div>
  );
}
