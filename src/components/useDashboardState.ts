import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import type { Project, MachineOverride, LayoutSection, LayoutCardSize } from '../lib/types';
import {
  listOverridesForMachine, restoreProject, fetchDashboardMetrics,
  bulkArchiveProjects, bulkDeleteProjects, bulkAddTags, bulkExportProjects,
  toggleProjectPin, getDashboardLayout, saveDashboardLayout,
} from '../lib/api';
import type { DashboardMetrics } from '../lib/api';
import { listProcesses } from '../lib/daemon';
import type { DaemonProcess } from '../lib/daemon';
import { useDaemonOnline } from '../lib/useDaemonOnline';
import { useCurrentMachine } from '../lib/useCurrentMachine';
import { usePortConflicts } from '../lib/usePortConflicts';
import { useConnectivity } from '../lib/connectivity';

type ViewMode = 'grid' | 'list' | 'layout';
type MetricFilter = 'all' | 'running' | 'ports' | 'deploying';
type BulkAction = 'archive' | 'delete' | 'tag' | 'export';

const VIEW_MODE_KEY = 'cockpit:dashboard-view';

function getStoredViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_MODE_KEY);
    if (v === 'list' || v === 'layout') return v;
    return 'grid';
  } catch { return 'grid'; }
}

function setStoredViewMode(mode: ViewMode) {
  try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch { /* noop */ }
}

