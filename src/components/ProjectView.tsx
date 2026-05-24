import { useEffect, useState } from 'react';
import { Loader2, Zap, WifiOff } from 'lucide-react';
import type { ProjectScope } from '../lib/types';
import { getProjectScopeCached, getEffectiveRepoPath } from '../lib/api';
import { checkHealth, setProjectDirectory, detectProject } from '../lib/daemon';
import { useCurrentMachine } from '../lib/useCurrentMachine';
import { useConnectivity } from '../lib/connectivity';
import { PROJECT_TABS, type ProjectTabId } from './projectTabs';
import { OverviewTab } from './tabs/OverviewTab';
import { CommandsTab } from './tabs/CommandsTab';
import { PortsTab } from './tabs/PortsTab';
import { UrlsTab } from './tabs/UrlsTab';
import { DeploymentTab } from './tabs/DeploymentTab';
import { EnvTab } from './tabs/EnvTab';
import { DockerTab } from './tabs/DockerTab';
import { SshTab } from './tabs/SshTab';
import { AgentContextTab } from './tabs/AgentContextTab';
import { ControlsTab } from './tabs/ControlsTab';
import { MachinesTab } from './tabs/MachinesTab';
import { NotesTab } from './tabs/NotesTab';
import { DangerZoneTab } from './tabs/DangerZoneTab';
import { LaunchGroupsTab } from './tabs/LaunchGroupsTab';
import { CITab } from './tabs/CITab';
import { GitHubRepoTab } from './tabs/GitHubRepoTab';
import { IssuesTab } from './tabs/IssuesTab';
import { PullRequestsTab } from './tabs/PullRequestsTab';
import { ActivityLogTab } from './tabs/ActivityLogTab';
import { RunbooksTab } from './tabs/RunbooksTab';
import { WebhooksTab } from './tabs/WebhooksTab';
import { Badge, StaleIndicator } from './ui';
import { ExternalHref } from './ExternalLink';

type Props = {
  slug: string;
  activeTab: ProjectTabId;
  onTabChange: (tabId: ProjectTabId) => void;
  onDeleted: () => void;
  onRegisterTabSwitch?: (switcher: (tabId: string) => void) => void;
};

