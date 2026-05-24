import { getGitHubToken } from './api';
import type { GitHubIssue, GitHubPullRequest, GitHubRepoStatus, GitHubWorkflow, GitHubWorkflowRun } from './types';

const GITHUB_API = 'https://api.github.com';

/**
 * Extract owner/repo from a GitHub repo URL.
 * Handles https://github.com/owner/repo(.git) and git@github.com:owner/repo(.git)
 */
export function parseOwnerRepo(repoUrl: string): { owner: string; repo: string } | null {
  // HTTPS format
  let m = repoUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (m) return { owner: m[1], repo: m[2] };
  // SSH format
  m = repoUrl.match(/github\.com:([^/]+)\/([^/.]+)/);
  if (m) return { owner: m[1], repo: m[2] };
  return null;
}

/**
 * Fetch the latest workflow runs for a repository, deduplicated to the most
 * recent run per workflow name.
 */
export async function fetchWorkflowRuns(
  repoUrl: string,
): Promise<GitHubWorkflowRun[]> {
  const parsed = parseOwnerRepo(repoUrl);
  if (!parsed) return [];

  const token = await getGitHubToken();
  if (!token?.access_token) return [];

  const res = await fetch(
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/actions/runs?per_page=50`,
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: 'application/vnd.github+json',
      },
    },
  );

  if (!res.ok) return [];

  const json = await res.json();
  const runs: GitHubWorkflowRun[] = (json.workflow_runs || []).map((r: any) => ({
    id: r.id,
    name: r.name,
    workflow_id: r.workflow_id,
    head_branch: r.head_branch,
    head_sha: r.head_sha,
    status: r.status,
    conclusion: r.conclusion,
    html_url: r.html_url,
    created_at: r.created_at,
    updated_at: r.updated_at,
    run_started_at: r.run_started_at,
    run_number: r.run_number,
    event: r.event,
  }));

  // Deduplicate: keep only the latest run per workflow name
  const seen = new Map<string, GitHubWorkflowRun>();
  for (const run of runs) {
    if (!seen.has(run.name)) {
      seen.set(run.name, run);
    }
  }

  return Array.from(seen.values());
}

/**
 * Build the GitHub Actions tab URL for a repo.
 */
export function getActionsUrl(repoUrl: string): string | null {
  const parsed = parseOwnerRepo(repoUrl);
  if (!parsed) return null;
  return `https://github.com/${parsed.owner}/${parsed.repo}/actions`;
}

// ── Repo Status Metrics ────────────────────────────────────────────────────

async function ghFetch<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json();
}

export async function fetchOpenIssuesCount(
  owner: string,
  repo: string,
  token: string,
): Promise<number> {
  const data = await ghFetch<{ total_count: number }>(
    `/search/issues?q=repo:${owner}/${repo}+type:issue+state:open&per_page=1`,
    token,
  );
  return data.total_count;
}

export async function fetchOpenPRsCount(
  owner: string,
  repo: string,
  token: string,
): Promise<number> {
  const data = await ghFetch<{ total_count: number }>(
    `/search/issues?q=repo:${owner}/${repo}+type:pr+state:open&per_page=1`,
    token,
  );
  return data.total_count;
}

