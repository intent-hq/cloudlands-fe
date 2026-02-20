/**
 * Deferred Results Cache
 *
 * A simple cache for storing background agent results that were generated
 * while the user was in a different workspace. This is separated from
 * background-agent-executor to avoid circular dependencies with workspace.store.
 */

import { createLogger } from '$lib/utils/client-logger';
import type { BackgroundAgentType } from '$lib/stores/background-agent-settings.store.svelte';

const logger = createLogger('DeferredResultsCache');

/**
 * Deferred result for workspaces that aren't currently active
 */
export interface DeferredResult {
  result: string;
  type: BackgroundAgentType;
  timestamp: number;
}

/**
 * Cache expiration time for deferred results (5 minutes)
 */
export const DEFERRED_RESULT_EXPIRY_MS = 300000;

/**
 * Static cache for storing results for workspaces that aren't currently active.
 * Keyed by workspaceId for efficient lookup.
 */
const deferredResults = new Map<string, DeferredResult[]>();

/**
 * Interval handle for periodic cleanup
 */
let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Add a deferred result to the cache
 *
 * @param workspaceId - The workspace ID to store the result for
 * @param result - The result to store
 * @param type - The background agent type
 */
export function addDeferredResult(
  workspaceId: string,
  result: string,
  type: BackgroundAgentType,
): void {
  const deferredResult: DeferredResult = {
    result,
    type,
    timestamp: Date.now(),
  };

  const existing = deferredResults.get(workspaceId) || [];
  existing.push(deferredResult);
  deferredResults.set(workspaceId, existing);

  logger.debug('[DeferredResultsCache] Added deferred result', {
    workspaceId,
    type,
    count: existing.length,
  });
}

/**
 * Check if there are any deferred results for a workspace and type.
 * This does NOT remove results from the cache.
 *
 * @param workspaceId - The workspace ID to check
 * @param type - The background agent type to filter by
 * @returns true if there are valid (non-expired) results
 */
export function hasDeferredResults(workspaceId: string, type: BackgroundAgentType): boolean {
  const now = Date.now();
  const results = deferredResults.get(workspaceId);

  if (!results || results.length === 0) {
    return false;
  }

  return results.some(
    (entry) => entry.type === type && now - entry.timestamp <= DEFERRED_RESULT_EXPIRY_MS,
  );
}

/**
 * Get deferred results for a specific workspace and agent type.
 * Returns cached results and removes them from cache.
 * Results expire after 5 minutes (DEFERRED_RESULT_EXPIRY_MS).
 *
 * @param workspaceId - The workspace ID to get results for
 * @param type - The background agent type to filter by
 * @returns Array of valid (non-expired) results for the workspace/type combination
 */
export function getDeferredResults(workspaceId: string, type: BackgroundAgentType): string[] {
  const now = Date.now();
  const results = deferredResults.get(workspaceId);

  if (!results || results.length === 0) {
    return [];
  }

  // Filter for matching type and non-expired results
  const validResults: string[] = [];
  const remainingResults: DeferredResult[] = [];

  for (const entry of results) {
    const isExpired = now - entry.timestamp > DEFERRED_RESULT_EXPIRY_MS;

    if (isExpired) {
      // Skip expired results (they'll be removed from cache)
      logger.debug('[DeferredResultsCache] Expired deferred result removed', {
        workspaceId,
        type: entry.type,
        age: now - entry.timestamp,
      });
      continue;
    }

    if (entry.type === type) {
      // Matching type - return this result and remove from cache
      validResults.push(entry.result);
    } else {
      // Different type - keep in cache
      remainingResults.push(entry);
    }
  }

  // Update cache with remaining results (or delete if empty)
  if (remainingResults.length > 0) {
    deferredResults.set(workspaceId, remainingResults);
  } else {
    deferredResults.delete(workspaceId);
  }

  if (validResults.length > 0) {
    logger.info('[DeferredResultsCache] Retrieved deferred results', {
      workspaceId,
      type,
      count: validResults.length,
    });
  }

  return validResults;
}

/**
 * Clear all deferred results for a workspace.
 * Call this when a workspace is closed or deleted.
 *
 * @param workspaceId - The workspace ID to clear results for
 */
export function clearDeferredResults(workspaceId: string): void {
  if (deferredResults.has(workspaceId)) {
    logger.debug('[DeferredResultsCache] Clearing deferred results for workspace', {
      workspaceId,
    });
    deferredResults.delete(workspaceId);
  }
}

/**
 * Purge all expired entries from the cache.
 * This is called periodically to prevent memory accumulation.
 */
export function purgeExpiredResults(): void {
  const now = Date.now();
  let totalPurged = 0;

  for (const [workspaceId, results] of deferredResults.entries()) {
    const validResults = results.filter((entry) => {
      const isExpired = now - entry.timestamp > DEFERRED_RESULT_EXPIRY_MS;
      if (isExpired) {
        totalPurged++;
      }
      return !isExpired;
    });

    if (validResults.length === 0) {
      deferredResults.delete(workspaceId);
    } else if (validResults.length !== results.length) {
      deferredResults.set(workspaceId, validResults);
    }
  }

  if (totalPurged > 0) {
    logger.debug('[DeferredResultsCache] Purged expired entries', {
      count: totalPurged,
      remainingWorkspaces: deferredResults.size,
    });
  }
}

/**
 * Start periodic cleanup of expired entries.
 * Cleanup runs every minute to prevent memory accumulation.
 */
export function startPeriodicCleanup(): void {
  if (cleanupIntervalId) {
    return; // Already running
  }

  // Run cleanup every minute
  cleanupIntervalId = setInterval(purgeExpiredResults, 60000);

  logger.debug('[DeferredResultsCache] Started periodic cleanup');
}

/**
 * Stop periodic cleanup (for testing or shutdown)
 */
export function stopPeriodicCleanup(): void {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
    logger.debug('[DeferredResultsCache] Stopped periodic cleanup');
  }
}

// Start cleanup on module load
startPeriodicCleanup();
