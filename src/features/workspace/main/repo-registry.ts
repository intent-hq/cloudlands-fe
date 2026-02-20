/**
 * Repo Registry
 *
 * Persistent registry of known repositories.
 * Repos survive workspace deletion so they can be re-used later.
 * Uses electron-store for persistence across app restarts.
 */

import { Logger } from '../../../shared/logger';

const logger = new Logger({ category: 'RepoRegistry' });

export interface KnownRepo {
  /** Absolute path to the repository */
  path: string;
  /** Repository name (typically the folder name) */
  name: string;
  /** GitHub organization or user who owns this repository */
  owner?: string;
  /** ISO timestamp of when this repo was first added */
  addedAt: string;
  /** ISO timestamp of when this repo was last used (workspace created) */
  lastUsedAt: string;
}

const STORE_KEY = 'knownRepos';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let store: any = null;
let initPromise: Promise<void> | null = null;

/**
 * Initialize the repo registry store (call once during app startup)
 */
export async function initRepoRegistry(): Promise<void> {
  if (store) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const ElectronStore = (await import('electron-store')).default;
      store = new ElectronStore({ name: 'repo-registry' });
      logger.info('Repo registry initialized');
    } catch (error) {
      logger.error('Failed to initialize repo registry', error as Error);
    }
  })();
  return initPromise;
}

/**
 * Get all known repos, sorted by lastUsedAt descending
 */
export function getAllRepos(): KnownRepo[] {
  if (!store) {
    logger.warn('Repo registry not initialized');
    return [];
  }
  const repos: KnownRepo[] = store.get(STORE_KEY, []);
  return [...repos].sort(
    (a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime(),
  );
}

/**
 * Add or update a repo in the registry.
 * If a repo with the same path already exists, updates its lastUsedAt and metadata.
 */
export function addRepo(repo: { path: string; name: string; owner?: string }): void {
  if (!store) {
    logger.warn('Repo registry not initialized, cannot add repo', { path: repo.path });
    return;
  }

  const repos: KnownRepo[] = store.get(STORE_KEY, []);
  const now = new Date().toISOString();
  const existingIndex = repos.findIndex((r) => r.path === repo.path);

  if (existingIndex >= 0) {
    // Update existing entry
    repos[existingIndex] = {
      ...repos[existingIndex],
      name: repo.name || repos[existingIndex].name,
      owner: repo.owner ?? repos[existingIndex].owner,
      lastUsedAt: now,
    };
    logger.debug('Updated existing repo in registry', { path: repo.path });
  } else {
    // Add new entry
    repos.push({
      path: repo.path,
      name: repo.name,
      owner: repo.owner,
      addedAt: now,
      lastUsedAt: now,
    });
    logger.info('Added new repo to registry', { path: repo.path, name: repo.name });
  }

  store.set(STORE_KEY, repos);
}

/**
 * Remove a repo from the registry by path
 */
export function removeRepo(repoPath: string): boolean {
  if (!store) {
    logger.warn('Repo registry not initialized');
    return false;
  }

  const repos: KnownRepo[] = store.get(STORE_KEY, []);
  const filtered = repos.filter((r) => r.path !== repoPath);

  if (filtered.length === repos.length) {
    return false; // Nothing removed
  }

  store.set(STORE_KEY, filtered);
  logger.info('Removed repo from registry', { path: repoPath });
  return true;
}

/**
 * Sync multiple repos into the registry in a single read/write cycle.
 * Much more efficient than calling addRepo() in a loop (avoids N disk writes).
 * Only adds repos that don't already exist — does NOT update lastUsedAt for existing entries.
 */
export function syncRepos(repos: { path: string; name: string; owner?: string }[]): void {
  if (!store) {
    logger.warn('Repo registry not initialized, cannot sync repos');
    return;
  }

  const existing: KnownRepo[] = store.get(STORE_KEY, []);
  const existingPaths = new Set(existing.map((r) => r.path));
  const now = new Date().toISOString();
  let added = 0;

  for (const repo of repos) {
    if (!existingPaths.has(repo.path)) {
      existing.push({
        path: repo.path,
        name: repo.name,
        owner: repo.owner,
        addedAt: now,
        lastUsedAt: now,
      });
      existingPaths.add(repo.path);
      added++;
    }
  }

  if (added > 0) {
    store.set(STORE_KEY, existing);
    logger.info('Synced repos to registry', { added, total: existing.length });
  }
}

/**
 * Clear all repos from the registry
 */
export function clearRepos(): void {
  if (!store) {
    logger.warn('Repo registry not initialized');
    return;
  }
  store.set(STORE_KEY, []);
  logger.info('Cleared all repos from registry');
}
