import { watch, existsSync } from 'fs';
import { join, basename } from 'path';

// Files that trigger a sync when changed
const WATCH_FILES = [
  'package.json',
  '.env', '.env.local', '.env.example', '.env.development',
  'vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs',
  'astro.config.mjs', 'astro.config.ts', 'astro.config.js',
  'nuxt.config.ts', 'nuxt.config.js',
  'angular.json',
  'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml',
  'Dockerfile',
  'vercel.json',
  'fly.toml',
  'render.yaml', 'render.yml',
  'railway.toml', 'railway.json',
];

/**
 * Start watching the given directory for changes to tracked files.
 * Calls `onSync()` (debounced) when a relevant file changes.
 *
 * @param {string} cwd - Directory to watch
 * @param {(filename: string) => Promise<void>} onSync - Callback when sync should run
 * @param {object} opts
 * @param {number} opts.debounceMs - Debounce interval in ms (default 1500)
 * @param {(msg: string) => void} opts.log - Log function
 * @returns {{ close: () => void }} - Call close() to stop watching
 */
export function startWatch(cwd, onSync, opts = {}) {
  const debounceMs = opts.debounceMs || 1500;
  const log = opts.log || (() => {});

  const watchers = [];
  let debounceTimer = null;
  let syncing = false;
  let pendingFile = null;

  function scheduleSync(filename) {
    if (debounceTimer) clearTimeout(debounceTimer);
    pendingFile = filename;
    debounceTimer = setTimeout(async () => {
      if (syncing) return;
      syncing = true;
      const file = pendingFile;
      pendingFile = null;
      try {
        await onSync(file);
      } catch (e) {
        log(`sync error: ${e.message}`);
      } finally {
        syncing = false;
        // If another change queued while syncing, run again
        if (pendingFile) scheduleSync(pendingFile);
      }
    }, debounceMs);
  }

  // Watch each file that exists
  const tracked = new Set();
  for (const file of WATCH_FILES) {
    const fullPath = join(cwd, file);
    if (!existsSync(fullPath)) continue;
    if (tracked.has(file)) continue;
    tracked.add(file);

    try {
      const watcher = watch(fullPath, (eventType) => {
        if (eventType === 'change' || eventType === 'rename') {
          log(`detected change: ${file}`);
          scheduleSync(file);
        }
      });
      watchers.push(watcher);
    } catch {
      // File may have disappeared between existsSync and watch
    }
  }

  // Also watch the directory itself for new files appearing
  try {
    const dirWatcher = watch(cwd, (eventType, filename) => {
      if (!filename) return;
      const base = basename(filename);
      if (WATCH_FILES.includes(base) && !tracked.has(base)) {
        log(`new file appeared: ${base}`);
        tracked.add(base);
        scheduleSync(base);
      }
    });
    watchers.push(dirWatcher);
  } catch {
    // Directory watch not supported on all platforms — non-fatal
  }

  return {
    fileCount: tracked.size,
    close() {
      if (debounceTimer) clearTimeout(debounceTimer);
      for (const w of watchers) {
        try { w.close(); } catch {}
      }
      watchers.length = 0;
    },
  };
}
