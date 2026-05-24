import type { Project } from './types';

/** Normalize a filesystem path for comparison (Windows-safe). */
export function normalizeRepoPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** Find a Cockpit project whose repo_path matches the picked folder. */
export function findProjectByRepoPath(projects: Project[], folderPath: string): Project | undefined {
  const active = projects.filter(p => p.status !== 'archived' && p.repo_path);
  const target = normalizeRepoPath(folderPath);

  const exact = active.find(p => normalizeRepoPath(p.repo_path) === target);
  if (exact) return exact;

  const inside = active.filter(p => isPathInside(folderPath, p.repo_path));
  if (inside.length === 1) return inside[0];

  const parent = active.filter(p => isPathInside(p.repo_path, folderPath));
  if (parent.length === 1) return parent[0];

  return undefined;
}

/** True if `child` is inside `parent` (or equal). */
export function isPathInside(parentPath: string, childPath: string): boolean {
  const parent = normalizeRepoPath(parentPath);
  const child = normalizeRepoPath(childPath);
  return child === parent || child.startsWith(`${parent}/`);
}
