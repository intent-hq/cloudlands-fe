/**
 * Workspace Storage Manager
 *
 * Manages persistent storage of workspace state using localStorage
 * instead of URL parameters for better performance and reliability.
 */

import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('workspace-storage-manager');

// Storage version for migration support
const STORAGE_VERSION = 2;
const MAX_MEMORY_CACHE_ENTRIES = 100;

export interface WorkspaceStorageState {
  version: number;
  workspace: {
    id: string;
    status: 'loading' | 'ready' | 'error' | 'creating';
  };
  mainPanel: {
    type: string;
    selectedFile?: string;
    selectedNoteId?: string;
    selectedChangeId?: string;
    selectedBrowserUrl?: string;
    selectedTrackedChange?: any;
    selectedActivityEvent?: any;
    selectedAgentTurn?: any;
  };
  drawer: {
    open: boolean;
    type: 'agent' | 'terminal' | 'overview' | null;
    itemId: string | null;
  };
  navigation: {
    history: Array<{
      type: string;
      id: string;
      label: string;
      timestamp: number;
      scrollPosition?: number;
    }>;
    currentIndex: number;
  };
  ui: {
    hasInitialized: boolean;
    lastUpdated: number;
  };
}

export class WorkspaceStorageManager {
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private memoryCache = new Map<string, WorkspaceStorageState>();
  /** Callbacks to notify when a workspace state changes from another window */
  private crossWindowListeners = new Map<string, Set<(state: WorkspaceStorageState) => void>>();
  /** Bound reference to the storage event handler so we can remove it on cleanup */
  private storageEventHandler: ((event: StorageEvent) => void) | null = null;

  constructor() {
    this.setupCrossWindowSync();
  }

  /**
   * Listen for localStorage changes from other windows/tabs.
   * The 'storage' event fires only for changes made in OTHER windows on the same origin,
   * so we don't need to filter out our own writes — they inherently don't trigger this event.
   */
  private setupCrossWindowSync(): void {
    if (typeof window === 'undefined') return;

    this.storageEventHandler = (event: StorageEvent) => {
      // Only care about workspace state keys
      if (!event.key?.startsWith('workspace:state:')) return;

      const workspaceId = event.key.replace('workspace:state:', '');

      // Invalidate memory cache so next loadState() reads fresh data
      this.memoryCache.delete(event.key);

      logger.debug('Cross-window storage change detected', {
        workspaceId,
        hasNewValue: !!event.newValue,
      });

      // Parse the new state and notify listeners
      if (event.newValue) {
        try {
          const newState = JSON.parse(event.newValue) as WorkspaceStorageState;
          // Update memory cache with the new state
          this.setMemoryCacheEntry(event.key, newState);

          // Notify cross-window listeners for this workspace
          const listeners = this.crossWindowListeners.get(workspaceId);
          if (listeners) {
            for (const listener of listeners) {
              try {
                listener(newState);
              } catch (error) {
                logger.error('Error in cross-window state listener', { workspaceId, error });
              }
            }
          }
        } catch (error) {
          logger.error('Failed to parse cross-window state update', { workspaceId, error });
        }
      }
    };

    window.addEventListener('storage', this.storageEventHandler);
  }

  /**
   * Subscribe to cross-window state changes for a specific workspace.
   * Returns an unsubscribe function.
   */
  onCrossWindowChange(
    workspaceId: string,
    callback: (state: WorkspaceStorageState) => void,
  ): () => void {
    let listeners = this.crossWindowListeners.get(workspaceId);
    if (!listeners) {
      listeners = new Set();
      this.crossWindowListeners.set(workspaceId, listeners);
    }
    listeners.add(callback);

    return () => {
      const listeners = this.crossWindowListeners.get(workspaceId);
      if (listeners) {
        listeners.delete(callback);
        if (listeners.size === 0) {
          this.crossWindowListeners.delete(workspaceId);
        }
      }
    };
  }