export function ProjectView({ slug, activeTab, onTabChange, onDeleted, onRegisterTabSwitch }: Props) {
  const [scope, setScope] = useState<ProjectScope | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [daemonOnline, setDaemonOnline] = useState(false);
  const [scanning, setScanning] = useState(false);
  const currentMachine = useCurrentMachine(refreshKey);
  const { online } = useConnectivity();

  // Poll daemon health
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        await checkHealth();
        if (!cancelled) setDaemonOnline(true);
      } catch {
        if (!cancelled) setDaemonOnline(false);
      }
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  async function load() {
    setLoading(true);
    try {
      const result = await getProjectScopeCached(slug);
      setScope(result.data);
      setCachedAt(result.fromCache ? result.cachedAt : null);

      // Set daemon directory to this project
      const repoPath = result.data ? getEffectiveRepoPath(result.data, currentMachine) : null;
      if (repoPath && daemonOnline) {
        try {
          await setProjectDirectory(repoPath);
          console.log('Daemon directory set to:', repoPath);
        } catch (error) {
          console.error('Failed to set daemon directory:', error);
        }
      }

      // DISABLED: Auto-scan was causing infinite loops
      // Manual scan only now
      /*
      const shouldAutoScan = result.data &&
        (!result.data.commands || result.data.commands.length === 0) &&
        (!result.data.ports || result.data.ports.length === 0) &&
        repoPath && daemonOnline && !hasScanned;

      if (shouldAutoScan) {
        console.log('No existing data found, running auto-scan...');
        setHasScanned(true);
        await runComprehensiveScan(repoPath);
      }
      */
    } finally {
      setLoading(false);
    }
  }

  function handleChange() {
    load();
    setRefreshKey(k => k + 1);
  }

  async function runComprehensiveScan(repoPath?: string) {
    if (!scope || scanning) return; // Prevent multiple simultaneous scans
    const path = repoPath || getEffectiveRepoPath(scope, currentMachine);
    if (!path) {
      alert('No repository path configured for this project');
      return;
    }

    setScanning(true);
    try {
      const results = await detectProject(path);

      // Import the necessary functions
      const { upsertRow } = await import('../lib/api');

      let addedCount = 0;
      const summary = [];

      // Add all detected ports (with duplicate prevention)
      if (results.ports.length > 0) {
        const existingPorts = new Map(scope.ports.map(p => [p.port, p]));
        const newPorts = results.ports.filter(p => !existingPorts.has(p.port));

        for (const port of newPorts) {
          await upsertRow('project_ports', {
            project_id: scope.project.id,
            label: port.label,
            port: port.port,
            protocol: port.protocol,
            local_url: port.local_url,
            health_url: port.health_url
          });
          addedCount++;
        }
        if (newPorts.length > 0) summary.push(`${newPorts.length} ports`);
      }

      // Add all detected commands (with duplicate prevention)
      if (results.commands.length > 0) {
        const existingCommands = new Map(scope.commands.map(c => [c.name, c]));
        const newCommands = results.commands.filter(c => !existingCommands.has(c.name));

        for (const cmd of newCommands) {
          await upsertRow('command_profiles', {
            project_id: scope.project.id,
            name: cmd.name,
            kind: cmd.kind,
            command: cmd.command,
            working_dir: cmd.working_dir,
            expected_port: cmd.expected_port,
            health_url: cmd.health_url,
            must_confirm: cmd.must_confirm
          });
          addedCount++;
        }
        if (newCommands.length > 0) summary.push(`${newCommands.length} commands`);
      }

      // Add detected environment keys (with duplicate prevention)
      if (results.env_keys.length > 0) {
        const existingEnvKeys = new Map(scope.env_keys.map(e => [e.key_name, e]));
        const newEnvKeys = results.env_keys.filter(e => !existingEnvKeys.has(e.key_name));

        for (const envKey of newEnvKeys) {
          await upsertRow('env_keys', {
            project_id: scope.project.id,
            key_name: envKey.key_name,
            classification: envKey.classification,
          });
          addedCount++;
        }
        if (newEnvKeys.length > 0) summary.push(`${newEnvKeys.length} env keys`);
      }

      // Add detected deployments (with duplicate prevention)
      if (results.deployments.length > 0) {
        const existingDeployments = new Map(scope.deployments.map(d => [`${d.platform}:${d.environment}`, d]));
        const newDeployments = results.deployments.filter(d => !existingDeployments.has(`${d.platform}:${d.environment}`));

        for (const deployment of newDeployments) {
          await upsertRow('deployment_targets', {
            project_id: scope.project.id,
            platform: deployment.platform,
            environment: deployment.environment,
            production_url: deployment.production_url
          });
          addedCount++;
        }
        if (newDeployments.length > 0) summary.push(`${newDeployments.length} deployments`);
      }

      // Add detected Docker configs (with duplicate prevention)
      if (results.docker.length > 0) {
        const existingDocker = new Map(scope.docker.map(d => [d.compose_file_path, d]));
        const newDocker = results.docker.filter(d => !existingDocker.has(d.compose_file_path));

        for (const docker of newDocker) {
          await upsertRow('docker_compose_configs', {
            project_id: scope.project.id,
            compose_file_path: docker.compose_file_path,
            services: docker.services
          });
          addedCount++;
        }
        if (newDocker.length > 0) summary.push(`${newDocker.length} Docker configs`);
      }

      // Refresh the scope
      await load();

      // Show results
      if (addedCount > 0) {
        console.log(`Scan complete: Added ${summary.join(', ')}`);
      } else {
        console.log('Scan complete: No new items found');
      }
    } catch (error) {
      console.error('Scan failed:', error);
      alert(`Scan failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => { load(); }, [slug]);

  // Expose tab switching to parent for keyboard shortcuts
  useEffect(() => {
    if (onRegisterTabSwitch) {
      onRegisterTabSwitch((tabId: string) => {
        if (tabId === '__prev__') {
          const idx = PROJECT_TABS.findIndex(t => t.id === activeTab);
          onTabChange(PROJECT_TABS[(idx - 1 + PROJECT_TABS.length) % PROJECT_TABS.length].id as ProjectTabId);
        } else if (tabId === '__next__') {
          const idx = PROJECT_TABS.findIndex(t => t.id === activeTab);
          onTabChange(PROJECT_TABS[(idx + 1) % PROJECT_TABS.length].id as ProjectTabId);
        } else if (PROJECT_TABS.some(t => t.id === tabId)) {
          onTabChange(tabId as ProjectTabId);
        }
      });
    }
  }, [onRegisterTabSwitch, onTabChange, activeTab]);

  // Re-fetch when connectivity is restored
  useEffect(() => {
    if (online && cachedAt) load();
  }, [online]);

  if (loading && !scope) return <div className="p-8 text-slate-500">Loading project…</div>;
  if (!scope) return <div className="p-8 text-slate-500">Project not found.</div>;

  const effectivePath = getEffectiveRepoPath(scope, currentMachine);
  const isOverridden = effectivePath !== scope.project.repo_path && !!effectivePath;

  // When offline, use a no-op onChange to prevent mutations
  const onChange = online ? load : () => {};
  const onMachineChange = online ? handleChange : () => {};

  return (
    <div className="flex-1 overflow-auto">
      <div className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-10">
        <div className="px-6 py-4">
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h2 className="text-lg font-semibold text-slate-100">{scope.project.name || scope.project.slug}</h2>
            <Badge tone="emerald">{scope.project.status}</Badge>
            {scope.project.hosting_platform && <Badge tone="blue">{scope.project.hosting_platform}</Badge>}
            {scope.project.repo_url && (
              <ExternalHref href={scope.project.repo_url} className="text-xs font-medium">
                Repository ↗
              </ExternalHref>
            )}
            {cachedAt && <StaleIndicator cachedAt={cachedAt} />}
            {daemonOnline && effectivePath && (
              <button
                onClick={() => runComprehensiveScan()}
                disabled={scanning}
                className="ml-auto px-3 py-1.5 text-xs font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded flex items-center gap-1.5 transition-colors disabled:opacity-50"
                title="Scan project files for ports, commands, env vars, deployments, and Docker configs"
              >
                {scanning ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Scanning…
                  </>
                ) : (
                  <>
                    <Zap className="w-3.5 h-3.5" />
                    Scan Everything
                  </>
                )}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-mono">{effectivePath || '—'}</span>
            {isOverridden && currentMachine && (
              <span className="text-[10px] text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded px-1.5 py-0.5">
                {currentMachine.label || currentMachine.hostname}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="p-6">
        {!online && (
          <div className="mb-4 flex items-center gap-2 px-4 py-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-300 text-xs">
            <WifiOff className="w-3.5 h-3.5 shrink-0" />
            <span>Offline — edits in this view will not be saved until connectivity is restored.</span>
          </div>
        )}
        {!daemonOnline && (
          <div className="mb-4 flex items-center gap-2 px-4 py-2.5 bg-slate-800/60 border border-slate-700/50 rounded-lg text-slate-400 text-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-600 shrink-0" />
            <span>Daemon offline — run <code className="font-mono bg-slate-700/60 px-1 rounded">ldc daemon</code> to enable launch, scan, and webhook features.</span>
          </div>
        )}
        {activeTab === 'overview' && <OverviewTab scope={scope} onChange={onChange} onDeleted={onDeleted} />}
        {activeTab === 'notes' && <NotesTab scope={scope} onChange={onChange} />}
        {activeTab === 'runbooks' && <RunbooksTab scope={scope} onChange={onChange} daemonOnline={daemonOnline} />}
        {activeTab === 'controls' && <ControlsTab scope={scope} onChange={onChange} />}
        {activeTab === 'launch' && <LaunchGroupsTab scope={scope} onChange={onChange} daemonOnline={daemonOnline} />}
        {activeTab === 'agent' && <AgentContextTab scope={scope} onChange={onChange} />}
        {activeTab === 'dangerzone' && <DangerZoneTab scope={scope} onChange={onChange} />}
        {activeTab === 'commands' && <CommandsTab scope={scope} onChange={onChange} />}
        {activeTab === 'ports' && <PortsTab scope={scope} onChange={onChange} />}
        {activeTab === 'urls' && <UrlsTab scope={scope} onChange={onChange} />}
        {activeTab === 'github' && <GitHubRepoTab scope={scope} />}
        {activeTab === 'issues' && <IssuesTab scope={scope} />}
        {activeTab === 'prs' && <PullRequestsTab scope={scope} />}
        {activeTab === 'ci' && <CITab scope={scope} />}
        {activeTab === 'webhooks' && <WebhooksTab scope={scope} onChange={onChange} daemonOnline={daemonOnline} />}
        {activeTab === 'activity' && <ActivityLogTab scope={scope} onChange={onChange} />}
        {activeTab === 'deployment' && <DeploymentTab scope={scope} onChange={onChange} />}
        {activeTab === 'env' && <EnvTab scope={scope} onChange={onChange} />}
        {activeTab === 'docker' && <DockerTab scope={scope} onChange={onChange} />}
        {activeTab === 'ssh' && <SshTab scope={scope} onChange={onChange} />}
        {activeTab === 'machines' && <MachinesTab scope={scope} onChange={onMachineChange} />}
      </div>
    </div>
  );
}
