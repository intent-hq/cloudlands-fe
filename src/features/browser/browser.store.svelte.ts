/**
 * Browser Store
 *
 * State management for the embedded browser feature.
 * Stores recent URLs per workspace with localStorage persistence.
 */

import { createLogger } from '$lib/utils/client-logger';
import type { RecentUrl, BrowserState } from './types';
import { MAX_RECENT_URLS, BROWSER_STORAGE_KEY_PREFIX } from './types';

const logger = createLogger('BrowserStore');

/**
 * Get the localStorage key for a workspace
 */
function getStorageKey(workspaceId: string): string {
  return `${BROWSER_STORAGE_KEY_PREFIX}${workspaceId}`;
}

/**
 * Load recent URLs from localStorage
 */
function loadRecentUrls(workspaceId: string): RecentUrl[] {
  try {
    const stored = localStorage.getItem(getStorageKey(workspaceId));
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (error) {
    logger.warn('Failed to load recent URLs from localStorage', { error, workspaceId });
  }
  return [];
}

/**
 * Save recent URLs to localStorage
 */
function saveRecentUrls(workspaceId: string, urls: RecentUrl[]): void {
  try {
    localStorage.setItem(getStorageKey(workspaceId), JSON.stringify(urls));
  } catch (error) {
    logger.warn('Failed to save recent URLs to localStorage', { error, workspaceId });
  }
}

/**
 * Create a browser store for a workspace
 */
function createBrowserStore() {
  // Current workspace ID
  let workspaceId = $state<string | null>(null);

  // Browser state
  const state = $state<BrowserState>({
    recentUrls: [],
    currentUrl: null,
    isLoading: false,
  });

  /**
   * Initialize the store for a workspace
   */
  function initialize(wsId: string): void {
    if (workspaceId === wsId) return;

    workspaceId = wsId;
    state.recentUrls = loadRecentUrls(wsId);
    state.currentUrl = null;
    state.isLoading = false;

    logger.debug('Browser store initialized', {
      workspaceId: wsId,
      urlCount: state.recentUrls.length,
    });
  }

  /**
   * Add a URL to the recent list
   */
  function addRecentUrl(url: string, title?: string, favicon?: string): void {
    if (!workspaceId) {
      logger.warn('Cannot add URL: store not initialized');
      return;
    }

    const now = new Date().toISOString();

    // Remove existing entry with same URL (to move it to top)
    const filtered = state.recentUrls.filter((item) => item.url !== url);

    // Add new entry at the beginning
    const newEntry: RecentUrl = {
      url,
      title,
      favicon,
      lastVisited: now,
    };

    // Keep only MAX_RECENT_URLS
    const updated = [newEntry, ...filtered].slice(0, MAX_RECENT_URLS);

    state.recentUrls = updated;
    saveRecentUrls(workspaceId, updated);

    logger.debug('Added recent URL', { url, title });
  }

  /**
   * Update title/favicon for an existing URL
   */
  function updateUrlMetadata(url: string, title?: string, favicon?: string): void {
    if (!workspaceId) return;

    const updated = state.recentUrls.map((item) => {
      if (item.url === url) {
        return { ...item, title: title ?? item.title, favicon: favicon ?? item.favicon };
      }
      return item;
    });

    state.recentUrls = updated;
    saveRecentUrls(workspaceId, updated);
  }

  /**
   * Remove a URL from the recent list
   */
  function removeRecentUrl(url: string): void {
    if (!workspaceId) return;

    const updated = state.recentUrls.filter((item) => item.url !== url);
    state.recentUrls = updated;
    saveRecentUrls(workspaceId, updated);

    logger.debug('Removed recent URL', { url });
  }

  /**
   * Clear all recent URLs
   */
  function clearRecentUrls(): void {
    if (!workspaceId) return;

    state.recentUrls = [];
    saveRecentUrls(workspaceId, []);

    logger.debug('Cleared all recent URLs');
  }

  /**
   * Set the current URL being viewed
   */
  function setCurrentUrl(url: string | null): void {
    state.currentUrl = url;
  }

  /**
   * Set loading state
   */
  function setLoading(loading: boolean): void {
    state.isLoading = loading;
  }

  return {
    // Getters
    get recentUrls() {
      return state.recentUrls;
    },
    get currentUrl() {
      return state.currentUrl;
    },
    get isLoading() {
      return state.isLoading;
    },
    get workspaceId() {
      return workspaceId;
    },

    // Methods
    initialize,
    addRecentUrl,
    updateUrlMetadata,
    removeRecentUrl,
    clearRecentUrls,
    setCurrentUrl,
    setLoading,
  };
}

// Export singleton instance
export const browserStore = createBrowserStore();
