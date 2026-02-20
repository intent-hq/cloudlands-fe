/**
 * Tab Scroll Position Store
 *
 * Persists scroll positions for panel tabs using localStorage.
 * Enables scroll preservation when tabs unmount and remount.
 */

import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('TabScrollStore');
const STORAGE_KEY = 'tab-scroll-positions';

// In-memory cache for scroll positions (keyed by tabId)
let scrollPositions = $state<Record<string, number>>({});

/**
 * Load scroll positions from localStorage
 */
function load(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore parse errors
  }
  return {};
}

/**
 * Save scroll positions to localStorage
 */
function persist() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scrollPositions));
  } catch {
    // Ignore storage errors
  }
}

// Initialize from localStorage
if (typeof window !== 'undefined') {
  scrollPositions = load();
}

export const tabScrollStore = {
  /**
   * Get the saved scroll position for a tab
   */
  get(tabId: string): number | undefined {
    return scrollPositions[tabId];
  },

  /**
   * Save scroll position for a tab
   */
  save(tabId: string, scrollTop: number) {
    if (scrollTop > 0) {
      scrollPositions[tabId] = scrollTop;
      persist();
      logger.debug('Saved scroll position', { tabId, scrollTop });
    }
  },

  /**
   * Remove scroll position for a tab (when tab is closed)
   */
  remove(tabId: string) {
    if (tabId in scrollPositions) {
      delete scrollPositions[tabId];
      persist();
      logger.debug('Removed scroll position', { tabId });
    }
  },

  /**
   * Clear all scroll positions for a workspace
   * (Call when workspace is deleted or panels are reset)
   */
  clearForWorkspace(workspaceId: string) {
    // Tab IDs often contain workspace ID, so filter by prefix
    const keysToRemove = Object.keys(scrollPositions).filter((key) =>
      key.includes(workspaceId),
    );
    for (const key of keysToRemove) {
      delete scrollPositions[key];
    }
    if (keysToRemove.length > 0) {
      persist();
      logger.debug('Cleared scroll positions for workspace', {
        workspaceId,
        count: keysToRemove.length,
      });
    }
  },
};
