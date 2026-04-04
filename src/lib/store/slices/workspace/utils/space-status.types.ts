/**
 * Space Status Types
 *
 * Types for lightweight workspace status summaries used in hover cards
 * and cross-workspace observability features.
 */

import type { WorkspaceId } from '$shared/types/branded-ids';

/**
 * Lightweight summary of a workspace's current status.
 * Used for hover cards to show observability without loading full data.
 */
export interface SpaceLiveStatus {
  workspaceId: string;

  /** Task progress statistics */
  taskStats: {
    /** Total number of active tasks (excludes cancelled) */
    total: number;
    /** Number of completed tasks */
    completed: number;
    /** Number of in-progress tasks */
    inProgress: number;
  };

  /** File changes statistics */
  changesStats: {
    /** Total uncommitted changes (staged + unstaged) */
    uncommitted: number;
    /** Number of staged changes */
    staged: number;
    /** Number of unstaged changes */
    unstaged: number;
  };

  /** Line change statistics for LineChangesBadge */
  lineStats: {
    /** Total lines added */
    additions: number;
    /** Total lines deleted */
    deletions: number;
  };

  /** Notes summary */
  notesStats: {
    /** Total number of notes in the workspace */
    total: number;
    /** Whether the spec note has content */
    hasSpecContent: boolean;
  };

  /** Timestamp when this summary was computed */
  computedAt: string;
}

/**
 * Request to get a workspace's hover summary
 */
export interface GetSpaceStatusRequest {
  workspaceId: WorkspaceId;
}

/**
 * Cached status entry with TTL
 */
export interface CachedSpaceStatus {
  status: SpaceLiveStatus;
  fetchedAt: number;
}

/**
 * Configuration for the space status cache
 */
export interface SpaceStatusCacheConfig {
  /** Time-to-live in milliseconds (default: 30000 = 30 seconds) */
  ttlMs: number;
  /** Maximum number of cached entries (default: 20) */
  maxEntries: number;
}

export const DEFAULT_CACHE_CONFIG: SpaceStatusCacheConfig = {
  ttlMs: 30000, // 30 seconds
  maxEntries: 20,
};
