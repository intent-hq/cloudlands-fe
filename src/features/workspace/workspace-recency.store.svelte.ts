/**
 * Workspace Recency Store
 *
 * Tracks when each workspace was last viewed for sorting workspaces
 * by "most recently used" (like macOS Command-Tab).
 *
 * Stored in localStorage, keyed by workspace ID.
 */

import { createLogger } from '$lib/utils/client-logger';
import { WorkspaceStatus, type Workspace, type WorkspaceId } from '$shared/types';

const logger = createLogger('WorkspaceRecencyStore');
const STORAGE_KEY = 'workspace-recency';

interface RecencyData {
  /** Map of workspace ID to last viewed timestamp */
  lastViewedAt: Record<string, number>;
}

class WorkspaceRecencyStore {
  #data = $state<RecencyData>({ lastViewedAt: {} });

  constructor() {
    this.load();
  }

  /**
   * Load recency data from localStorage
   */
  private load(): void {
    if (typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as RecencyData;
        this.#data = parsed;
        logger.debug('Loaded recency data', { count: Object.keys(parsed.lastViewedAt).length });
      }
    } catch (error) {
      logger.warn('Failed to load recency data', { error });
    }
  }

  /**
   * Save recency data to localStorage
   */
  private save(): void {
    if (typeof window === 'undefined') return;

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#data));
    } catch (error) {
      logger.warn('Failed to save recency data', { error });
    }
  }

  /**
   * Record that a workspace was viewed (call this when navigating to a workspace)
   */
  recordView(workspaceId: WorkspaceId): void {
    this.#data.lastViewedAt[workspaceId] = Date.now();
    this.save();
    logger.debug('Recorded workspace view', { workspaceId, timestamp: this.#data.lastViewedAt[workspaceId] });
  }

  /**
   * Get the last viewed timestamp for a workspace
   */
  getLastViewedAt(workspaceId: WorkspaceId): number {
    return this.#data.lastViewedAt[workspaceId] ?? 0;
  }

  /**
   * Sort workspaces by most recently viewed (most recent first)
   * Workspaces that have never been viewed are sorted to the end
   */
  sortByRecency<T extends { id: WorkspaceId }>(workspaces: T[]): T[] {
    return [...workspaces].sort((a, b) => {
      const aTime = this.getLastViewedAt(a.id);
      const bTime = this.getLastViewedAt(b.id);

      // If both have timestamps, sort by most recent first
      if (aTime && bTime) {
        return bTime - aTime;
      }
      // If only one has a timestamp, prioritize the one with a timestamp
      if (aTime) return -1;
      if (bTime) return 1;
      // If neither has a timestamp, maintain original order
      return 0;
    });
  }

  /**
   * Get workspaces sorted by recency, with the current workspace excluded
   */
  getRecentWorkspaces(
    workspaces: Workspace[],
    currentWorkspaceId: WorkspaceId | null,
  ): Workspace[] {
    // Filter out archived and current workspace
    const filtered = workspaces.filter(
      (w) => w.id !== currentWorkspaceId && w.status !== WorkspaceStatus.Archived,
    );
    return this.sortByRecency(filtered);
  }

  /**
   * Clean up recency data for workspaces that no longer exist
   */
  cleanup(existingWorkspaceIds: Set<WorkspaceId>): void {
    const cleaned: Record<string, number> = {};
    let removedCount = 0;

    for (const [id, timestamp] of Object.entries(this.#data.lastViewedAt)) {
      if (existingWorkspaceIds.has(id as WorkspaceId)) {
        cleaned[id] = timestamp;
      } else {
        removedCount++;
      }
    }

    if (removedCount > 0) {
      this.#data.lastViewedAt = cleaned;
      this.save();
      logger.debug('Cleaned up recency data', { removedCount });
    }
  }
}

export const workspaceRecencyStore = new WorkspaceRecencyStore();
