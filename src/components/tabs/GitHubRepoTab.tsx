import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, GitPullRequest, CircleDot, Shield, Activity, ExternalLink, AlertCircle } from 'lucide-react';
import type { ProjectScope, GitHubRepoStatus } from '../../lib/types';
import { fetchRepoStatus, parseOwnerRepo } from '../../lib/github';
import { Card, CardHeader, Badge, Button } from '../ui';

const REFRESH_INTERVAL_MS = 120_000; // 2 minutes

export function GitHubRepoTab({ scope }: { scope: ProjectScope }) {
  const [status, setStatus] = useState<GitHubRepoStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await fetchRepoStatus(scope.project.repo_url, scope.project.default_branch);
      setStatus(s);
    } catch {
      setStatus({
        openIssues: null, openPRs: null, latestRun: null, branchProtected: null,
        error: 'Failed to fetch GitHub status',
        fetchedAt: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  }, [scope.project.repo_url, scope.project.default_branch]);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  const parsed = parseOwnerRepo(scope.project.repo_url);
  const repoSlug = parsed ? `${parsed.owner}/${parsed.repo}` : null;

  if (status?.error) {
    return (
      <Card>
        <CardHeader title="GitHub Repository" />
        <div className="p-6 flex items-center gap-3 text-amber-400">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <div>
            <div className="text-sm font-medium">{status.error}</div>
            <div className="text-xs text-slate-500 mt-1">
              {!parsed
                ? 'Set a GitHub repo URL in the Overview tab.'
                : 'Ensure your GitHub OAuth token has the correct scopes.'}
            </div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="GitHub Repository"
          action={
            <div className="flex items-center gap-3">
              {status?.fetchedAt && (
                <span className="text-[10px] text-slate-600">
                  {new Date(status.fetchedAt).toLocaleTimeString()}
                </span>
              )}
              <Button variant="ghost" onClick={load} disabled={loading}>
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              {repoSlug && (
                <a
                  href={`https://github.com/${repoSlug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          }
        />
        <div className="p-5 grid grid-cols-2 gap-4">
          {/* Open Issues */}
          <MetricCard
            icon={<CircleDot className="w-4 h-4 text-emerald-400" />}
            label="Open Issues"
            value={status?.openIssues}
            loading={loading && !status}
            href={repoSlug ? `https://github.com/${repoSlug}/issues` : undefined}
          />

          {/* Open PRs */}
          <MetricCard
            icon={<GitPullRequest className="w-4 h-4 text-blue-400" />}
            label="Open Pull Requests"
            value={status?.openPRs}
            loading={loading && !status}
            href={repoSlug ? `https://github.com/${repoSlug}/pulls` : undefined}
          />

          {/* CI/CD Status */}
          <CICard run={status?.latestRun ?? null} loading={loading && !status} repoSlug={repoSlug} />

          {/* Branch Protection */}
          <ProtectionCard
            branchProtected={status?.branchProtected ?? null}
            branch={scope.project.default_branch || 'main'}
            loading={loading && !status}
            repoSlug={repoSlug}
          />
        </div>
      </Card>
    </div>
  );
}

function MetricCard({
  icon, label, value, loading, href,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null | undefined;
  loading: boolean;
  href?: string;
}) {
  const content = (
    <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 flex items-center gap-4 group hover:border-slate-700 transition-colors">
      <div className="shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-0.5">{label}</div>
        {loading ? (
          <div className="h-6 w-12 bg-slate-800 rounded animate-pulse" />
        ) : (
          <div className="text-2xl font-semibold text-slate-100 tabular-nums">
            {value ?? '—'}
          </div>
        )}
      </div>
      {href && (
        <ExternalLink className="w-3 h-3 text-slate-700 group-hover:text-slate-500 ml-auto shrink-0 transition-colors" />
      )}
    </div>
  );

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="block">
        {content}
      </a>
    );
  }
  return content;
}

function CICard({
  run, loading, repoSlug: _repoSlug,
}: {
  run: GitHubRepoStatus['latestRun'];
  loading: boolean;
  repoSlug: string | null;
}) {
  const conclusionBadge = (conclusion: string | null, status: string) => {
    if (status === 'in_progress' || status === 'queued' || status === 'waiting') {
      return <Badge tone="amber">running</Badge>;
    }
    switch (conclusion) {
      case 'success': return <Badge tone="emerald">passed</Badge>;
      case 'failure': return <Badge tone="rose">failed</Badge>;
      case 'cancelled': return <Badge tone="slate">cancelled</Badge>;
      case 'skipped': return <Badge tone="slate">skipped</Badge>;
      case 'timed_out': return <Badge tone="rose">timed out</Badge>;
      default: return <Badge tone="slate">{conclusion || status}</Badge>;
    }
  };

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <Activity className="w-4 h-4 text-amber-400" />
        <span className="text-[11px] uppercase tracking-wider text-slate-500">Latest CI/CD</span>
      </div>
      {loading ? (
        <div className="h-6 w-24 bg-slate-800 rounded animate-pulse" />
      ) : run ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            {conclusionBadge(run.conclusion, run.status)}
            <span className="text-xs text-slate-400 truncate">{run.name}</span>
          </div>
          <div className="text-[11px] text-slate-600">
            #{run.run_number} on {run.head_branch} &middot; {run.event}
          </div>
          {run.html_url && (
            <a
              href={run.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-slate-600 hover:text-slate-400 flex items-center gap-1 transition-colors"
            >
              View run <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
        </div>
      ) : (
        <div className="text-sm text-slate-600">No workflow runs found</div>
      )}
    </div>
  );
}

function ProtectionCard({
  branchProtected, branch, loading, repoSlug,
}: {
  branchProtected: boolean | null;
  branch: string;
  loading: boolean;
  repoSlug: string | null;
}) {
  const badge = () => {
    if (branchProtected === true) return <Badge tone="emerald">protected</Badge>;
    if (branchProtected === false) return <Badge tone="rose">unprotected</Badge>;
    return <Badge tone="slate">unknown</Badge>;
  };

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <Shield className="w-4 h-4 text-blue-400" />
        <span className="text-[11px] uppercase tracking-wider text-slate-500">Branch Protection</span>
      </div>
      {loading ? (
        <div className="h-6 w-24 bg-slate-800 rounded animate-pulse" />
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            {badge()}
            <span className="text-xs text-slate-400 font-mono">{branch}</span>
          </div>
          {branchProtected === null && (
            <div className="text-[11px] text-slate-600">
              Requires admin access to check
            </div>
          )}
          {repoSlug && (
            <a
              href={`https://github.com/${repoSlug}/settings/branches`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-slate-600 hover:text-slate-400 flex items-center gap-1 transition-colors"
            >
              Branch settings <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