export async function fetchLatestWorkflowRun(
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<GitHubWorkflowRun | null> {
  const data = await ghFetch<{ workflow_runs: GitHubWorkflowRun[] }>(
    `/repos/${owner}/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=1`,
    token,
  );
  return data.workflow_runs[0] ?? null;
}

export async function fetchBranchProtection(
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<boolean | null> {
  try {
    await ghFetch<unknown>(
      `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}/protection`,
      token,
    );
    return true;
  } catch (err: any) {
    if (err.message?.includes('404')) return false;
    if (err.message?.includes('403')) return null;
    throw err;
  }
}

/**
 * Fetch all GitHub repo status metrics in parallel.
 */
export async function fetchRepoStatus(
  repoUrl: string,
  defaultBranch: string,
): Promise<GitHubRepoStatus> {
  const parsed = parseOwnerRepo(repoUrl);
  if (!parsed) {
    return {
      openIssues: null, openPRs: null, latestRun: null,
      branchProtected: null,
      error: 'Not a GitHub repository URL',
      fetchedAt: new Date().toISOString(),
    };
  }

  const ghToken = await getGitHubToken();
  if (!ghToken?.access_token) {
    return {
      openIssues: null, openPRs: null, latestRun: null,
      branchProtected: null,
      error: 'GitHub not connected. Connect via sidebar.',
      fetchedAt: new Date().toISOString(),
    };
  }

  const { owner, repo } = parsed;
  const branch = defaultBranch || 'main';
  const token = ghToken.access_token;

  const [issues, prs, run, protection] = await Promise.allSettled([
    fetchOpenIssuesCount(owner, repo, token),
    fetchOpenPRsCount(owner, repo, token),
    fetchLatestWorkflowRun(owner, repo, branch, token),
    fetchBranchProtection(owner, repo, branch, token),
  ]);

  return {
    openIssues: issues.status === 'fulfilled' ? issues.value : null,
    openPRs: prs.status === 'fulfilled' ? prs.value : null,
    latestRun: run.status === 'fulfilled' ? run.value : null,
    branchProtected: protection.status === 'fulfilled' ? protection.value : null,
    error: null,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Fetch open issues for a repository with pagination support.
 */
export async function fetchOpenIssues(
  repoUrl: string,
  page = 1,
  perPage = 30,
  label?: string,
): Promise<{ issues: GitHubIssue[]; totalCount: number }> {
  const parsed = parseOwnerRepo(repoUrl);
  if (!parsed) return { issues: [], totalCount: 0 };

  const token = await getGitHubToken();
  if (!token?.access_token) return { issues: [], totalCount: 0 };

  let query = `repo:${parsed.owner}/${parsed.repo}+type:issue+state:open`;
  if (label) query += `+label:"${label}"`;

  const res = await fetch(
    `${GITHUB_API}/search/issues?q=${query}&per_page=${perPage}&page=${page}&sort=updated&order=desc`,
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );

  if (!res.ok) return { issues: [], totalCount: 0 };

  const json = await res.json();
  const issues: GitHubIssue[] = (json.items || []).map((item: any) => ({
    id: item.id,
    number: item.number,
    title: item.title,
    html_url: item.html_url,
    state: item.state,
    labels: (item.labels || []).map((l: any) => ({
      id: l.id,
      name: l.name,
      color: l.color,
      description: l.description ?? null,
    })),
    assignees: (item.assignees || []).map((a: any) => ({
      id: a.id,
      login: a.login,
      avatar_url: a.avatar_url,
    })),
    milestone: item.milestone
      ? { id: item.milestone.id, title: item.milestone.title, html_url: item.milestone.html_url }
      : null,
    created_at: item.created_at,
    updated_at: item.updated_at,
    comments: item.comments,
    user: { login: item.user?.login ?? '', avatar_url: item.user?.avatar_url ?? '' },
  }));

  return { issues, totalCount: json.total_count ?? 0 };
}

/**
 * Fetch open pull requests for a repository.
 * Returns PR details including draft/merge status and head SHA for CI lookups.
 */
export async function fetchOpenPullRequests(
  repoUrl: string,
  page = 1,
  perPage = 30,
  label?: string,
  author?: string,
): Promise<{ pullRequests: GitHubPullRequest[]; totalCount: number }> {
  const parsed = parseOwnerRepo(repoUrl);
  if (!parsed) return { pullRequests: [], totalCount: 0 };

  const token = await getGitHubToken();
  if (!token?.access_token) return { pullRequests: [], totalCount: 0 };

  let query = `repo:${parsed.owner}/${parsed.repo}+type:pr+state:open`;
  if (label) query += `+label:"${label}"`;
  if (author) query += `+author:${author}`;

  const res = await fetch(
    `${GITHUB_API}/search/issues?q=${query}&per_page=${perPage}&page=${page}&sort=updated&order=desc`,
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );

  if (!res.ok) return { pullRequests: [], totalCount: 0 };

  const json = await res.json();
  const pullRequests: GitHubPullRequest[] = (json.items || []).map((item: any) => ({
    id: item.id,
    number: item.number,
    title: item.title,
    html_url: item.html_url,
    state: item.state,
    draft: item.draft ?? false,
    merged: item.pull_request?.merged_at != null,
    labels: (item.labels || []).map((l: any) => ({
      id: l.id,
      name: l.name,
      color: l.color,
      description: l.description ?? null,
    })),
    assignees: (item.assignees || []).map((a: any) => ({
      id: a.id,
      login: a.login,
      avatar_url: a.avatar_url,
    })),
    milestone: item.milestone
      ? { id: item.milestone.id, title: item.milestone.title, html_url: item.milestone.html_url }
      : null,
    user: { login: item.user?.login ?? '', avatar_url: item.user?.avatar_url ?? '' },
    created_at: item.created_at,
    updated_at: item.updated_at,
    comments: item.comments,
    head_sha: item.pull_request?.head?.sha ?? '',
  }));

  return { pullRequests, totalCount: json.total_count ?? 0 };
}

// ── Workflow dispatch (deploy via GitHub Actions) ─────────────────────────

export async function fetchRepoWorkflows(repoUrl: string): Promise<GitHubWorkflow[]> {
  const parsed = parseOwnerRepo(repoUrl);
  if (!parsed) return [];

  const token = await getGitHubToken();
  if (!token?.access_token) throw new Error('GitHub not connected. Connect via the sidebar.');

  const data = await ghFetch<{ workflows: Array<{ id: number; name: string; path: string; state: string }> }>(
    `/repos/${parsed.owner}/${parsed.repo}/actions/workflows?per_page=100`,
    token.access_token,
  );

  return (data.workflows || [])
    .filter(w => w.state === 'active')
    .map(w => ({ id: w.id, name: w.name, path: w.path, state: w.state }));
}

export function pickDeployWorkflow(
  workflows: GitHubWorkflow[],
  hints: { platform?: string; workflowFile?: string } = {},
): GitHubWorkflow | null {
  if (hints.workflowFile?.trim()) {
    const file = hints.workflowFile.trim().replace(/^\//, '');
    const match = workflows.find(w =>
      w.path === file
      || w.path.endsWith(`/${file}`)
      || w.path === `.github/workflows/${file}`,
    );
    if (match) return match;
  }

  const scored = workflows
    .map(w => {
      const hay = `${w.name} ${w.path}`.toLowerCase();
      let score = 0;
      if (hints.platform === 'vercel' && hay.includes('vercel')) score += 20;
      if (hay.includes('deploy')) score += 10;
      if (hay.includes('production') || hay.includes('prod')) score += 8;
      if (hay.includes('preview')) score -= 5;
      if (hay.includes('test') || hay.includes('ci')) score -= 3;
      return { w, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.w ?? null;
}

export async function dispatchWorkflow(
  repoUrl: string,
  workflowId: number,
  ref: string,
  inputs: Record<string, string> = {},
): Promise<void> {
  const parsed = parseOwnerRepo(repoUrl);
  if (!parsed) throw new Error('Not a GitHub repository URL');

  const token = await getGitHubToken();
  if (!token?.access_token) throw new Error('GitHub not connected. Connect via the sidebar.');

  const res = await fetch(
    `${GITHUB_API}/repos/${parsed.owner}/${parsed.repo}/actions/workflows/${workflowId}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref, inputs }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 422) {
      throw new Error(
        'This workflow cannot be dispatched. Add workflow_dispatch to .github/workflows/your-file.yml.',
      );
    }
    if (res.status === 403) {
      throw new Error('GitHub token lacks workflow permission. Reconnect GitHub with repo + workflow scopes.');
    }
    throw new Error(`GitHub Actions dispatch failed (${res.status}): ${body.slice(0, 200)}`);
  }
}

export async function fetchLatestWorkflowRunForWorkflow(
  repoUrl: string,
  workflowId: number,
  branch?: string,
): Promise<GitHubWorkflowRun | null> {
  const parsed = parseOwnerRepo(repoUrl);
  if (!parsed) return null;

  const token = await getGitHubToken();
  if (!token?.access_token) return null;

  const params = new URLSearchParams({ per_page: '5' });
  if (branch) params.set('branch', branch);

  const data = await ghFetch<{ workflow_runs: GitHubWorkflowRun[] }>(
    `/repos/${parsed.owner}/${parsed.repo}/actions/workflows/${workflowId}/runs?${params}`,
    token.access_token,
  );

  return data.workflow_runs?.[0] ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function waitForDispatchedRun(
  repoUrl: string,
  workflowId: number,
  branch: string,
  dispatchedAfter: Date,
  timeoutMs = 30000,
): Promise<GitHubWorkflowRun | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(2000);
    const run = await fetchLatestWorkflowRunForWorkflow(repoUrl, workflowId, branch);
    if (run && new Date(run.created_at) >= dispatchedAfter) return run;
  }
  return null;
}
