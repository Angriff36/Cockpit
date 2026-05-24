import { useCallback, useEffect, useState } from 'react';
import type { PortConflict } from './types';
import { detectPortConflicts } from './api';

/**
 * Fetches cross-project port conflicts and exposes them.
 * Re-fetches when `refreshKey` changes (e.g. after a port is added/removed).
 */
export function usePortConflicts(refreshKey?: unknown): {
  conflicts: PortConflict[];
  loading: boolean;
  refresh: () => void;
} {
  const [conflicts, setConflicts] = useState<PortConflict[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    detectPortConflicts()
      .then(c => { if (!cancelled) setConflicts(c); })
      .catch(() => { if (!cancelled) setConflicts([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tick, refreshKey]);

  return { conflicts, loading, refresh };
}
