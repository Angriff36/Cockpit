import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { RefreshCw, ExternalLink, CircleDot, Filter, ChevronLeft, ChevronRight, MessageSquare, AlertCircle } from 'lucide-react';
import type { ProjectScope, GitHubIssue } from '../../lib/types';
import { fetchOpenIssues, parseOwnerRepo } from '../../lib/github';
import { Card, CardHeader, Button } from '../ui';

const PER_PAGE = 30;
const REFRESH_INTERVAL_MS = 120_000;

export function IssuesTab({ scope }: { scope: ProjectScope }) {
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [page, setPage] = useState(1);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);

  const parsed = parseOwnerRepo(scope.project.repo_url);

  const load = useCallback(async () => {
    if (!parsed) return;
    setLoading(true);
    try {
      const result = await fetchOpenIssues(
        scope.project.repo_url,
        page,
        PER_PAGE,
        activeLabel ?? undefined,
      );
      setIssues(result.issues);
      setTotalCount(result.totalCount);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [scope.project.repo_url, page, activeLabel, parsed]);

  const loadRef = useRef(load);
  loadRef.current = load;

  // Fetch immediately when filters (page, label) change
  useEffect(() => { load(); }, [load]);

  // Periodic background refresh — timer never restarts on filter changes
  useEffect(() => {
    const id = setInterval(() => loadRef.current(), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Extract unique labels from loaded issues for the filter bar
  const allLabels = useMemo(() => {
    const labelMap = new Map<string, { name: string; color: string }>();
    for (const issue of issues) {
      for (const label of issue.labels) {
        if (!labelMap.has(label.name)) {
          labelMap.set(label.name, { name: label.name, color: label.color });
        }
      }
    }
    return Array.from(labelMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [issues]);

  // Group issues by milestone
  const grouped = useMemo(() => {
    const groups = new Map<string, { milestone: { id: number; title: string; html_url: string } | null; issues: GitHubIssue[] }>();
    // "No milestone" group
    groups.set('__none__', { milestone: null, issues: [] });

    for (const issue of issues) {
      const key = issue.milestone ? String(issue.milestone.id) : '__none__';
      if (!groups.has(key)) {
        groups.set(key, { milestone: issue.milestone, issues: [] });
      }
      groups.get(key)!.issues.push(issue);
    }

    // Remove empty "no milestone" group
    if (groups.get('__none__')!.issues.length === 0) {
      groups.delete('__none__');
    }

    return Array.from(groups.values());
  }, [issues]);

  const totalPages = Math.ceil(totalCount / PER_PAGE);
  const repoSlug = parsed ? `${parsed.owner}/${parsed.repo}` : null;

  if (!parsed) {
    return (
      <Card>
        <CardHeader title="Issues" />
        <div className="p-6 text-slate-500 text-sm">
          Set a GitHub repo URL in the Overview tab to view issues.
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={`Issues${totalCount > 0 ? ` (${totalCount})` : ''}`}
          action={
            <div className="flex items-center gap-3">
              {repoSlug && (
                <a
                  href={`https://github.com/${repoSlug}/issues`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              <Button variant="ghost" onClick={load} disabled={loading}>
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          }
        />

        {/* Label filter bar */}
        {allLabels.length > 1 && (
          <div className="px-5 py-2.5 border-b border-slate-800 flex items-center gap-2 flex-wrap">
            <Filter className="w-3 h-3 text-slate-500 shrink-0" />
            <button
              onClick={() => { setActiveLabel(null); setPage(1); }}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                activeLabel === null
                  ? 'border-slate-500 text-slate-200 bg-slate-800'
                  : 'border-slate-800 text-slate-500 hover:border-slate-600'
              }`}
            >
              all
            </button>
            {allLabels.map(label => (
              <button
                key={label.name}
                onClick={() => { setActiveLabel(activeLabel === label.name ? null : label.name); setPage(1); }}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                  activeLabel === label.name
                    ? 'border-slate-500 text-slate-200 bg-slate-800'
                    : 'border-slate-800 text-slate-500 hover:border-slate-600'
                }`}
              >
                <span
                  className="inline-block w-2 h-2 rounded-full mr-1 align-middle"
                  style={{ backgroundColor: `#${label.color}` }}
                />
                {label.name}
              </button>
            ))}
          </div>
        )}

        {/* Issue list */}
        <div className="divide-y divide-slate-800/50">
          {loading && issues.length === 0 ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-4 w-4 bg-slate-800 rounded animate-pulse shrink-0" />
                  <div className="h-4 flex-1 bg-slate-800 rounded animate-pulse" />
                </div>
              ))}
            </div>
          ) : loadError && issues.length === 0 ? (
            <div className="p-6 flex items-center gap-3 text-amber-400">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <div>
                <div className="text-sm font-medium">Failed to load issues</div>
                <div className="text-xs text-slate-500 mt-0.5">Check your GitHub OAuth token has the correct scopes.</div>
              </div>
            </div>
          ) : issues.length === 0 ? (
            <div className="p-6 text-slate-500 text-sm">
              {activeLabel ? `No open issues with label "${activeLabel}"` : 'No open issues'}
            </div>
          ) : (
            grouped.map(group => (
              <div key={group.milestone ? group.milestone.id : '__none__'}>
                {group.milestone && grouped.length > 1 && (
                  <div className="px-5 py-2 bg-slate-950/50 border-b border-slate-800/30">
                    <a
                      href={group.milestone.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-1.5"
                    >
                      <span className="inline-block w-2 h-2 rounded-full bg-emerald-500/60" />
                      {group.milestone.title}
                      <span className="text-slate-600">({group.issues.length})</span>
                    </a>
                  </div>
                )}
                {group.issues.map(issue => (
                  <IssueRow key={issue.id} issue={issue} />
                ))}
              </div>
            ))
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-slate-800 flex items-center justify-between">
            <span className="text-[11px] text-slate-600">
              Page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function IssueRow({ issue }: { issue: GitHubIssue }) {
  return (
    <a
      href={issue.html_url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-3 px-5 py-3 hover:bg-slate-800/30 transition-colors group"
    >
      <CircleDot className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2 flex-wrap">
          <span className="text-sm text-slate-200 group-hover:text-emerald-300 transition-colors leading-snug">
            {issue.title}
          </span>
          {issue.labels.map(label => (
            <span
              key={label.id}
              className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full border shrink-0"
              style={{
                borderColor: `#${label.color}40`,
                backgroundColor: `#${label.color}15`,
                color: `#${label.color}`,
              }}
            >
              {label.name}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-600">
          <span>#{issue.number}</span>
          <span>opened by {issue.user.login}</span>
          <span>{timeAgo(issue.created_at)}</span>
          {issue.comments > 0 && (
            <span className="flex items-center gap-0.5">
              <MessageSquare className="w-3 h-3" />
              {issue.comments}
            </span>
          )}
          {issue.assignees.length > 0 && (
            <div className="flex items-center -space-x-1">
              {issue.assignees.slice(0, 3).map(a => (
                <img
                  key={a.id}
                  src={a.avatar_url}
                  alt={a.login}
                  title={a.login}
                  className="w-4 h-4 rounded-full border border-slate-900"
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <ExternalLink className="w-3 h-3 text-slate-700 group-hover:text-slate-500 mt-1 shrink-0 transition-colors" />
    </a>
  );
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
