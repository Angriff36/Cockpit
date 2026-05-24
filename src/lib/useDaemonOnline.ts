import { useEffect, useState } from 'react';
import { checkHealth } from './daemon';

export function useDaemonOnline(): boolean {
  const [online, setOnline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try { await checkHealth(); if (!cancelled) setOnline(true); }
      catch { if (!cancelled) setOnline(false); }
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return online;
}
