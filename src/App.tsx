import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { listProjectsCached, upsertGitHubToken } from './lib/api';
import type { Project } from './lib/types';
import { ConnectivityContext, type ConnectivityState } from './lib/connectivity';
import { useKeyboardShortcuts, type Shortcut } from './lib/useKeyboardShortcuts';
import { Auth } from './components/Auth';
import { Sidebar } from './components/Sidebar';
import { ProjectView } from './components/ProjectView';
import { AppTopBar } from './components/AppTopBar';
import { Dashboard } from './components/Dashboard';
import { TABS, type ProjectTabId } from './components/projectTabs';
import { NewProjectModal } from './components/NewProjectModal';
import { CloneProjectModal } from './components/CloneProjectModal';
import { SearchPalette } from './components/SearchPalette';
import { ShortcutHelpModal } from './components/ShortcutHelpModal';
import { OfflineBanner, ErrorBoundary } from './components/ui';

const PING_INTERVAL = 15_000; // 15s connectivity check

function useSupabaseConnectivity(session: Session | null): ConnectivityState {
  const [state, setState] = useState<ConnectivityState>({ online: true, checking: false, lastOnline: null });
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  const check = useCallback(async () => {
    if (!session) return;
    setState(prev => ({ ...prev, checking: true }));
    try {
      // Lightweight query to test Supabase reachability
      const { error } = await supabase.from('projects').select('id', { count: 'exact', head: true });
      if (error) throw error;
      setState({ online: true, checking: false, lastOnline: Date.now() });
    } catch {
      setState(prev => ({ ...prev, online: false, checking: false }));
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    check(); // initial check
    timerRef.current = setInterval(check, PING_INTERVAL);
    // Also listen to browser online/offline events for faster detection
    const goOnline = () => check();
    const goOffline = () => setState(prev => ({ ...prev, online: false }));
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      clearInterval(timerRef.current);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [session, check]);

  return state;
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsCachedAt, setProjectsCachedAt] = useState<number | null>(null);
  const [projectsLoadError, setProjectsLoadError] = useState(false);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [cloneSource, setCloneSource] = useState<Project | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [tagFilterMode, setTagFilterMode] = useState<'and' | 'or'>('or');
  const [activeTab, setActiveTab] = useState<ProjectTabId>('overview');

  const connectivity = useSupabaseConnectivity(session);
  const tabSwitcherRef = useRef<((tabId: string) => void) | null>(null);
  const { showHelp, setShowHelp, register, getShortcuts } = useKeyboardShortcuts();

  // Register all global keyboard shortcuts
  useEffect(() => {
    const shortcuts: Shortcut[] = [
      // Navigation
      { key: 'k', ctrl: true, label: 'Search projects', group: 'Navigation', action: () => setShowSearch(prev => !prev) },
      { key: 'h', label: 'Go to dashboard', group: 'Navigation', action: () => setActiveSlug(null) },
      { key: 'n', ctrl: true, label: 'New project', group: 'Navigation', action: () => setShowNew(true) },
      { key: 'j', label: 'Next project', group: 'Navigation', action: () => {
        if (!projects.length) return;
        const idx = activeSlug ? projects.findIndex(p => p.slug === activeSlug) : -1;
        const next = projects[(idx + 1) % projects.length];
        if (next) setActiveSlug(next.slug);
      }},
      { key: 'k', label: 'Previous project', group: 'Navigation', action: () => {
        if (!projects.length) return;
        const idx = activeSlug ? projects.findIndex(p => p.slug === activeSlug) : 0;
        const prev = projects[(idx - 1 + projects.length) % projects.length];
        if (prev) setActiveSlug(prev.slug);
      }},
      // Tab shortcuts (1-9 for first 9 tabs)
      ...TABS.slice(0, 9).map((t, i) => ({
        key: String(i + 1),
        label: `Go to ${t.label} tab`,
        group: 'Tabs',
        action: () => tabSwitcherRef.current?.(t.id),
      })),
      { key: '0', label: `Go to ${TABS[9]?.label ?? 'tab 10'} tab`, group: 'Tabs', action: () => {
        if (TABS[9]) tabSwitcherRef.current?.(TABS[9].id);
      }},
      // Tab navigation
      { key: '[', label: 'Previous tab', group: 'Tabs', action: () => {
        // We can't know current tab here, so use a sentinel approach via tabSwitcher
        tabSwitcherRef.current?.('__prev__');
      }},
      { key: ']', label: 'Next tab', group: 'Tabs', action: () => {
        tabSwitcherRef.current?.('__next__');
      }},
      // Actions
      { key: 'r', label: 'Refresh projects', group: 'Actions', action: () => { reload(); }},
    ];
    register(shortcuts);
  }, [projects, activeSlug, register]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // Capture GitHub provider token after OAuth callback
      if (event === 'SIGNED_IN' && s?.provider_token) {
        const meta = s.user?.user_metadata;
        upsertGitHubToken(
          s.provider_token,
          meta?.user_name || meta?.preferred_username || '',
          meta?.avatar_url || '',
          'read:user,repo',
        ).catch(console.error);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }, []);

  const clearTags = useCallback(() => setSelectedTags(new Set()), []);

  async function reload() {
    const result = await listProjectsCached();
    setProjectsLoadError(result.error === true);
    const ps = result.data;
    setProjects(ps);
    setProjectsCachedAt(result.fromCache ? result.cachedAt : null);
    if (activeSlug && !ps.find(p => p.slug === activeSlug)) setActiveSlug(ps[0]?.slug ?? null);
    if (!activeSlug && ps.length) setActiveSlug(ps[0].slug);
  }

  useEffect(() => {
    if (session) reload();
    else { setProjects([]); setActiveSlug(null); setProjectsCachedAt(null); }
  }, [session?.user?.id]);

  useEffect(() => {
    setActiveTab('overview');
  }, [activeSlug]);

  // Re-fetch when connectivity is restored
  useEffect(() => {
    if (connectivity.online && session && projectsCachedAt) {
      reload();
    }
  }, [connectivity.online]);

  if (!authReady) return <div className="min-h-screen bg-slate-950" />;
  if (!session) return <Auth />;

  return (
    <ConnectivityContext.Provider value={connectivity}>
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
        {!connectivity.online && <OfflineBanner />}
        {projectsLoadError && connectivity.online && (
          <div className="flex items-center gap-2 px-4 py-2 bg-rose-500/10 border-b border-rose-500/30 text-rose-300 text-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" />
            Failed to load projects from Supabase — check your connection or session.
            <button onClick={reload} className="underline hover:no-underline ml-1">Retry</button>
          </div>
        )}
        {/* <DaemonBanner /> */}
        <div className="flex flex-1 min-h-0">
          <Sidebar
            projects={projects}
            activeSlug={activeSlug}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onDashboard={() => setActiveSlug(null)}
            selectedTags={selectedTags}
            onToggleTag={toggleTag}
            onClearTags={clearTags}
            tagFilterMode={tagFilterMode}
            onToggleFilterMode={() => setTagFilterMode(m => m === 'and' ? 'or' : 'and')}
          />
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <AppTopBar
              projects={projects}
              activeSlug={activeSlug}
              onSelectProject={setActiveSlug}
              onDashboard={() => setActiveSlug(null)}
              onNew={() => setShowNew(true)}
            />
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <ErrorBoundary>
            {activeSlug ? (
              <ProjectView
                key={activeSlug}
                slug={activeSlug}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                onDeleted={reload}
                onRegisterTabSwitch={(switcher) => { tabSwitcherRef.current = switcher; }}
              />
            ) : (
              <Dashboard
                projects={projects}
                onSelect={setActiveSlug}
                onNew={() => setShowNew(true)}
                onClone={setCloneSource}
                onReload={reload}
                cachedAt={projectsCachedAt}
                selectedTags={selectedTags}
                tagFilterMode={tagFilterMode}
              />
            )}
            </ErrorBoundary>
            </main>
          </div>
        </div>
        {showNew && !connectivity.online ? null : showNew && (
          <NewProjectModal
            onClose={() => setShowNew(false)}
            onCreated={(slug) => { setShowNew(false); reload().then(() => setActiveSlug(slug)); }}
          />
        )}
        {cloneSource && connectivity.online && (
          <CloneProjectModal
            sourceProject={cloneSource}
            onClose={() => setCloneSource(null)}
            onCloned={(slug) => { setCloneSource(null); reload().then(() => setActiveSlug(slug)); }}
          />
        )}
        <SearchPalette
          open={showSearch}
          onClose={() => setShowSearch(false)}
          projects={projects}
          onSelectProject={(slug) => setActiveSlug(slug)}
        />
        <ShortcutHelpModal
          open={showHelp}
          onClose={() => setShowHelp(false)}
          shortcuts={getShortcuts()}
        />
      </div>
    </ConnectivityContext.Provider>
  );
}

export default App;
