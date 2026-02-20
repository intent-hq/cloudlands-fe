/**
 * Workspace Preloader
 *
 * Preloads workspace data to improve perceived performance.
 * Starts loading data as soon as the workspace ID is known, even before components mount.
 */

import { workspaceClient } from '$features/workspace/workspace.client';
import { getStoredAgentsFromDisk } from '$lib/utils/agent-loader';
import { queryEvents } from '$features/events/events.client';
import { Logger } from '$shared/logger';
import { WorkspaceId } from '$shared/types/branded-ids';

const logger = new Logger('WorkspacePreloader');

interface PreloadedData {
  workspace?: any;
  agents?: any[];
  events?: any[];
  error?: string;
}

class WorkspacePreloader {
  private cache = new Map<string, Promise<PreloadedData>>();
  private readonly cacheTimeout = 5000; // 5 seconds

  /**
   * Start preloading workspace data
   */
  preload(workspaceId: string): Promise<PreloadedData> {
    // Check if we already have a preload in progress
    const existing = this.cache.get(workspaceId);
    if (existing) {
      return existing;
    }

    // Start preloading
    const preloadPromise = this.doPreload(workspaceId);

    // Store in cache
    this.cache.set(workspaceId, preloadPromise);

    // Clear from cache after timeout
    setTimeout(() => {
      this.cache.delete(workspaceId);
    }, this.cacheTimeout);

    return preloadPromise;
  }

  /**
   * Perform the actual preloading
   */
  private async doPreload(workspaceId: string): Promise<PreloadedData> {
    logger.debug(`Starting preload for workspace ${workspaceId}`);

    const result: PreloadedData = {};

    try {
      // Start all loads in parallel
      // Use workspace.get instead of workspace.open to avoid starting monitoring
      const [workspaceResult, agents, events] = await Promise.allSettled([
        workspaceClient.get(WorkspaceId(workspaceId)),
        getStoredAgentsFromDisk(workspaceId),
        queryEvents(workspaceId, [], 100),
      ]);

      // Process workspace result
      if (workspaceResult.status === 'fulfilled' && workspaceResult.value.ok) {
        result.workspace = workspaceResult.value.data;
      } else if (workspaceResult.status === 'rejected') {
        logger.error('Failed to preload workspace:', workspaceResult.reason);
        result.error = 'Failed to load space';
      }

      // Process agents result
      if (agents.status === 'fulfilled') {
        result.agents = agents.value;
      } else {
        logger.warn('Failed to preload agents:', agents.reason);
      }

      // Process events result
      if (events.status === 'fulfilled') {
        result.events = events.value;
      } else {
        logger.warn('Failed to preload events:', events.reason);
      }

      logger.debug(`Preload complete for workspace ${workspaceId}`, {
        hasWorkspace: !!result.workspace,
        agentCount: result.agents?.length || 0,
        eventCount: result.events?.length || 0,
      });
    } catch (error) {
      logger.error('Preload failed:', error);
      result.error = 'Preload failed';
    }

    return result;
  }

  /**
   * Get preloaded data if available
   */
  async getPreloadedData(workspaceId: string): Promise<PreloadedData | null> {
    const promise = this.cache.get(workspaceId);
    if (!promise) {
      return null;
    }

    try {
      return await promise;
    } catch {
      return null;
    }
  }

  /**
   * Clear cache for a specific workspace
   */
  clearCache(workspaceId: string) {
    this.cache.delete(workspaceId);
  }

  /**
   * Clear all cached data
   */
  clearAllCache() {
    this.cache.clear();
  }
}

// Export singleton instance
export const workspacePreloader = new WorkspacePreloader();

/**
 * Start preloading workspace data as early as possible
 */
export function startWorkspacePreload(workspaceId: string): void {
  // Fire and forget - start the preload but don't wait for it
  workspacePreloader.preload(workspaceId).catch((error) => {
    logger.warn('Preload failed (non-critical):', error);
  });
}
