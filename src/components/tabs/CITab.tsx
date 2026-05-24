import { ExternalLink, CheckCircle2, XCircle, Loader2, Clock, CircleDot, Ban, GitBranch, RefreshCw } from 'lucide-react';
import type { ProjectScope, GitHubWorkflowRun } from '../../lib/types';
import { useGitHubWorkflows } from '../../lib/useGitHubWorkflows';
import { getActionsUrl } from '../../lib/github';
import { Card, CardHeader, Badge } from '../ui';

function statusIcon(run: GitHubWorkflowRun) {
  if (run.status !== 'completed') {
    return <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />;
  }
  switch (run.conclusion) {
    case 'success': return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
    case 'failure': return <XCircle className="w-4 h-4 text-rose-400" />;
    case 'cancelled': return <Ban className="w-4 h-4 text-slate-500" />;
    case 'timed_out': return <Clock className="w-4 h-4 text-amber-400" />;
    default: return <CircleDot className="w-4 h-4 text-slate-500" />;
  }
}

function statusBadge(run: GitHubWorkflowRun) {
  if (run.status !== 'completed') {
    return <Badge tone="amber">{run.status.replace('_', ' ')}</Badge>;
  }
  switch (run.conclusion) {
    case 'success': return <Badge tone="emerald">success</Badge>;
    case 'failure': return <Badge tone="rose">failure</Badge>;
    case 'cancelled': return <Badge tone="slate">cancelled</Badge>;
    case 'timed_out': return <Badge tone="amber">timed out</Badge>;
    default: return <Badge tone="slate">{run.conclusion || 'unknown'}</Badge>;
  }
}

function formatDuration(run: GitHubWorkflowRun): string | null {
  if (!run.run_started_at || run.status !== 'completed') return null;
  const start = new Date(run.run_started_at).getTime();
  const end = new Date(run.updated_at).getTime();
  const secs = Math.round((end - start) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m ${rem}s`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function CITab({ scope }: { scope: ProjectScope }) {
  const { runs, loading } = useGitHubWorkflows(scope.project.repo_url);
  const actionsUrl = getActionsUrl(scope.project.repo_url);

  if (!scope.project.repo_url || !scope.project.repo_url.includes('github.com')) {
    return (
      <Card>
        <div className="px-5 py-8 text-center text-sm text-slate-500">
          CI status requires a GitHub repository URL on this project.
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="GitHub Actions"
          action={
            <div className="flex items-center gap-2">
              {loading && <RefreshCw className="w-3.5 h-3.5 text-slate-500 animate-spin" />}
              {actionsUrl && (
                <a
                  href={actionsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <ExternalLink className="w-3 h-3" /> Actions
                </a>
              )}
            </div>
          }
        />
        {runs.length === 0 && !loading ? (
          <div className="px-5 py-8 text-center text-sm text-slate-500">
            No workflow runs found. Ensure this repo has GitHub Actions workflows configured.
          </div>
        ) : runs.length === 0 && loading ? (
          <div className="px-5 py-8 text-center text-sm text-slate-500 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading workflow runs...
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {runs.map(run => {
              const duration = formatDuration(run);
              return (
                <div key={run.id} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-800/30 transition-colors">
                  {/* Status icon */}
                  <div className="shrink-0">{statusIcon(run)}</div>

                  {/* Workflow name + run number */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-100 truncate">{run.name}</span>
                      <span className="text-[11px] text-slate-600 font-mono">#{run.run_number}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="flex items-center gap-1 text-[11px] text-slate-500">
                        <GitBranch className="w-3 h-3" />{run.head_branch}
                      </span>
                      <span className="text-[11px] text-slate-600">{run.event}</span>
                      <span className="text-[11px] text-slate-600">{formatTime(run.created_at)}</span>
                      {duration && <span className="text-[11px] text-slate-600">{duration}</span>}
                    </div>
                  </div>

                  {/* Status badge */}
                  <div className="shrink-0">{statusBadge(run)}</div>

                  {/* Link to run */}
                  <a
                    href={run.html_url}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-slate-600 hover:text-slate-300 transition-colors"
                    title="View on GitHub"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      <p className="text-[11px] text-slate-600 text-center">Polls every 30 seconds. Showing latest run per workflow.</p>
    </div>
  );
}
