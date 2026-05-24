import { useEffect, useState } from 'react';
import type { Machine } from './types';
import { getCurrentMachine } from './api';

/**
 * Fetches and caches the current machine (is_current=true) for the session.
 * Re-fetches when `refreshKey` changes (e.g. after registering a new machine).
 */
export function useCurrentMachine(refreshKey?: unknown): Machine | null {
  const [machine, setMachine] = useState<Machine | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCurrentMachine()
      .then(m => { if (!cancelled) setMachine(m); })
      .catch(() => { if (!cancelled) setMachine(null); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  return machine;
}
