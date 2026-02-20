/**
 * Space Ordering Manager
 *
 * Manages the ordering of workspaces in the spaces sidebar.
 * Sorts by "last opened" (when user explicitly switches to a workspace).
 *
 * Key behavior: When multiple workspaces have active agents streaming,
 * the order is frozen to prevent jarring reorders while the user is working.
 * Once only one workspace is active, reordering resumes normally.
 */

import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('SpaceOrdering');

const STORAGE_KEY = 'space-ordering';

interface SpaceOrderingState {
  /** Workspace IDs in display order (most recently opened first) */
  order: string[];
  /** Timestamp when each workspace was last explicitly opened by user */
  lastOpenedAt: Record<string, number>;
}

function loadState(): SpaceOrderingState {
  if (typeof window === 'undefined') {
    return { order: [], lastOpenedAt: {} };
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore parse errors
  }
  return { order: [], lastOpenedAt: {} };
}

function saveState(state: SpaceOrderingState) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage errors
  }
}

function createSpaceOrderingManager() {
  const state = $state<SpaceOrderingState>(loadState());

  /**
   * Get the count of workspaces that currently have streaming agents
   */
  function getActiveWorkspaceCount(): number {
    // Get all workspace IDs that have at least one streaming agent
    const activeWorkspaceIds = new Set<string>();

    // Check each workspace in our order list
    for (const workspaceId of state.order) {
      const streamingAgents = activeStreamsTracker.getStreamingAgentIdsForWorkspace(workspaceId);
      if (streamingAgents.length > 0) {
        activeWorkspaceIds.add(workspaceId);
      }
    }

    return activeWorkspaceIds.size;
  }

  return {
    /** Get ordered list of workspace IDs */
    get order() {
      return state.order;
    },

    /** Get last opened timestamp for a workspace */
    getLastOpenedAt(workspaceId: string): number | undefined {
      return state.lastOpenedAt[workspaceId];
    },

    /**
     * Called when user explicitly opens/switches to a workspace.
     * Updates ordering based on activity state.
     */
    openSpace(workspaceId: string) {
      const now = Date.now();
      state.lastOpenedAt[workspaceId] = now;

      const isNewSpace = !state.order.includes(workspaceId);
      const activeCount = getActiveWorkspaceCount();

      // Freeze order if multiple workspaces have active agents
      // (unless this is a brand new space being added)
      if (!isNewSpace && activeCount > 1) {
        logger.debug('Order frozen: multiple active workspaces', {
          workspaceId,
          activeCount,
        });
        saveState(state);
        return;
      }

      // Move this workspace to the top (most recently opened)
      state.order = [workspaceId, ...state.order.filter((id) => id !== workspaceId)];

      logger.debug('Space order updated', {
        workspaceId,
        isNewSpace,
        activeCount,
        newOrder: state.order,
      });

      saveState(state);
    },

    /**
     * Remove a workspace from the ordering (e.g., when closed or deleted)
     */
    removeSpace(workspaceId: string) {
      state.order = state.order.filter((id) => id !== workspaceId);
      delete state.lastOpenedAt[workspaceId];
      saveState(state);
    },

    /**
     * Sync with available workspaces - removes any that no longer exist
     */
    syncWithWorkspaces(workspaceIds: string[]) {
      const validIds = new Set(workspaceIds);
      const removed = state.order.filter((id) => !validIds.has(id));

      if (removed.length > 0) {
        state.order = state.order.filter((id) => validIds.has(id));
        for (const id of removed) {
          delete state.lastOpenedAt[id];
        }
        saveState(state);
      }
    },

    /**
     * Check if reordering is currently frozen due to multiple active workspaces
     */
    get isOrderFrozen() {
      return getActiveWorkspaceCount() > 1;
    },

    /**
     * Reset ordering state
     */
    reset() {
      state.order = [];
      state.lastOpenedAt = {};
      saveState(state);
    },
  };
}

export const spaceOrdering = createSpaceOrderingManager();