  /**
   * Generate storage key for a workspace
   */
  private getStorageKey(workspaceId: string): string {
    return `workspace:state:${workspaceId}`;
  }

  private setMemoryCacheEntry(key: string, state: WorkspaceStorageState): void {
    this.memoryCache.delete(key);
    this.memoryCache.set(key, state);

    while (this.memoryCache.size > MAX_MEMORY_CACHE_ENTRIES) {
      const oldestKey = this.memoryCache.keys().next().value;
      if (oldestKey === undefined) break;
      this.memoryCache.delete(oldestKey);
    }
  }

  /**
   * Save workspace state to localStorage
   */
  saveState(workspaceId: string, updates: Partial<WorkspaceStorageState>, immediate = false): void {
    if (!workspaceId) {
      logger.warn('Cannot save state without workspace ID');
      return;
    }

    const key = this.getStorageKey(workspaceId);

    // Cancel existing debounce timer
    const existingTimer = this.debounceTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const doSave = () => {
      try {
        // Get existing state or create new
        const existing = this.loadState(workspaceId) || this.createDefaultState(workspaceId);

        // Merge updates
        const newState: WorkspaceStorageState = {
          ...existing,
          ...updates,
          version: STORAGE_VERSION,
          ui: {
            ...existing.ui,
            ...updates.ui,
            lastUpdated: Date.now(),
          },
        };

        // Update memory cache
        this.setMemoryCacheEntry(key, newState);

        // Save to localStorage
        localStorage.setItem(key, JSON.stringify(newState));

        logger.debug('Saved workspace state', {
          workspaceId,
          updates: Object.keys(updates),
        });
      } catch (error) {
        logger.error('Failed to save workspace state', { error, workspaceId });
      }
    };

    if (immediate) {
      doSave();
    } else {
      // Debounce saves by 300ms to batch rapid updates
      const timer = setTimeout(() => {
        doSave();
        // Clean up timer from map after it fires to prevent unbounded growth
        this.debounceTimers.delete(key);
      }, 300);
      this.debounceTimers.set(key, timer);
    }
  }

