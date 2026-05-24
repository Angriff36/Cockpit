import { useEffect, useState } from 'react';
import type { GitHubWorkflowRun } from './types';
import { fetchWorkflowRuns } from './github';

const POLL_INTERVAL = 30_000;

type Subscriber = (runs: GitHubWorkflowRun[], error: boolean) => void;
type CacheEntry = {
  runs: GitHubWorkflowRun[];
  error: boolean;
  subscribers: Set<Subscriber>;
  timer: ReturnType<typeof setInterval>;
};

// Module-level deduplication: one poll timer per unique repo URL
const cache = new Map<string, CacheEntry>();

async function pollForUrl(url: string) {
  const entry = cache.get(url);
  if (!entry) return;
  try {
    const data = await fetchWorkflowRuns(url);
    entry.runs = data;
    entry.error = false;
    entry.subscribers.forEach(fn => fn(data, false));
  } catch {
    entry.error = true;
    entry.subscribers.forEach(fn => fn(entry.runs, true));
  }
}

function subscribe(url: string, fn: Subscriber): () => void {
  let entry = cache.get(url);
  if (!entry) {
    entry = {
      runs: [],
      error: false,
      subscribers: new Set(),
      timer: setInterval(() => pollForUrl(url), POLL_INTERVAL),
    };
    cache.set(url, entry);
    pollForUrl(url);
  }
  entry.subscribers.add(fn);
  fn(entry.runs, entry.error);

  return () => {
    const e = cache.get(url);
    if (!e) return;
    e.subscribers.delete(fn);
    if (e.subscribers.size === 0) {
      clearInterval(e.timer);
      cache.delete(url);
    }
  };
}

export function useGitHubWorkflows(repoUrl: string | undefined) {
  const [runs, setRuns] = useState<GitHubWorkflowRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!repoUrl || !repoUrl.includes('github.com')) {
      setRuns([]);
      setError(false);
      return;
    }

    setLoading(true);
    const unsubscribe = subscribe(repoUrl, (newRuns, hasError) => {
      setRuns(newRuns);
      setError(hasError);
      setLoading(false);
    });

    return unsubscribe;
  }, [repoUrl]);

  return { runs, loading, error };
}
