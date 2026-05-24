import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_DIR = join(homedir(), '.ldc');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export function loadConfig() {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export function saveConfig(cfg) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

export function getClient() {
  const cfg = loadConfig();
  if (!cfg) {
    console.error('\x1b[31mNot logged in. Run: ldc login\x1b[0m');
    process.exit(1);
  }
  const sb = createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Restore the stored session so RLS policies pass
  sb.auth.setSession({ access_token: cfg.accessToken, refresh_token: cfg.refreshToken });
  return sb;
}

// Read/write the per-project .ldc marker file
export function readMarker(cwd = process.cwd()) {
  const file = join(cwd, '.ldc');
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

export function writeMarker(cwd, slug) {
  writeFileSync(join(cwd, '.ldc'), JSON.stringify({ slug }, null, 2));
}

// Resolve slug: from .ldc file, or die with helpful message
export function requireSlug(opts = {}) {
  if (opts.slug) return opts.slug;
  const marker = readMarker();
  if (marker?.slug) return marker.slug;
  console.error('\x1b[31mNo project linked. Run `ldc init` first, or pass --slug <slug>.\x1b[0m');
  process.exit(1);
}