function generateId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function useDashboardState({
  projects,
  onReload,
  selectedTags,
  tagFilterMode,
}: {
  projects: Project[];
  onReload: () => void;
  selectedTags?: Set<string>;
  tagFilterMode?: 'and' | 'or';
}) {
  const daemonOnline = useDaemonOnline();
  const { online } = useConnectivity();
  const currentMachine = useCurrentMachine();

  const [viewMode, setViewMode] = useState<ViewMode>(getStoredViewMode);
  const [showArchived, setShowArchived] = useState(false);
  const [machineOverrides, setMachineOverrides] = useState<Record<string, MachineOverride>>({});
  const [activeFilter, setActiveFilter] = useState<MetricFilter>('all');
  const [runningProcesses, setRunningProcesses] = useState<DaemonProcess[]>([]);
  const [processRefreshTick, setProcessRefreshTick] = useState(0);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showTagPanel, setShowTagPanel] = useState(false);

  const [layoutSections, setLayoutSections] = useState<LayoutSection[]>([]);
  const [layoutLoaded, setLayoutLoaded] = useState(false);
  const [layoutEditing, setLayoutEditing] = useState(false);
  const [layoutDirty, setLayoutDirty] = useState(false);
  const [layoutSaving, setLayoutSaving] = useState(false);
  const [dragState, setDragState] = useState<{ projectId: string; fromSectionId: string } | null>(null);
  const [showNewSection, setShowNewSection] = useState(false);

  const activeProjects = useMemo(() => projects.filter(p => p.status !== 'archived'), [projects]);
  const archivedProjects = useMemo(() => projects.filter(p => p.status === 'archived'), [projects]);
  const { conflicts, loading: conflictsLoading, refresh: refreshConflicts } = usePortConflicts(activeProjects.length);

  useEffect(() => {
    if (!currentMachine) { setMachineOverrides({}); return; }
    listOverridesForMachine(currentMachine.id)
      .then(setMachineOverrides)
      .catch(() => setMachineOverrides({}));
  }, [currentMachine?.id]);

  useEffect(() => {
    if (!daemonOnline) { setRunningProcesses([]); return; }
    listProcesses().then(setRunningProcesses).catch(() => setRunningProcesses([]));
    const interval = setInterval(() => {
      listProcesses().then(setRunningProcesses).catch(() => setRunningProcesses([]));
    }, 5_000);
    return () => clearInterval(interval);
  }, [daemonOnline, processRefreshTick]);

  const refreshProcesses = useCallback(() => setProcessRefreshTick(t => t + 1), []);

  useEffect(() => {
    fetchDashboardMetrics().then(setMetrics).catch(() => setMetrics(null));
  }, [projects.length]);

  useEffect(() => {
    if (viewMode !== 'layout' || layoutLoaded) return;
    getDashboardLayout().then(layout => {
      if (layout && Array.isArray(layout.layout_config)) setLayoutSections(layout.layout_config);
      setLayoutLoaded(true);
    }).catch(() => setLayoutLoaded(true));
  }, [viewMode, layoutLoaded]);

  const layoutReady = useMemo(() => layoutSections.length > 0, [layoutSections]);

  const runningSlugs = useMemo(() => {
    const slugs = new Set<string>();
    for (const p of runningProcesses) { if (p.running) slugs.add(p.slug); }
    return slugs;
  }, [runningProcesses]);

  const effectiveSelectedTags = selectedTags ?? new Set<string>();
  const effectiveTagMode = tagFilterMode ?? 'or';
  const baseProjects = showArchived ? archivedProjects : activeProjects;

  const filteredProjects = useMemo(() => {
    let result = baseProjects;
    if (!showArchived && activeFilter !== 'all') {
      result = result.filter(p => {
        switch (activeFilter) {
          case 'running': return runningSlugs.has(p.slug);
          case 'ports': return metrics?.projectsWithPorts.has(p.id);
          case 'deploying': return metrics?.projectsWithPendingDeploys.has(p.id);
          default: return true;
        }
      });
    }
    if (effectiveSelectedTags.size > 0) {
      result = result.filter(p => {
        const projectTags = p.tags ? new Set(p.tags.split(',').map(t => t.trim()).filter(Boolean)) : new Set<string>();
        return effectiveTagMode === 'and'
          ? [...effectiveSelectedTags].every(tag => projectTags.has(tag))
          : [...effectiveSelectedTags].some(tag => projectTags.has(tag));
      });
    }
    return result;
  }, [baseProjects, showArchived, activeFilter, runningSlugs, metrics, effectiveSelectedTags, effectiveTagMode]);

  const pinnedProjects = useMemo(() => filteredProjects.filter(p => p.pinned), [filteredProjects]);
  const unpinnedProjects = useMemo(() => filteredProjects.filter(p => !p.pinned), [filteredProjects]);

  useEffect(() => {
    if (!selectMode) return;
    const visibleIds = new Set(filteredProjects.map(p => p.id));
    setSelectedIds(prev => {
      const next = new Set<string>();
      for (const id of prev) { if (visibleIds.has(id)) next.add(id); }
      return next.size === prev.size ? prev : next;
    });
  }, [filteredProjects, selectMode]);

  const selectedProjects = useMemo(
    () => projects.filter(p => selectedIds.has(p.id)),
    [projects, selectedIds],
  );

  function getOverridePath(projectId: string): string | undefined {
    return machineOverrides[projectId]?.repo_path || undefined;
  }

  function switchView(mode: ViewMode) {
    setViewMode(mode);
    setStoredViewMode(mode);
  }

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  function enterSelectMode() { setSelectMode(true); setSelectedIds(new Set()); }
  function exitSelectMode() { setSelectMode(false); setSelectedIds(new Set()); setBulkAction(null); }
  function selectAll() { setSelectedIds(new Set(filteredProjects.map(p => p.id))); }
  function deselectAll() { setSelectedIds(new Set()); }

  function openBulkAction(action: BulkAction) {
    if (selectedIds.size === 0) return;
    setBulkAction(action);
  }

  async function executeBulkAction(tags?: string) {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      const ids = [...selectedIds];
      switch (bulkAction) {
        case 'archive': await bulkArchiveProjects(ids, projects); break;
        case 'delete': await bulkDeleteProjects(ids); break;
        case 'tag':
          if (tags) await bulkAddTags(ids, tags.split(',').map(t => t.trim()).filter(Boolean), projects);
          break;
        case 'export': bulkExportProjects(selectedProjects); break;
      }
      exitSelectMode();
      if (bulkAction !== 'export') onReload();
    } catch (err: any) {
      alert(`Bulk operation failed: ${err.message}`);
    } finally {
      setBulkBusy(false);
    }
  }

  async function handlePin(project: Project) {
    try {
      await toggleProjectPin(project.id, !project.pinned);
      onReload();
    } catch (err: any) {
      alert(`Pin failed: ${err.message}`);
    }
  }

  async function handleRestore(project: Project) {
    if (!confirm(`Restore "${project.name}" to active status?`)) return;
    try {
      await restoreProject(project.id);
      onReload();
    } catch (err: any) {
      alert(`Restore failed: ${err.message}`);
    }
  }

  function initDefaultLayout() {
    const pinnedIds = activeProjects.filter(p => p.pinned).map(p => p.id);
    const unpinnedIds = activeProjects.filter(p => !p.pinned).map(p => p.id);
    const sections: LayoutSection[] = [];
    if (pinnedIds.length > 0) sections.push({ id: generateId(), name: 'Pinned', project_ids: pinnedIds, card_size: 'medium', collapsed: false });
    if (unpinnedIds.length > 0) sections.push({ id: generateId(), name: 'All Projects', project_ids: unpinnedIds, card_size: 'medium', collapsed: false });
    if (sections.length === 0) sections.push({ id: generateId(), name: 'All Projects', project_ids: [], card_size: 'medium', collapsed: false });
    setLayoutSections(sections);
    setLayoutDirty(true);
  }

  async function saveLayoutToSupabase() {
    setLayoutSaving(true);
    try {
      await saveDashboardLayout(layoutSections);
      setLayoutDirty(false);
    } catch (err: any) {
      alert(`Failed to save layout: ${err.message}`);
    } finally {
      setLayoutSaving(false);
    }
  }

  function addSection(name: string) {
    setLayoutSections(prev => [...prev, { id: generateId(), name, project_ids: [], card_size: 'medium', collapsed: false }]);
    setLayoutDirty(true);
  }

  function renameSection(id: string, name: string) {
    setLayoutSections(prev => prev.map(s => s.id === id ? { ...s, name } : s));
    setLayoutDirty(true);
  }

  function deleteSection(id: string) {
    setLayoutSections(prev => {
      const section = prev.find(s => s.id === id);
      if (!section) return prev;
      const others = prev.filter(s => s.id !== id);
      if (others.length > 0 && section.project_ids.length > 0) {
        others[0] = { ...others[0], project_ids: [...others[0].project_ids, ...section.project_ids] };
      }
      return others;
    });
    setLayoutDirty(true);
  }

  function toggleSectionCollapse(id: string) {
    setLayoutSections(prev => prev.map(s => s.id === id ? { ...s, collapsed: !s.collapsed } : s));
  }

  function changeSectionCardSize(id: string, size: LayoutCardSize) {
    setLayoutSections(prev => prev.map(s => s.id === id ? { ...s, card_size: size } : s));
    setLayoutDirty(true);
  }

  function handleLayoutDragStart(projectId: string, sectionId: string) {
    setDragState({ projectId, fromSectionId: sectionId });
  }

  function handleLayoutDragEnd() { setDragState(null); }

  function handleLayoutDragOver(_e: DragEvent, _sectionId: string, _index?: number) {
    // Visual feedback handled per-section via isDragOver state
  }

  function handleLayoutDrop(_e: DragEvent, toSectionId: string, insertIndex?: number) {
    if (!dragState) return;
    const { projectId, fromSectionId } = dragState;
    setDragState(null);
    setLayoutSections(prev => {
      const updated = prev.map(s => ({ ...s, project_ids: [...s.project_ids] }));
      const from = updated.find(s => s.id === fromSectionId);
      const to = updated.find(s => s.id === toSectionId);
      if (!from || !to) return prev;
      from.project_ids = from.project_ids.filter(id => id !== projectId);
      if (insertIndex !== undefined && insertIndex >= 0) {
        to.project_ids.splice(insertIndex, 0, projectId);
      } else {
        to.project_ids.push(projectId);
      }
      return updated;
    });
    setLayoutDirty(true);
  }

  return {
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
    getOverridePath,
    refreshProcesses,
    toggleSelect, enterSelectMode, exitSelectMode, selectAll, deselectAll,
    openBulkAction, executeBulkAction, setBulkAction,
    handlePin, handleRestore,
    initDefaultLayout, saveLayoutToSupabase,
    addSection, renameSection, deleteSection,
    toggleSectionCollapse, changeSectionCardSize,
    handleLayoutDragStart, handleLayoutDragEnd,
    handleLayoutDragOver, handleLayoutDrop,
  };
}
