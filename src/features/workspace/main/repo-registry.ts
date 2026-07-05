/**
 * Repo Registry
 *
 * Persistent registry of known repositories, backed by the daemon-owned
 * `repos.known` setting (PROTOCOL.md §5.12). Reads are served from an
 * in-memory cache hydrated by `initRepoRegistry` at startup; writes update
 * the cache synchronously and push the new value to the daemon
 * asynchronously. The legacy `repo-registry` electron-store is retired.
 */

import type { KnownRepo } from '$shared/types/known-repo';
import { Logger } from '../../../shared/logger';

const logger = new Logger({ category: 'RepoRegistry' });

export type { KnownRepo };

const SETTING_PATH = 'repos.known';

let cache: KnownRepo[] = [];
let initPromise: Promise<void> | null = null;
let initialized = false;

async function fetchRepos(): Promise<KnownRepo[]> {
  const { getBackendClient } = await import('../../backend/main/backend.ipc');
  const result = (await getBackendClient().request('settings.get', {
    path: SETTING_PATH,
  })) as { value?: unknown } | null;
  const raw = result?.value;
  return Array.isArray(raw) ? (raw as KnownRepo[]) : [];
}

async function pushRepos(repos: KnownRepo[]): Promise<void> {
  try {
    const { getBackendClient } = await import('../../backend/main/backend.ipc');
    await getBackendClient().request('settings.update', {
      changes: [{ path: SETTING_PATH, value: repos }],
    });
  } catch (error) {
    logger.error('Failed to persist repos on daemon', error as Error);
  }
}

/**
 * Initialize the repo registry cache from daemon-owned `repos.known`
 * (call once during app startup).
 */
export async function initRepoRegistry(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      cache = await fetchRepos();
      initialized = true;
      logger.info('Repo registry initialized', { count: cache.length });
    } catch (error) {
      logger.error('Failed to initialize repo registry', error as Error);
    }
  })();
  return initPromise;
}

function warnIfUninitialized(action: string): boolean {
  if (!initialized) {
    logger.warn(`Repo registry not initialized, ${action}`);
    return false;
  }
  return true;
}

/**
 * Get all known repos, sorted by lastUsedAt descending.
 */
export function getAllRepos(): KnownRepo[] {
  if (!warnIfUninitialized('returning empty list')) return [];
  return [...cache].sort(
    (a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime(),
  );
}

/**
 * Add or update a repo in the registry.
 * If a repo with the same path already exists, updates its lastUsedAt and metadata.
 */
export function addRepo(repo: { path: string; name: string; owner?: string }): void {
  if (!warnIfUninitialized(`cannot add repo path=${repo.path}`)) return;

  const now = new Date().toISOString();
  const existingIndex = cache.findIndex((r) => r.path === repo.path);

  if (existingIndex >= 0) {
    cache[existingIndex] = {
      ...cache[existingIndex],
      name: repo.name || cache[existingIndex].name,
      owner: repo.owner ?? cache[existingIndex].owner,
      lastUsedAt: now,
    };
    logger.debug('Updated existing repo in registry', { path: repo.path });
  } else {
    cache.push({
      path: repo.path,
      name: repo.name,
      owner: repo.owner,
      addedAt: now,
      lastUsedAt: now,
    });
    logger.info('Added new repo to registry', { path: repo.path, name: repo.name });
  }

  void pushRepos(cache);
}

/**
 * Remove a repo from the registry by path.
 */
export function removeRepo(repoPath: string): boolean {
  if (!warnIfUninitialized('cannot remove repo')) return false;

  const filtered = cache.filter((r) => r.path !== repoPath);
  if (filtered.length === cache.length) return false;

  cache = filtered;
  void pushRepos(cache);
  logger.info('Removed repo from registry', { path: repoPath });
  return true;
}

/**
 * Sync multiple repos into the registry in a single push. Only adds repos
 * that don't already exist — does NOT update lastUsedAt for existing entries.
 */
export function syncRepos(repos: { path: string; name: string; owner?: string }[]): void {
  if (!warnIfUninitialized('cannot sync repos')) return;

  const existingPaths = new Set(cache.map((r) => r.path));
  const now = new Date().toISOString();
  let added = 0;

  for (const repo of repos) {
    if (!existingPaths.has(repo.path)) {
      cache.push({
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
    void pushRepos(cache);
    logger.info('Synced repos to registry', { added, total: cache.length });
  }
}

/**
 * Clear all repos from the registry.
 */
export function clearRepos(): void {
  if (!warnIfUninitialized('cannot clear repos')) return;
  cache = [];
  void pushRepos(cache);
  logger.info('Cleared all repos from registry');
}

/** Test-only: reset internal state so init can run again in isolated tests. */
export function __resetRepoRegistryForTesting(): void {
  cache = [];
  initialized = false;
  initPromise = null;
}
