/**
 * Change History Persistence
 *
 * Per-workspace persistent diff summaries, backed by the daemon-owned
 * `workspace.changeHistory` setting (PROTOCOL.md §5.12). Reads are served
 * from an in-memory cache hydrated by `initChangeHistory` at startup; writes
 * update the cache synchronously and push the new value to the daemon
 * asynchronously via `settings.update`. The legacy default `config`
 * electron-store is retired.
 */

import type { DiffChunk } from '$shared/types/change-detector.types';
import { Logger } from '../../../shared/logger';

const logger = new Logger({ category: 'ChangeHistoryPersistence' });

const SETTING_PATH = 'workspace.changeHistory';

type ChangeHistoryMap = Record<string, DiffChunk[]>;

let cache: ChangeHistoryMap = {};
let initPromise: Promise<void> | null = null;
let initialized = false;

async function fetchChangeHistory(): Promise<ChangeHistoryMap> {
  const { getBackendClient } = await import('../../backend/main/backend.ipc');
  const result = (await getBackendClient().request('settings.get', {
    path: SETTING_PATH,
  })) as { value?: unknown } | null;
  const raw = result?.value;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as ChangeHistoryMap;
  }
  return {};
}

async function pushChangeHistory(value: ChangeHistoryMap): Promise<void> {
  try {
    const { getBackendClient } = await import('../../backend/main/backend.ipc');
    await getBackendClient().request('settings.update', {
      changes: [{ path: SETTING_PATH, value }],
    });
  } catch (error) {
    logger.error('Failed to persist change history on daemon', error as Error);
  }
}

/**
 * Initialize the change history cache from daemon-owned `workspace.changeHistory`
 * (call once during app startup).
 */
export async function initChangeHistory(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      cache = await fetchChangeHistory();
      initialized = true;
      logger.info('Change history initialized', {
        workspaces: Object.keys(cache).length,
      });
    } catch (error) {
      logger.error('Failed to initialize change history', error as Error);
    }
  })();
  return initPromise;
}

async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  if (initPromise) {
    await initPromise;
    // Re-check initialized after awaiting in case init failed
    if (!initialized) {
      throw new Error('Change history initialization failed');
    }
    return;
  }
  // If neither initialized nor initPromise, init was never called — trigger it now
  await initChangeHistory();
  if (!initialized) {
    throw new Error('Change history initialization failed');
  }
}

/**
 * Get diff chunks for a single workspace from the in-memory cache.
 * Waits for initialization if it's in progress.
 */
export async function getChangeHistoryForWorkspace(
  workspaceId: string,
): Promise<DiffChunk[]> {
  await ensureInitialized();
  const entry = cache[workspaceId];
  return Array.isArray(entry) ? entry : [];
}

/**
 * Get the full change-history map (used by callers that need to enumerate
 * workspaces present on disk).
 * Waits for initialization if it's in progress.
 */
export async function getAllChangeHistory(): Promise<ChangeHistoryMap> {
  await ensureInitialized();
  return cache;
}

/**
 * Replace or delete a workspace's history and push the updated map to the
 * daemon.
 * Waits for initialization if it's in progress.
 */
export async function setChangeHistoryForWorkspace(
  workspaceId: string,
  chunks: DiffChunk[] | undefined,
): Promise<void> {
  await ensureInitialized();

  if (!chunks || chunks.length === 0) {
    if (cache[workspaceId] === undefined) return;
    delete cache[workspaceId];
  } else {
    cache[workspaceId] = chunks;
  }
  // Await the push so callers can rely on daemon persistence completing
  await pushChangeHistory({ ...cache });
}

/**
 * Bulk-replace multiple workspaces' histories with a single push to the daemon.
 * Waits for initialization if it's in progress.
 */
export async function bulkSetChangeHistory(
  entries: Iterable<[string, DiffChunk[]]>,
): Promise<void> {
  await ensureInitialized();
  for (const [workspaceId, chunks] of entries) {
    if (!chunks || chunks.length === 0) {
      delete cache[workspaceId];
    } else {
      cache[workspaceId] = chunks;
    }
  }
  // Await the push so callers can rely on daemon persistence completing
  await pushChangeHistory({ ...cache });
}

/** Test-only: reset internal state so init can run again in isolated tests. */
export function __resetChangeHistoryForTesting(): void {
  cache = {};
  initialized = false;
  initPromise = null;
}
