import { openDB, type IDBPDatabase } from 'idb';
import type { Project, ProjectScope } from './types';

const DB_NAME = 'cockpit-cache';
const DB_VERSION = 1;

// How long cached data is considered "fresh" (5 minutes)
const FRESH_MS = 5 * 60 * 1000;

interface CacheEntry<T> {
  key: string;
  data: T;
  cachedAt: number; // epoch ms
}

type CockpitDB = {
  projects: { key: string; value: CacheEntry<Project[]> };
  scopes: { key: string; value: CacheEntry<ProjectScope> };
};

let dbPromise: Promise<IDBPDatabase<CockpitDB>> | null = null;

function getDB(): Promise<IDBPDatabase<CockpitDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CockpitDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('scopes')) {
          db.createObjectStore('scopes', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

// ── Projects cache ──────────────────────────────────────────────────────────

export async function cacheProjects(projects: Project[]): Promise<void> {
  const db = await getDB();
  await db.put('projects', { key: 'all', data: projects, cachedAt: Date.now() });
}

export async function getCachedProjects(): Promise<CacheEntry<Project[]> | undefined> {
  const db = await getDB();
  return db.get('projects', 'all');
}

// ── ProjectScope cache ──────────────────────────────────────────────────────

export async function cacheScope(slug: string, scope: ProjectScope): Promise<void> {
  const db = await getDB();
  await db.put('scopes', { key: slug, data: scope, cachedAt: Date.now() });
}

export async function getCachedScope(slug: string): Promise<CacheEntry<ProjectScope> | undefined> {
  const db = await getDB();
  return db.get('scopes', slug);
}

// ── Staleness helpers ───────────────────────────────────────────────────────

export function isFresh(cachedAt: number): boolean {
  return Date.now() - cachedAt < FRESH_MS;
}

export function formatAge(cachedAt: number): string {
  const diff = Date.now() - cachedAt;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Cache clear ─────────────────────────────────────────────────────────────

export async function clearCache(): Promise<void> {
  const db = await getDB();
  await db.clear('projects');
  await db.clear('scopes');
}