  /**
   * Load workspace state from localStorage
   */
  loadState(workspaceId: string): WorkspaceStorageState | null {
    if (!workspaceId) {
      return null;
    }

    const key = this.getStorageKey(workspaceId);

    // Check memory cache first
    const cached = this.memoryCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const stored = localStorage.getItem(key);
      if (!stored) {
        return null;
      }

      const state = JSON.parse(stored) as WorkspaceStorageState;

      // Handle version migration if needed
      if (state.version !== STORAGE_VERSION) {
        const migrated = this.migrateState(state);
        this.saveState(workspaceId, migrated, true);
        return migrated;
      }

      // Update memory cache
      this.setMemoryCacheEntry(key, state);

      return state;
    } catch (error) {
      logger.error('Failed to load workspace state', { error, workspaceId });
      return null;
    }
  }

  /**
   * Update the memory cache without saving to localStorage.
   * Used when state is being saved via a different mechanism (e.g., globalSaveQueue)
   * to ensure loadState returns the latest data from cache.
   */
  updateCache(workspaceId: string, state: WorkspaceStorageState): void {
    if (!workspaceId) {
      return;
    }

    const key = this.getStorageKey(workspaceId);
    this.setMemoryCacheEntry(key, state);
    logger.debug('Updated memory cache', { workspaceId, drawer: state.drawer });
  }

  /**
   * Clear workspace state from storage
   */
  clearState(workspaceId: string): void {
    if (!workspaceId) {
      return;
    }

    const key = this.getStorageKey(workspaceId);

    // Cancel any pending saves
    const timer = this.debounceTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(key);
    }

    // Clear from memory cache
    this.memoryCache.delete(key);

    // Clear from localStorage
    try {
      localStorage.removeItem(key);
      logger.debug('Cleared workspace state', { workspaceId });
    } catch (error) {
      logger.error('Failed to clear workspace state', { error, workspaceId });
    }
  }

  /**
   * Migrate state from optimistic to real workspace ID
   */
  migrateWorkspaceId(fromId: string, toId: string): void {
    const state = this.loadState(fromId);
    if (!state) {
      logger.warn('No state to migrate', { fromId, toId });
      return;
    }

    // Update workspace ID in state
    state.workspace.id = toId;

    // Save to new ID
    this.saveState(toId, state, true);

    // Clear old state
    this.clearState(fromId);

    logger.info('Migrated workspace state', { fromId, toId });
  }

  /**
   * Create default state for a new workspace
   */
  private createDefaultState(workspaceId: string): WorkspaceStorageState {
    return {
      version: STORAGE_VERSION,
      workspace: {
        id: workspaceId,
        status: 'loading',
      },
      mainPanel: {
        type: 'notes',
        selectedNoteId: 'spec', // Default to spec note
      },
      drawer: {
        open: false,
        type: null,
        itemId: null,
      },
      navigation: {
        history: [],
        currentIndex: -1,
      },
      ui: {
        hasInitialized: false,
        lastUpdated: Date.now(),
      },
    };
  }

  /**
   * Migrate state from old version to current
   */
  private migrateState(oldState: any): WorkspaceStorageState {
    logger.info('Migrating workspace state from version', oldState.version || 1);

    // Migration from version 1 (URL-based) to version 2 (storage-based)
    if (!oldState.version || oldState.version === 1) {
      return {
        version: STORAGE_VERSION,
        workspace: {
          id: oldState.workspaceId || '',
          status: 'ready',
        },
        mainPanel: {
          type: oldState.mainContentType || 'notes',
          selectedFile: oldState.selectedFile,
          selectedNoteId: oldState.selectedNoteId,
          selectedChangeId: oldState.selectedChangeId,
          selectedTrackedChange: oldState.selectedTrackedChange,
          selectedActivityEvent: oldState.selectedActivityEvent,
          selectedAgentTurn: oldState.selectedAgentTurn,
        },
        drawer: {
          open: oldState.drawerOpen || false,
          type: oldState.drawerType || null,
          itemId: oldState.dockActiveItemId || null,
        },
        navigation: {
          history: oldState.navigationHistory || [],
          currentIndex: oldState.navigationIndex || -1,
        },
        ui: {
          hasInitialized: true,
          lastUpdated: Date.now(),
        },
      };
    }

    return oldState as WorkspaceStorageState;
  }

  /**
   * Clean up old workspace states (older than 30 days)
   */
  cleanupOldStates(): void {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const keysToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('workspace:state:')) {
        try {
          const state = JSON.parse(localStorage.getItem(key) || '{}') as WorkspaceStorageState;
          if (state.ui?.lastUpdated && state.ui.lastUpdated < thirtyDaysAgo) {
            keysToRemove.push(key);
          }
        } catch {
          // Invalid state, remove it
          keysToRemove.push(key);
        }
      }
    }

    keysToRemove.forEach((key) => {
      localStorage.removeItem(key);
      this.memoryCache.delete(key);
      logger.debug('Cleaned up old workspace state', { key });
    });
  }

  /**
   * Cleanup service resources (timers, caches, etc.)
   * Should be called on app shutdown or when disposing the manager
   */
  cleanup(): void {
    // Clear all pending debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Clear memory cache
    this.memoryCache.clear();

    // Remove storage event listener to prevent memory leaks
    if (this.storageEventHandler && typeof window !== 'undefined') {
      window.removeEventListener('storage', this.storageEventHandler);
      this.storageEventHandler = null;
    }

    // Clear cross-window listeners
    this.crossWindowListeners.clear();

    logger.debug('WorkspaceStorageManager cleaned up');
  }
}

// Export singleton instance
export const workspaceStorageManager = new WorkspaceStorageManager();
