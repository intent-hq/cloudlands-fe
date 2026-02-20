/**
 * Unified Workspace State Manager
 *
 * Simplified state management using storage-based persistence
 * instead of URL parameters.
 */

import { unifiedStateStore } from '$features/agent/services/unified-state-store';
import type { WorkspaceEvent } from '$features/events/types';
import { fileTrackingStore } from '$features/file-tracking/file-tracking.store.svelte';
import type { TrackedChange } from '$features/file-tracking/types';
import { getPanelLayoutManager } from '$features/layout/panel-layout-manager.svelte';
import { createLogger } from '$lib/utils/client-logger';
import type { AgentSession, TerminalSession, Workspace } from '$shared/types';
import { WorkspaceId as WorkspaceIdFn } from '$shared/types/branded-ids';
import { untrack } from 'svelte';
import { optimisticWorkspaceManager } from './optimistic-workspace-manager';
import { globalSaveQueue } from './unified-save-queue';
import { workspaceStorageManager, type WorkspaceStorageState } from './workspace-storage-manager';
import { workspaceStore } from './workspace.store.svelte';

const logger = createLogger('workspace-unified-state');

/**
 * Navigation history item stored in the workspace state.
 * Contains all information needed to restore a navigation state.
 */
export interface NavigationHistoryItem {
  type: string;
  id?: string;
  timestamp?: number;
  scrollPosition?: number;
  // Additional data for specific types
  [key: string]: unknown;
}

export interface UnifiedWorkspaceState {
  // From WorkspaceStorageState
  version: number;
  workspace: {
    id: string;
    status: 'loading' | 'ready' | 'error' | 'creating';
  } | null;
  mainPanel: {
    type: string;
    selectedFile?: string;
    selectedNoteId?: string;
    selectedChangeId?: string;
    selectedBrowserUrl?: string;
    selectedTrackedChange?: TrackedChange;
    selectedActivityEvent?: WorkspaceEvent;
    selectedAgentTurn?: {
      agentId: string;
      sessionId?: string;
      turnNumber?: number;
    };
    // Chat changes view data
    chatChanges?: any[];
    chatChangesTitle?: string;
    chatChangesMessageId?: string;
    chatChangesAgentId?: string;
    chatChangesTurnNumber?: number;
    chatChangesIsAggregate?: boolean;
    // Scroll to specific line in diff view
    scrollToLine?: number;
  };
  drawer: {
    open: boolean;
    type: 'agent' | 'terminal' | 'overview' | null;
    itemId: string | null;
  };
  navigation: {
    history: NavigationHistoryItem[];
    currentIndex: number;
  };
  ui: {
    hasInitialized: boolean;
    lastUpdated: number;
    jumpToLine?: number;
  };

  // Runtime state (not persisted)
  workspaceData: Workspace | null;
  agentsList: AgentSession[];
  terminalsList: TerminalSession[];
  workspaceEvents: WorkspaceEvent[];

  // UI flags
  isEditingTitle: boolean;
  editingTitle: string;
  isDraggingOver: boolean;
  showPullRequestModal: boolean;
  showAugieSetup: boolean;
  showWorkspaceInitializer: boolean;

  // Transient state
  isComponentMounted: boolean;
  agentsLoadingInProgress: boolean;

  // New workspace tracking
  isNewlyCreatedWorkspace: boolean; // True when workspace was just created and hasn't fully loaded
}

// Memory cache for workspace states to improve performance
// Reduced cache size and improved cleanup logic
const MAX_CACHE_SIZE = 3; // Reduced from 5 to prevent memory bloat
const stateCache = new Map<
  string,
  {
    state: UnifiedWorkspaceState;
    manager: any;
    lastAccessed: number;
    disposed: boolean;
    /** Unsubscribe from cross-window state changes. Called on eviction/dispose. */
    crossWindowUnsub?: () => void;
  }
>();

// Weak map for tracking state references to prevent memory leaks
const stateReferences = new WeakMap<UnifiedWorkspaceState, number>();

// Track active cleanup operations to prevent race conditions
const activeCleanups = new Set<string>();

// Clean up old cached states with improved logic
function cleanupCache() {
  // More aggressive cleanup threshold
  if (stateCache.size <= MAX_CACHE_SIZE - 1) return;

  // Sort by last accessed time and remove oldest
  const entries = Array.from(stateCache.entries())
    .filter(([_, value]) => !value.disposed) // Don't count disposed states
    .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

  // Remove oldest entries more aggressively
  const toRemove = entries.slice(0, Math.max(1, entries.length - MAX_CACHE_SIZE + 1));
  for (const [key, value] of toRemove) {
    // Only remove if no active references and not currently being cleaned up
    const refCount = stateReferences.get(value.state) || 0;
    if (refCount === 0 && !activeCleanups.has(key)) {
      // Clean up cross-window listener before eviction
      value.crossWindowUnsub?.();
      // Mark as disposed first
      value.disposed = true;
      stateCache.delete(key);
      stateReferences.delete(value.state);
      logger.debug('Removed old cached state', { workspaceId: key });
    }
  }
}

// Periodic cleanup to prevent memory leaks
let cleanupInterval: NodeJS.Timeout | null = null;

// Function to start cleanup interval
function startCleanupInterval() {
  if (typeof window !== 'undefined' && !cleanupInterval) {
    cleanupInterval = setInterval(() => {
      // Clean up disposed states
      for (const [key, value] of stateCache.entries()) {
        if (value.disposed || Date.now() - value.lastAccessed > 300000) {
          // 5 minutes
          const refCount = stateReferences.get(value.state) || 0;
          if (refCount === 0) {
            value.crossWindowUnsub?.();
            stateCache.delete(key);
            stateReferences.delete(value.state);
          }
        }
      }
    }, 60000); // Run every minute
  }
}

/**
 * Proactively dispose and remove a specific workspace state from cache.
 * Call this when a workspace is deleted to prevent stale agent data from lingering.
 */
export function disposeWorkspaceState(workspaceId: string): void {
  const cached = stateCache.get(workspaceId);
  if (cached) {
    cached.crossWindowUnsub?.();
    cached.disposed = true;
    stateCache.delete(workspaceId);
    stateReferences.delete(cached.state);
    logger.debug('Proactively disposed workspace state on deletion', { workspaceId });
  }
}

// Function to stop cleanup interval and perform cleanup
export function stopCleanupInterval() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }

  // Dispose all cached states and clean up cross-window listeners
  for (const [, value] of stateCache.entries()) {
    value.crossWindowUnsub?.();
    value.disposed = true;
  }

  // Clear all caches
  stateCache.clear();
  activeCleanups.clear();

  // Flush any pending saves synchronously if possible
  try {
    globalSaveQueue.flush();
  } catch (error) {
    // Ignore errors on unload
  }
}

// Start the interval
startCleanupInterval();

// Save scroll position for the current view synchronously
function saveScrollPositionSync() {
  // Find the current active workspace state
  for (const [, cached] of stateCache.entries()) {
    if (cached.disposed) continue;

    const state = cached.state;
    const currentEntry = state.navigation.history[state.navigation.currentIndex];

    if (!currentEntry) continue;

    // Try to get scroll position from the appropriate component
    if (state.mainPanel.type === 'notes') {
      // For notes, dispatch event and wait for response synchronously via closure
      let scrollTop = 0;
      const event = new CustomEvent('note:save-scroll-position', {
        detail: {
          callback: (value: number) => {
            scrollTop = value;
          },
        },
      });
      window.dispatchEvent(event);
      if (scrollTop > 0) {
        currentEntry.scrollPosition = scrollTop;
      }
    } else if (state.mainPanel.type === 'file') {
      // For files, dispatch event and wait for response synchronously via closure
      let scrollTop = 0;
      const event = new CustomEvent('file:save-scroll-position', {
        detail: {
          callback: (value: number) => {
            scrollTop = value;
          },
        },
      });
      window.dispatchEvent(event);
      if (scrollTop > 0) {
        currentEntry.scrollPosition = scrollTop;
      }
    }

    // Persist the state with the scroll position immediately
    const storageKey = `workspace:state:${state.workspace?.id}`;
    try {
      const toPersist = {
        version: 2,
        workspace: state.workspace,
        mainPanel: state.mainPanel,
        drawer: {
          open: state.drawer.open,
          type: state.drawer.type,
          itemId: state.drawer.itemId,
        },
        navigation: {
          history: state.navigation.history.map((h) => ({
            type: h.type,
            id: h.id || '',
            label: '',
            timestamp: Date.now(),
            scrollPosition: h.scrollPosition,
          })),
          currentIndex: state.navigation.currentIndex,
        },
        ui: state.ui,
      };
      localStorage.setItem(storageKey, JSON.stringify(toPersist));
    } catch {
      // Ignore errors during unload
    }
  }
}

// Clean up on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    // Save scroll position before unload
    saveScrollPositionSync();
    stopCleanupInterval();
  });
}

/**
 * Get an existing unified workspace state from cache
 * Returns undefined if not found (doesn't create)
 */
export function getUnifiedWorkspaceState(workspaceId: string) {
  const cached = stateCache.get(workspaceId);
  if (cached && !cached.disposed) {
    cached.lastAccessed = Date.now();
    return cached.manager;
  }
  return undefined;
}

/** Type alias for the unified workspace state manager */
export type UnifiedWorkspaceStateManager = ReturnType<typeof createUnifiedWorkspaceState>;

export function createUnifiedWorkspaceState(workspaceId: string) {
  const logger = createLogger(`workspace-state:${workspaceId || 'unknown'}`);

  // Validate workspace ID - check for empty string, undefined, null, and string versions
  if (!workspaceId || workspaceId === '' || workspaceId === 'undefined' || workspaceId === 'null') {
    logger.error('Invalid workspace ID', { workspaceId, type: typeof workspaceId });
    throw new Error(`Invalid workspace ID: ${workspaceId}`);
  }

  // Check memory cache first
  if (stateCache.has(workspaceId)) {
    const cached = stateCache.get(workspaceId)!;

    // Don't return disposed states
    if (cached.disposed) {
      logger.debug('Cached state is disposed, creating new', { workspaceId });
      stateCache.delete(workspaceId);
    } else {
      logger.debug('Using cached state', { workspaceId });
      cached.state.isComponentMounted = true;
      cached.lastAccessed = Date.now();

      // Increment reference count safely
      const refCount = stateReferences.get(cached.state) || 0;
      stateReferences.set(cached.state, refCount + 1);

      return cached.manager;
    }
  }

  // Clean up old cache entries before creating new state
  cleanupCache();

  // Load persisted state from storage with validation
  const persistedState = workspaceStorageManager.loadState(workspaceId);

  // Validate persisted state
  if (persistedState) {
    // Ensure drawer state is valid
    if (persistedState.drawer?.open && !persistedState.drawer?.itemId) {
      logger.warn('Invalid drawer state detected, resetting', { drawer: persistedState.drawer });
      persistedState.drawer = { open: false, type: null, itemId: null };
    }

    // Ensure navigation state is valid
    if (persistedState.navigation?.currentIndex >= persistedState.navigation?.history?.length) {
      logger.warn('Invalid navigation index, resetting', { navigation: persistedState.navigation });
      persistedState.navigation.currentIndex = Math.max(
        0,
        persistedState.navigation.history.length - 1,
      );
    }
  }

  // Create initial state by merging persisted and default runtime state
  const state = $state<UnifiedWorkspaceState>({
    // Persisted state with defaults
    version: persistedState?.version || 2,
    workspace: persistedState?.workspace || { id: workspaceId, status: 'loading' },
    mainPanel: persistedState?.mainPanel || { type: 'notes', selectedNoteId: 'spec' },
    // Don't restore drawer state immediately - let the workspace page handle it
    // after checking for streaming agents to avoid the flash where we show
    // the persisted agent briefly before switching to a streaming agent
    drawer: { open: false, type: null, itemId: null },
    navigation: persistedState?.navigation || { history: [], currentIndex: -1 },
    ui: persistedState?.ui || { hasInitialized: false, lastUpdated: Date.now() },

    // Runtime state (always fresh)
    workspaceData: null,
    agentsList: [],
    terminalsList: [],
    workspaceEvents: [],

    // UI flags (always fresh)
    isEditingTitle: false,
    editingTitle: '',
    isDraggingOver: false,
    showPullRequestModal: false,
    showAugieSetup: false,
    showWorkspaceInitializer: false,

    // Transient state
    isComponentMounted: true,
    agentsLoadingInProgress: false,

    // New workspace tracking - check if this is a newly created workspace
    // A workspace is considered "newly created" if it has no agents yet
    isNewlyCreatedWorkspace: false, // Will be set based on agent count
  });

  // Initialize reference count
  stateReferences.set(state, 1);

  // Use unified save queue for persistence
  const persistState = () => {
    // Check if drawer is in the "pending restoration" state
    // This happens after reset() or initial creation, before the workspace page
    // has a chance to restore the persisted drawer state.
    const isDrawerPendingRestoration =
      !state.drawer.open && state.drawer.type === null && state.drawer.itemId === null;

    // If drawer is pending restoration, preserve the existing cached drawer state
    // instead of overwriting it with the reset state. This prevents losing the
    // drawer state when workspace sync or other effects call persistState() before
    // the drawer has been restored.
    let drawerToSave = {
      open: state.drawer.open,
      type: state.drawer.type,
      itemId: state.drawer.itemId,
    };

    if (isDrawerPendingRestoration) {
      const existingCached = workspaceStorageManager.loadState(workspaceId);
      if (existingCached?.drawer?.open && existingCached?.drawer?.itemId) {
        // Preserve the existing cached drawer state
        drawerToSave = existingCached.drawer;
        logger.debug('Preserving cached drawer state during pending restoration', {
          workspaceId,
          cachedDrawer: existingCached.drawer,
        });
      }
    }

    // Only persist certain fields, transforming navigation history to match storage format
    const toPersist: WorkspaceStorageState = {
      version: 2,
      workspace: state.workspace || { id: workspaceId, status: 'loading' },
      mainPanel: state.mainPanel,
      drawer: drawerToSave,
      navigation: {
        history: state.navigation.history.map((h) => ({
          type: h.type,
          id: h.id || '',
          label: '',
          timestamp: Date.now(),
          scrollPosition: h.scrollPosition,
        })),
        currentIndex: state.navigation.currentIndex,
      },
      ui: state.ui,
    };

    // CRITICAL: Update the storage manager's memory cache immediately.
    // The globalSaveQueue debounces localStorage writes, but getPersistedState()
    // reads from workspaceStorageManager which uses a memory cache.
    // Without this, drawer state restoration after workspace switch fails because
    // loadState returns stale cached data instead of the pending save data.
    workspaceStorageManager.updateCache(workspaceId, toPersist);

    // Use unified save queue instead of custom debouncing
    const storageKey = `workspace:state:${workspaceId}`;
    globalSaveQueue.schedule(storageKey, toPersist);
    logger.debug('State queued for save', { workspaceId, drawer: toPersist.drawer });
  };

  // Subscribe to cross-window state changes so if another window modifies
  // the same workspace's persisted state, we pick up the changes.
  // Only sync persisted fields (mainPanel, navigation) - never overwrite runtime state.
  const unsubCrossWindow = workspaceStorageManager.onCrossWindowChange(
    workspaceId,
    (newPersistedState) => {
      const cached = stateCache.get(workspaceId);
      if (!cached || cached.disposed) return;

      logger.debug('Cross-window state change received', {
        workspaceId,
        newMainPanel: newPersistedState.mainPanel?.type,
      });

      // Update persisted fields from the other window's write.
      // Be conservative: only sync fields that represent user navigation intent.
      // Don't sync drawer state since the user may intentionally have different
      // drawer states in different windows.
      if (newPersistedState.mainPanel) {
        state.mainPanel = { ...state.mainPanel, ...newPersistedState.mainPanel };
      }
      if (newPersistedState.navigation) {
        state.navigation = { ...newPersistedState.navigation };
      }
    },
  );

  // Create and cache the state manager, storing the cross-window unsubscribe
  // in the cache entry so eviction paths can clean it up too (not just dispose).
  const manager = createStateManager(state, workspaceId, persistState);
  stateCache.set(workspaceId, {
    state,
    manager,
    lastAccessed: Date.now(),
    disposed: false,
    crossWindowUnsub: unsubCrossWindow,
  });

  // CRITICAL: Set the current workspace in unifiedStateStore immediately
  // This ensures that sessionStore.getAllSessions() returns agents for the correct workspace
  // when switching workspaces, preventing stale agents from appearing in the dock
  unifiedStateStore.setCurrentWorkspace(WorkspaceIdFn(workspaceId));
  logger.debug('Set current workspace in unifiedStateStore', { workspaceId });

  return manager;
}

function createStateManager(
  state: UnifiedWorkspaceState,
  workspaceId: string,
  persistState: () => void,
) {
  const logger = createLogger(`workspace-state:${workspaceId}`);

  // Track if this is an optimistic workspace
  // Use the ID pattern to determine if optimistic, not the manager state.
  // This prevents issues when the optimistic workspace is resolved and removed from the manager.
  const isOptimistic = $derived(workspaceId.startsWith('optimistic-'));

  // Transition metadata for optimistic workspaces.
  // NOTE: This is *display config only* (title/repositoryPath/branch) and is NOT an optimistic→real ID mapping.
  const transition = $derived(
    isOptimistic ? optimisticWorkspaceManager.getTransition(workspaceId) : null,
  );

  // Derived state (optimized with memoization)
  const hasCodeChanges = $derived(false); // Will be computed from git/file tracking
  const hasActivityEvents = $derived(state.workspaceEvents.length > 0);
  const hasSpecContent = $derived(state.mainPanel.selectedNoteId === 'spec');

  const shouldHideMainContent = $derived(
    state.mainPanel.type === 'empty' && !hasSpecContent && !hasCodeChanges,
  );

  const canGoBack = $derived(state.navigation.currentIndex > 0);
  const canGoForward = $derived(
    state.navigation.currentIndex < state.navigation.history.length - 1,
  );

  // Maximum navigation history size to prevent memory issues
  const MAX_NAVIGATION_HISTORY = 50;

  // Create a function to sync workspace store updates
  // This will be called from component context
  // Wrapped in untrack() to prevent creating reactive dependencies that could cause infinite loops
  const syncWorkspaceStore = () => {
    untrack(() => {
      // Only sync if we have workspace data and it's not optimistic
      if (state.workspaceData && !isOptimistic) {
        // Check if the workspace in the store has been updated
        const storeWorkspace = workspaceStore.findById(WorkspaceIdFn(workspaceId));
        if (storeWorkspace) {
          // Safely parse dates with fallback to 0
          let storeUpdatedAt = 0;
          let stateUpdatedAt = 0;

          try {
            if (storeWorkspace.updatedAt) {
              const storeDate = new Date(storeWorkspace.updatedAt);
              if (!isNaN(storeDate.getTime())) {
                storeUpdatedAt = storeDate.getTime();
              }
            }

            if (state.workspaceData.updatedAt) {
              const stateDate = new Date(state.workspaceData.updatedAt);
              if (!isNaN(stateDate.getTime())) {
                stateUpdatedAt = stateDate.getTime();
              }
            }
          } catch (error) {
            logger.warn('[WorkspaceState] Error parsing dates for comparison', { error });
          }

          // Also check if title has changed (common update from agents)
          const titleChanged = storeWorkspace.title !== state.workspaceData.title;

          // Check other important fields that might change
          const branchChanged = storeWorkspace.branch !== state.workspaceData.branch;
          const statusChanged = storeWorkspace.status !== state.workspaceData.status;

          if (storeUpdatedAt > stateUpdatedAt || titleChanged || branchChanged || statusChanged) {
            logger.info('[WorkspaceState] Syncing workspace update from store', {
              workspaceId,
              oldTitle: state.workspaceData.title,
              newTitle: storeWorkspace.title,
              titleChanged,
              branchChanged,
              statusChanged,
              storeUpdatedAt: storeUpdatedAt ? new Date(storeUpdatedAt).toISOString() : 'N/A',
              stateUpdatedAt: stateUpdatedAt ? new Date(stateUpdatedAt).toISOString() : 'N/A',
            });

            // Update our state with the store's data
            state.workspaceData = { ...storeWorkspace };

            // Persist the change
            persistState();
          }
        }
      }
    });
  };

  // Helper function to add to navigation history with size limit
  const addToNavigationHistory = (
    type: string,
    id: string,
    label: string,
    additionalData?: Record<string, any>,
  ) => {
    // Don't add duplicate consecutive entries
    const currentEntry = state.navigation.history[state.navigation.currentIndex];
    if (currentEntry?.type === type && currentEntry?.id === id) {
      logger.debug('Skipping duplicate navigation entry', { type, id });
      return;
    }

    // Remove any forward history if we're not at the end
    if (state.navigation.currentIndex < state.navigation.history.length - 1) {
      state.navigation.history = state.navigation.history.slice(
        0,
        state.navigation.currentIndex + 1,
      );
    }

    // Add new entry with optional additional data and timestamp
    state.navigation.history.push({ type, id, timestamp: Date.now(), ...additionalData });
    state.navigation.currentIndex = state.navigation.history.length - 1;

    // Limit history size to prevent unbounded growth
    if (state.navigation.history.length > MAX_NAVIGATION_HISTORY) {
      // Remove oldest entries
      const toRemove = state.navigation.history.length - MAX_NAVIGATION_HISTORY;
      state.navigation.history = state.navigation.history.slice(toRemove);
      state.navigation.currentIndex = Math.max(0, state.navigation.currentIndex - toRemove);
      logger.debug('Trimmed navigation history', { removed: toRemove });
    }

    logger.debug('Added to navigation history', {
      type,
      id,
      label,
      currentIndex: state.navigation.currentIndex,
      historyLength: state.navigation.history.length,
    });
  };

  // Forward declare stateManager for event handlers
  // eslint-disable-next-line prefer-const
  let stateManager: any;

  // Event handlers for workspace events (defined before stateManager to avoid hoisting issues)
  const handleWorkspaceOpenFile = async (event: Event) => {
    const detail = (event as CustomEvent)?.detail;
    // Support both 'path' and 'filePath' for compatibility with different event sources
    let filePath = detail?.path || detail?.filePath;
    const line = detail?.line;
    const openInAdjacentPanel = detail?.openInAdjacentPanel;
    const sourcePanelId = detail?.sourcePanelId;

    // Strip leading @ if present (cleanup for legacy data or corrupted mentions)
    if (filePath?.startsWith('@')) {
      filePath = filePath.slice(1);
    }

    if (filePath) {
      logger.debug('Received workspace:open-file event', { filePath, line, openInAdjacentPanel });
      await stateManager.openFile(filePath, { line, openInAdjacentPanel, sourcePanelId });
    }
  };

  const handleWorkspaceOpenNote = async (event: Event) => {
    const detail = (event as CustomEvent)?.detail;
    const noteId = detail?.noteId;
    const openInAdjacentPanel = detail?.openInAdjacentPanel;
    const sourcePanelId = detail?.sourcePanelId;

    if (noteId) {
      logger.debug('Received workspace:open-note event', { noteId, openInAdjacentPanel });
      await stateManager.openNote(noteId, { openInAdjacentPanel, sourcePanelId });
    }
  };

  const handleWorkspaceOpenBrowserUrl = async (event: Event) => {
    const url = (event as CustomEvent)?.detail?.url;
    logger.debug('Received workspace:open-browser-url event', { url });

    if (url) {
      await stateManager.openBrowserUrl(url);
    }
  };

  const handleWorkspaceOpenDiff = (event: Event) => {
    const detail = (event as CustomEvent)?.detail;
    const change = detail?.change;
    const filePath = detail?.filePath;
    const changeId = detail?.changeId;
    const scrollToLine = detail?.scrollToLine;

    if (change) {
      const forceUpdate = detail?.forceUpdate;

      logger.debug('Received workspace:open-diff event', {
        changeId,
        stage: change?.stage,
        commitHash: change?.commitHash,
        hasContent: !!(change?.content?.oldContent || change?.content?.newContent),
        oldContentLength: change?.content?.oldContent?.length || 0,
        newContentLength: change?.content?.newContent?.length || 0,
        filePath,
        scrollToLine,
        forceUpdate,
      });

      // Check if the same file AND stage is already open - toggle it closed
      // But don't toggle if scrollToLine is specified (user wants to jump to a specific line)
      // And don't toggle if forceUpdate is true (we're just refreshing the selection)
      // Note: Same file at different stages (staged vs unstaged) should NOT toggle - they're different views
      const currentChangeId = state.mainPanel.selectedChangeId;
      const currentFile = state.mainPanel.selectedFile;
      const currentStage = state.mainPanel.selectedTrackedChange?.stage;
      const isCurrentlyShowingDiff = state.mainPanel.type === 'file-tracking-diff';
      const newFile = filePath || change.file || change.relativePath;
      const newStage = change.stage;

      // Only consider it "the same" if both file AND stage match
      // Don't use changeId comparison as change IDs can be the same for the same file at different stages
      const isSameFileAndStage =
        isCurrentlyShowingDiff && currentFile === newFile && currentStage === newStage;

      // Toggle off only if same file/stage AND not a forced update AND no scrollToLine
      if (isSameFileAndStage && !scrollToLine && !forceUpdate) {
        // Toggle off - go back to accept-changes view
        state.mainPanel.type = 'accept-changes';
        state.mainPanel.selectedTrackedChange = undefined;
        state.mainPanel.selectedFile = undefined;
        state.mainPanel.selectedChangeId = undefined;
        state.mainPanel.scrollToLine = undefined;

        persistState();
        stateManager.updateCurrentContext();
        return;
      }

      // Update state for diff view
      state.mainPanel.type = 'file-tracking-diff';
      state.mainPanel.selectedTrackedChange = change;
      state.mainPanel.selectedFile = filePath || change.file || change.relativePath;
      state.mainPanel.selectedChangeId = changeId;
      state.mainPanel.selectedNoteId = undefined;
      state.mainPanel.scrollToLine = scrollToLine;

      // Add to navigation history with the tracked change data for restoration
      addToNavigationHistory('diff', changeId || change.id, filePath?.split('/').pop() || 'Diff', {
        trackedChange: change,
        filePath: filePath || change.file || change.relativePath,
      });

      persistState();
      // Update current context for MCP tools
      stateManager.updateCurrentContext();
    }
  };

  const handleWorkspaceOpenCommit = async (event: Event) => {
    logger.debug('Received workspace:open-commit event');

    // Force update state even if it's already 'change-set' to ensure reactivity
    // First clear it if it's already set to trigger reactive updates
    if (state.mainPanel.type === 'change-set') {
      state.mainPanel.type = 'empty';
    }

    // Update state for commit view - use "change-set" which is the expected type
    state.mainPanel.type = 'change-set';
    state.mainPanel.selectedFile = undefined;
    state.mainPanel.selectedNoteId = undefined;
    state.mainPanel.selectedTrackedChange = undefined;
    state.mainPanel.selectedChangeId = undefined;

    // Add to navigation history
    addToNavigationHistory('change-set', 'commit', 'Commit Changes');

    // Load git status to ensure we have the latest changes
    if (state.workspace?.id) {
      const { gitStore } = await import('$features/git/git.store.svelte');
      await gitStore.loadStatus(WorkspaceIdFn(state.workspace.id), true); // Force refresh
    }

    persistState();
    // Update current context for MCP tools
    stateManager.updateCurrentContext();
  };

  const handleWorkspaceNavigateToChanges = (event: Event) => {
    const detail = (event as CustomEvent)?.detail as
      | {
          type: 'agent-turn-changes';
          agentId: string;
          sessionId?: string;
          turnNumber?: number;
        }
      | {
          type: 'activity-changes';
          event: WorkspaceEvent;
        }
      | undefined;

    if (!detail || !detail.type) {
      logger.warn('workspace:navigate-to-changes event missing detail', { detail });
      return;
    }

    if (detail.type === 'agent-turn-changes') {
      const { agentId, sessionId, turnNumber } = detail;

      if (!agentId) {
        logger.warn('workspace:navigate-to-changes agent-turn-changes missing agentId', { detail });
        return;
      }

      logger.debug('Navigating to agent turn changes', { agentId, sessionId, turnNumber });

      stateManager.setMainPanel('agent-turn-changes', {
        selectedAgentTurn: { agentId, sessionId, turnNumber },
        selectedActivityEvent: undefined,
        selectedFile: undefined,
        selectedNoteId: undefined,
        selectedTrackedChange: undefined,
        selectedChangeId: undefined,
      });

      const id = `${agentId}:${typeof turnNumber === 'number' ? turnNumber : ''}`;
      // Store agent turn data in history for restoration
      addToNavigationHistory('agent-turn-changes', id, 'Agent Turn Changes', {
        agentTurnData: { agentId, sessionId, turnNumber },
      });
    } else if (detail.type === 'activity-changes') {
      const activityEvent = detail.event;
      if (!activityEvent) {
        logger.warn('workspace:navigate-to-changes activity-changes missing event', { detail });
        return;
      }

      logger.debug('Navigating to activity changes', {
        eventId: (activityEvent as any).id,
        type: activityEvent.type,
      });

      stateManager.setMainPanel('activity-changes', {
        selectedActivityEvent: activityEvent,
        selectedAgentTurn: undefined,
        selectedFile: undefined,
        selectedNoteId: undefined,
        selectedTrackedChange: undefined,
        selectedChangeId: undefined,
      });

      const id =
        (activityEvent as any).id ||
        `${activityEvent.type}:${activityEvent.timestamp || Date.now()}`;
      // Store activity event data in history for restoration
      addToNavigationHistory('activity-changes', id, 'Activity Changes', {
        activityEventData: activityEvent,
      });
    } else {
      logger.warn('workspace:navigate-to-changes received unknown type', { detail });
    }
  };

  const handleWorkspaceOpenChatChanges = (event: Event) => {
    const detail = (event as CustomEvent)?.detail as {
      changes: any[];
      title: string;
      messageId?: string;
      isAggregate?: boolean;
      agentId?: string;
      turnNumber?: number;
    };

    if (!detail?.changes) {
      logger.warn('workspace:open-chat-changes missing changes', { detail });
      return;
    }

    logger.info('[workspace-unified-state] Opening chat changes view', {
      changesCount: detail.changes.length,
      title: detail.title,
      messageId: detail.messageId,
      isAggregate: detail.isAggregate,
      agentId: detail.agentId,
      turnNumber: detail.turnNumber,
      changes: detail.changes,
    });

    // Update state for chat changes view
    stateManager.setMainPanel('chat-changes', {
      chatChanges: detail.changes,
      chatChangesTitle: detail.title,
      chatChangesMessageId: detail.messageId,
      chatChangesIsAggregate: detail.isAggregate,
      chatChangesAgentId: detail.agentId,
      chatChangesTurnNumber: detail.turnNumber,
    });

    // Add to navigation history with additional data for restoring
    addToNavigationHistory('chat-changes', detail.messageId || 'aggregate', detail.title, {
      chatChanges: detail.changes,
      chatChangesTitle: detail.title,
      chatChangesMessageId: detail.messageId,
      chatChangesIsAggregate: detail.isAggregate,
      chatChangesAgentId: detail.agentId,
      chatChangesTurnNumber: detail.turnNumber,
    });

    persistState();
    stateManager.updateCurrentContext();
  };

  const handleWorkspaceOpenLocalChanges = () => {
    logger.info('[workspace-unified-state] Opening local changes view');

    // Update state for local changes view
    stateManager.setMainPanel('local-changes', {});

    // Add to navigation history
    addToNavigationHistory('local-changes', 'local', 'Local Changes', {});

    persistState();
    stateManager.updateCurrentContext();
  };

  const handleWorkspaceOpenCommitChangeset = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    const { commitHash, commitMessage } = detail || {};

    logger.info('[workspace-unified-state] Opening commit changeset view', { commitHash });

    // Update state for commit changeset view
    stateManager.setMainPanel('commit-changeset', {
      commitHash,
      commitMessage,
    });

    // Add to navigation history
    const title = commitMessage
      ? `Commit: ${commitMessage.substring(0, 30)}${commitMessage.length > 30 ? '...' : ''}`
      : `Commit ${commitHash?.substring(0, 7) || 'unknown'}`;
    addToNavigationHistory('commit-changeset', commitHash || 'commit', title, {
      commitHash,
      commitMessage,
    });

    persistState();
    stateManager.updateCurrentContext();
  };

  const handleWorkspaceOpenCodeReview = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    logger.info('[workspace-unified-state] Opening code review view', { detail });

    // Update state for code review view
    stateManager.setMainPanel('code-review', {
      result: detail?.result,
      agentId: detail?.agentId,
      stagedFiles: detail?.stagedFiles,
      status: detail?.status || 'running',
    });

    // Add to navigation history
    addToNavigationHistory('code-review', 'review', 'Code Review', {});

    persistState();
    stateManager.updateCurrentContext();
  };

  const handleWorkspaceCodeReviewUpdate = (event: Event) => {
    const detail = (event as CustomEvent).detail;

    logger.info('[workspace-unified-state] Received code review update', {
      detail,
      currentType: state.mainPanel.type,
      isCodeReviewPanel: state.mainPanel.type === 'code-review',
    });

    // Only update if we're currently showing the code review panel
    if (state.mainPanel.type === 'code-review') {
      // Access code review data directly from mainPanel (not nested under .data)
      const currentResult = (state.mainPanel as any).result;
      const currentStatus = (state.mainPanel as any).status;
      const currentStreamingText = (state.mainPanel as any).streamingText;

      logger.info('[workspace-unified-state] Updating code review state', {
        newStatus: detail?.status,
        currentStatus,
        hasResult: !!detail?.result,
        resultLength: detail?.result?.length,
      });

      stateManager.setMainPanel('code-review', {
        result: detail?.result ?? currentResult,
        agentId: detail?.agentId ?? (state.mainPanel as any).agentId,
        stagedFiles: detail?.stagedFiles ?? (state.mainPanel as any).stagedFiles,
        status: detail?.status ?? currentStatus,
        streamingText: detail?.streamingText ?? currentStreamingText,
        error: detail?.error,
      });
    }
  };

  // Setup event listeners (to be called from component)
  const setupEventListeners = () => {
    if (typeof window !== 'undefined') {
      logger.debug('Setting up workspace event listeners');
      window.addEventListener('workspace:open-file', handleWorkspaceOpenFile);
      window.addEventListener('workspace:open-note', handleWorkspaceOpenNote);
      window.addEventListener('workspace:open-browser-url', handleWorkspaceOpenBrowserUrl);
      window.addEventListener('workspace:open-diff', handleWorkspaceOpenDiff);
      window.addEventListener('workspace:open-commit', handleWorkspaceOpenCommit);
      window.addEventListener('workspace:navigate-to-changes', handleWorkspaceNavigateToChanges);
      window.addEventListener('workspace:open-chat-changes', handleWorkspaceOpenChatChanges);
      window.addEventListener('workspace:open-local-changes', handleWorkspaceOpenLocalChanges);
      window.addEventListener(
        'workspace:open-commit-changeset',
        handleWorkspaceOpenCommitChangeset,
      );
      window.addEventListener('workspace:open-code-review', handleWorkspaceOpenCodeReview);
      window.addEventListener('workspace:code-review-update', handleWorkspaceCodeReviewUpdate);

      return () => {
        window.removeEventListener('workspace:open-file', handleWorkspaceOpenFile);
        window.removeEventListener('workspace:open-note', handleWorkspaceOpenNote);
        window.removeEventListener('workspace:open-browser-url', handleWorkspaceOpenBrowserUrl);
        window.removeEventListener('workspace:open-diff', handleWorkspaceOpenDiff);
        window.removeEventListener('workspace:open-commit', handleWorkspaceOpenCommit);
        window.removeEventListener(
          'workspace:navigate-to-changes',
          handleWorkspaceNavigateToChanges,
        );
        window.removeEventListener('workspace:open-chat-changes', handleWorkspaceOpenChatChanges);
        window.removeEventListener('workspace:open-local-changes', handleWorkspaceOpenLocalChanges);
        window.removeEventListener(
          'workspace:open-commit-changeset',
          handleWorkspaceOpenCommitChangeset,
        );
        window.removeEventListener('workspace:open-code-review', handleWorkspaceOpenCodeReview);
        window.removeEventListener('workspace:code-review-update', handleWorkspaceCodeReviewUpdate);
      };
    }
    return null;
  };

  stateManager = {
    // State access
    get state() {
      return state;
    },
    get isOptimistic() {
      return isOptimistic;
    },
    get transition() {
      return transition;
    },

    // Get persisted state from storage (used for restoring drawer state after agent load)
    getPersistedState() {
      const persistedState = workspaceStorageManager.loadState(workspaceId);
      logger.debug('[getPersistedState] Retrieved persisted state', {
        workspaceId,
        hasState: !!persistedState,
        drawer: persistedState?.drawer,
      });
      return persistedState;
    },

    // Derived state
    get hasCodeChanges() {
      return hasCodeChanges;
    },
    get hasActivityEvents() {
      return hasActivityEvents;
    },

    // Setup functions (to be called from component effects)
    setupEventListeners,

    // Setup effects that need component context
    setupEffects() {
      // This function should be called from a component's $effect
      // to set up reactive synchronization with the workspace store
      syncWorkspaceStore();
    },

    get hasSpecContent() {
      return hasSpecContent;
    },
    get shouldHideMainContent() {
      return shouldHideMainContent;
    },
    get canGoBack() {
      return canGoBack;
    },
    get canGoForward() {
      return canGoForward;
    },

    // State updates
    updateState(updates: Partial<UnifiedWorkspaceState>) {
      Object.assign(state, updates);
      logger.debug('State updated', { updates: Object.keys(updates) });
      // Don't auto-persist to avoid loops - caller should persist if needed
    },

    // Panel management
    async setMainPanel(type: string, selection?: Record<string, unknown>) {
      // Save scroll position before navigating away from notes
      await this.saveScrollPositionBeforeNavigation();

      state.mainPanel = {
        ...state.mainPanel,
        type,
        ...selection,
      };

      // Add to navigation history for panels that support it
      // Note: Some panels (file, note, diff, browser, accept-changes) have their own
      // dedicated methods that handle history, so we only add for other panel types
      switch (type) {
        case 'activity':
          addToNavigationHistory('activity', 'activity', 'Activity Log');
          break;
        case 'dashboard':
          addToNavigationHistory('dashboard', 'dashboard', 'Dashboard');
          break;
        case 'staged':
          addToNavigationHistory('staged', 'staged', 'Staged Changes');
          break;
        case 'unstaged':
          addToNavigationHistory('unstaged', 'unstaged', 'Unstaged Changes');
          break;
        case 'commit':
          if (selection?.selectedCommit) {
            const commit = selection.selectedCommit as { hash: string; message?: string };
            addToNavigationHistory(
              'commit',
              commit.hash,
              commit.message?.slice(0, 50) || 'Commit',
              { selectedCommit: commit },
            );
          }
          break;
        case 'source':
          if (selection?.selectedSourceId) {
            addToNavigationHistory('source', selection.selectedSourceId as string, 'Source', {
              selectedSourceId: selection.selectedSourceId,
            });
          }
          break;
        case 'agent-aggregate-changes':
          if (selection?.selectedAgentTurn) {
            const turn = selection.selectedAgentTurn as {
              agentId: string;
              sessionId?: string;
              turnNumber?: number;
            };
            const id = `${turn.agentId}:aggregate`;
            addToNavigationHistory('agent-aggregate-changes', id, 'Aggregate Changes', {
              agentTurnData: turn,
            });
          }
          break;
        // Other panel types (file, note, diff, browser, accept-changes, etc.)
        // have dedicated methods that handle history
      }

      // Persist after user action
      persistState();
      // Update current context for MCP tools
      this.updateCurrentContext();
    },

    openDrawer(type: 'agent' | 'terminal' | 'overview', itemId: string) {
      state.drawer = { open: true, type, itemId };
      // Persist after user action
      persistState();
    },

    closeDrawer() {
      state.drawer = { open: false, type: null, itemId: null };
      // Persist after user action
      persistState();
    },

    toggleOverview() {
      if (state.drawer.open && state.drawer.type === 'overview') {
        state.drawer = { open: false, type: null, itemId: null };
      } else {
        state.drawer = { open: true, type: 'overview', itemId: null };
      }
      // Persist after user action
      persistState();
    },

    /**
     * Save scroll position for the current navigation entry
     */
    saveScrollPosition(scrollPosition: number) {
      const currentEntry = state.navigation.history[state.navigation.currentIndex];
      if (currentEntry) {
        currentEntry.scrollPosition = scrollPosition;
        logger.debug('Saved scroll position', {
          index: state.navigation.currentIndex,
          scrollPosition,
        });
      }
    },

    /**
     * Save scroll position before navigating away from current view.
     * This dispatches an event to get the current scroll position from the note/file editor.
     * Returns a promise that resolves when the scroll position has been saved.
     */
    saveScrollPositionBeforeNavigation(): Promise<void> {
      return new Promise((resolve) => {
        // Save scroll position for notes
        if (state.mainPanel.type === 'notes') {
          const event = new CustomEvent('note:save-scroll-position', {
            detail: {
              callback: (scrollTop: number) => {
                this.saveScrollPosition(scrollTop);
                resolve();
              },
            },
          });
          window.dispatchEvent(event);
          // Resolve after a short timeout in case no handler responds
          setTimeout(resolve, 50);
        } else if (state.mainPanel.type === 'file') {
          // Save scroll position for files
          const event = new CustomEvent('file:save-scroll-position', {
            detail: {
              callback: (scrollTop: number) => {
                this.saveScrollPosition(scrollTop);
                resolve();
              },
            },
          });
          window.dispatchEvent(event);
          // Resolve after a short timeout in case no handler responds
          setTimeout(resolve, 50);
        } else {
          resolve();
        }
      });
    },

    /**
     * Restore scroll position after navigating to a note.
     * This dispatches an event to restore the scroll position in the note editor.
     */
    restoreScrollPosition(noteId: string, scrollPosition: number) {
      if (typeof scrollPosition !== 'number') return;

      // Delay to allow the note content to render
      requestAnimationFrame(() => {
        window.dispatchEvent(
          new CustomEvent('note:restore-scroll-position', {
            detail: {
              scrollPosition,
              noteId,
            },
          }),
        );
        logger.debug('Dispatched scroll position restore', { noteId, scrollPosition });
      });
    },

    /**
     * Restore scroll position after navigating to a file.
     * This dispatches an event to restore the scroll position in the code editor.
     */
    restoreFileScrollPosition(filePath: string, scrollPosition: number) {
      if (typeof scrollPosition !== 'number') return;

      // Delay to allow the file content to render
      requestAnimationFrame(() => {
        window.dispatchEvent(
          new CustomEvent('file:restore-scroll-position', {
            detail: {
              scrollPosition,
              filePath,
            },
          }),
        );
        logger.debug('Dispatched file scroll position restore', { filePath, scrollPosition });
      });
    },

    /**
     * Restore scroll position for the current view on initial load.
     * Should be called after the component has mounted and content is rendered.
     */
    restoreInitialScrollPosition() {
      const currentEntry = state.navigation.history[state.navigation.currentIndex];
      if (!currentEntry || typeof currentEntry.scrollPosition !== 'number') {
        return;
      }

      const scrollPosition = currentEntry.scrollPosition;

      if (state.mainPanel.type === 'notes' && currentEntry.type === 'note') {
        const noteId = currentEntry.id || '';
        // Use multiple attempts with increasing delays to handle different mount timings
        [100, 250, 500].forEach((delay) => {
          setTimeout(() => {
            this.restoreScrollPosition(noteId, scrollPosition);
          }, delay);
        });
        logger.debug('Scheduled initial scroll position restore for note', {
          noteId,
          scrollPosition,
        });
      } else if (state.mainPanel.type === 'file' && currentEntry.type === 'file') {
        const filePath = currentEntry.id || '';
        // Use multiple attempts with increasing delays to handle different mount timings
        [100, 250, 500].forEach((delay) => {
          setTimeout(() => {
            this.restoreFileScrollPosition(filePath, scrollPosition);
          }, delay);
        });
        logger.debug('Scheduled initial scroll position restore for file', {
          filePath,
          scrollPosition,
        });
      }
    },

    async goBack() {
      if (state.navigation.currentIndex > 0) {
        // Save scroll position before navigating away
        await this.saveScrollPositionBeforeNavigation();

        state.navigation.currentIndex--;
        const entry = state.navigation.history[state.navigation.currentIndex];

        if (entry) {
          // Update main panel state based on entry type (without adding to history)
          this._navigateToHistoryEntry(entry);
        }

        return entry;
      }
      return null;
    },

    async goForward() {
      if (state.navigation.currentIndex < state.navigation.history.length - 1) {
        // Save scroll position before navigating away
        await this.saveScrollPositionBeforeNavigation();

        state.navigation.currentIndex++;
        const entry = state.navigation.history[state.navigation.currentIndex];

        if (entry) {
          // Update main panel state based on entry type (without adding to history)
          this._navigateToHistoryEntry(entry);
        }

        return entry;
      }
      return null;
    },

    /**
     * Navigate to a history entry without adding to history.
     * Used by goBack() and goForward() to update the main panel state.
     * @internal
     */
    _navigateToHistoryEntry(entry: {
      type: string;
      id?: string;
      scrollPosition?: number;
      [key: string]: unknown;
    }) {
      switch (entry.type) {
        case 'note':
          state.mainPanel.type = 'notes';
          state.mainPanel.selectedNoteId = entry.id;
          state.mainPanel.selectedFile = undefined;
          state.mainPanel.selectedChangeId = undefined;
          state.mainPanel.selectedTrackedChange = undefined;
          // Clear file tracking store's main panel view
          if (fileTrackingStore.mainPanelView) {
            fileTrackingStore.clearMainPanelView();
          }
          // Restore scroll position after a short delay to allow DOM to update
          if (typeof entry.scrollPosition === 'number') {
            // Use multiple attempts with increasing delays to handle different mount timings
            const scrollPosition = entry.scrollPosition;
            const noteId = entry.id || '';
            [50, 150, 300].forEach((delay) => {
              setTimeout(() => {
                this.restoreScrollPosition(noteId, scrollPosition);
              }, delay);
            });
          }
          break;
        case 'file':
          state.mainPanel.type = 'file';
          state.mainPanel.selectedFile = entry.id;
          state.mainPanel.selectedNoteId = undefined;
          state.mainPanel.selectedChangeId = undefined;
          state.mainPanel.selectedTrackedChange = undefined;
          if (fileTrackingStore.mainPanelView) {
            fileTrackingStore.clearMainPanelView();
          }
          // Restore scroll position after a short delay to allow DOM to update
          if (typeof entry.scrollPosition === 'number') {
            const scrollPosition = entry.scrollPosition;
            const filePath = entry.id || '';
            [50, 150, 300].forEach((delay) => {
              setTimeout(() => {
                this.restoreFileScrollPosition(filePath, scrollPosition);
              }, delay);
            });
          }
          break;
        case 'diff':
          state.mainPanel.type = 'file-tracking-diff';
          state.mainPanel.selectedChangeId = entry.id;
          // Restore tracked change data from the entry
          if (entry.trackedChange) {
            state.mainPanel.selectedTrackedChange = entry.trackedChange as TrackedChange;
          }
          if (entry.filePath) {
            state.mainPanel.selectedFile = entry.filePath as string;
          } else {
            state.mainPanel.selectedFile = entry.id;
          }
          state.mainPanel.selectedNoteId = undefined;
          break;
        case 'accept-changes':
          state.mainPanel.type = 'accept-changes';
          state.mainPanel.selectedFile = undefined;
          state.mainPanel.selectedNoteId = undefined;
          break;
        case 'chat-changes':
          state.mainPanel.type = 'chat-changes';
          // Restore chat-changes specific data from the entry
          if (entry.chatChanges) state.mainPanel.chatChanges = entry.chatChanges as any[];
          if (entry.chatChangesTitle)
            state.mainPanel.chatChangesTitle = entry.chatChangesTitle as string;
          if (entry.chatChangesAgentId)
            state.mainPanel.chatChangesAgentId = entry.chatChangesAgentId as string;
          if (entry.chatChangesTurnNumber !== undefined)
            state.mainPanel.chatChangesTurnNumber = entry.chatChangesTurnNumber as number;
          if (entry.chatChangesIsAggregate !== undefined)
            state.mainPanel.chatChangesIsAggregate = entry.chatChangesIsAggregate as boolean;
          break;
        case 'dashboard':
          state.mainPanel.type = 'dashboard';
          state.mainPanel.selectedFile = undefined;
          state.mainPanel.selectedNoteId = undefined;
          break;
        case 'change-set':
          state.mainPanel.type = 'change-set';
          state.mainPanel.selectedFile = undefined;
          state.mainPanel.selectedNoteId = undefined;
          state.mainPanel.selectedTrackedChange = undefined;
          state.mainPanel.selectedChangeId = undefined;
          break;
        case 'agent-turn-changes':
          state.mainPanel.type = 'agent-turn-changes';
          // Restore agent turn data from the entry
          if (entry.agentTurnData) {
            const turnData = entry.agentTurnData as {
              agentId: string;
              sessionId?: string;
              turnNumber?: number;
            };
            state.mainPanel.selectedAgentTurn = turnData;
          }
          state.mainPanel.selectedActivityEvent = undefined;
          state.mainPanel.selectedFile = undefined;
          state.mainPanel.selectedNoteId = undefined;
          state.mainPanel.selectedTrackedChange = undefined;
          state.mainPanel.selectedChangeId = undefined;
          break;
        case 'activity-changes':
          state.mainPanel.type = 'activity-changes';
          // Restore activity event data from the entry
          if (entry.activityEventData) {
            state.mainPanel.selectedActivityEvent = entry.activityEventData as WorkspaceEvent;
          }
          state.mainPanel.selectedAgentTurn = undefined;
          state.mainPanel.selectedFile = undefined;
          state.mainPanel.selectedNoteId = undefined;
          state.mainPanel.selectedTrackedChange = undefined;
          state.mainPanel.selectedChangeId = undefined;
          break;
        case 'local-changes':
          state.mainPanel.type = 'local-changes';
          state.mainPanel.selectedFile = undefined;
          state.mainPanel.selectedNoteId = undefined;
          break;
        case 'browser':
          state.mainPanel.type = 'browser';
          state.mainPanel.selectedBrowserUrl = entry.id;
          state.mainPanel.selectedFile = undefined;
          state.mainPanel.selectedNoteId = undefined;
          state.mainPanel.selectedTrackedChange = undefined;
          state.mainPanel.selectedChangeId = undefined;
          if (fileTrackingStore.mainPanelView) {
            fileTrackingStore.clearMainPanelView();
          }
          break;
        case 'activity':
          state.mainPanel.type = 'activity';
          state.mainPanel.selectedFile = undefined;
          state.mainPanel.selectedNoteId = undefined;
          state.mainPanel.selectedActivityEvent = undefined;
          break;
        case 'staged':
          state.mainPanel.type = 'staged';
          state.mainPanel.selectedFile = undefined;
          state.mainPanel.selectedNoteId = undefined;
          break;
        case 'unstaged':
          state.mainPanel.type = 'unstaged';
          state.mainPanel.selectedFile = undefined;
          state.mainPanel.selectedNoteId = undefined;
          break;
        case 'commit':
          state.mainPanel.type = 'commit';
          // Restore commit data from entry
          if (entry.selectedCommit) {
            (state.mainPanel as any).selectedCommit = entry.selectedCommit;
          }
          state.mainPanel.selectedFile = undefined;
          state.mainPanel.selectedNoteId = undefined;
          break;
        case 'source':
          state.mainPanel.type = 'source';
          // Restore source ID from entry
          if (entry.selectedSourceId) {
            (state.mainPanel as any).selectedSourceId = entry.selectedSourceId;
          }
          state.mainPanel.selectedFile = undefined;
          state.mainPanel.selectedNoteId = undefined;
          break;
        case 'agent-aggregate-changes':
          state.mainPanel.type = 'agent-aggregate-changes';
          // Restore agent turn data from entry
          if (entry.agentTurnData) {
            const turnData = entry.agentTurnData as {
              agentId: string;
              sessionId?: string;
              turnNumber?: number;
            };
            state.mainPanel.selectedAgentTurn = turnData;
          }
          state.mainPanel.selectedActivityEvent = undefined;
          state.mainPanel.selectedFile = undefined;
          state.mainPanel.selectedNoteId = undefined;
          break;
        case 'code-review':
          state.mainPanel.type = 'code-review';
          state.mainPanel.selectedFile = undefined;
          state.mainPanel.selectedNoteId = undefined;
          break;
        default:
          logger.warn('Unknown history entry type', { type: entry.type });
      }
      persistState();
    },

    // Mark state as initialized
    markInitialized() {
      state.ui.hasInitialized = true;
      state.ui.lastUpdated = Date.now();

      // Add the initial view to navigation history if history is empty
      // This ensures the user can navigate back to the initial view (e.g., spec note)
      if (state.navigation.history.length === 0 && state.navigation.currentIndex === -1) {
        const mainPanelType = state.mainPanel.type;
        if (mainPanelType === 'notes' && state.mainPanel.selectedNoteId) {
          addToNavigationHistory('note', state.mainPanel.selectedNoteId, 'Note');
          logger.debug('Added initial note to navigation history', {
            noteId: state.mainPanel.selectedNoteId,
          });
        } else if (mainPanelType === 'file' && state.mainPanel.selectedFile) {
          addToNavigationHistory(
            'file',
            state.mainPanel.selectedFile,
            state.mainPanel.selectedFile.split('/').pop() || 'File',
          );
          logger.debug('Added initial file to navigation history', {
            file: state.mainPanel.selectedFile,
          });
        } else if (mainPanelType === 'dashboard') {
          addToNavigationHistory('dashboard', 'dashboard', 'Dashboard');
          logger.debug('Added dashboard to navigation history');
        }
      }

      logger.debug('State marked as initialized', { workspaceId });
      persistState();
    },

    // File and note opening methods
    async openFile(
      filePath: string,
      options?: { line?: number; openInAdjacentPanel?: boolean; sourcePanelId?: string },
    ) {
      if (!filePath) {
        logger.warn('Cannot open file - no file path provided');
        return;
      }

      logger.debug('Opening file', { filePath, options });

      // If openInAdjacentPanel is requested, use panel layout manager
      if (options?.openInAdjacentPanel) {
        const panelLayoutManager = getPanelLayoutManager(workspaceId);
        const fileName = filePath.split('/').pop() || 'File';
        panelLayoutManager.openTabInAdjacentOrSplit(
          {
            type: 'file',
            title: fileName,
            closable: true,
            filePath,
            workspaceId,
            data: options.line ? { line: options.line } : undefined,
          },
          options.sourcePanelId,
        );
        // Request focus on the new panel
        if (panelLayoutManager.focusedPanelId) {
          window.dispatchEvent(
            new CustomEvent('panel:request-focus', {
              detail: { panelId: panelLayoutManager.focusedPanelId },
            }),
          );
        }
        return;
      }

      // Save scroll position before navigating away from current note
      await this.saveScrollPositionBeforeNavigation();

      // Update state
      state.mainPanel.type = 'file';
      state.mainPanel.selectedFile = filePath;
      state.mainPanel.selectedNoteId = undefined;
      state.mainPanel.selectedChangeId = undefined;
      state.mainPanel.selectedTrackedChange = undefined;

      // Handle jump to line if specified - use panel layout manager for line navigation
      if (options?.line) {
        state.ui.jumpToLine = options.line;
        // Also update the panel tab's data for panel layout system
        const panelLayoutManager = getPanelLayoutManager(workspaceId);
        const fileName = filePath.split('/').pop() || 'File';
        panelLayoutManager.openTab({
          type: 'file',
          title: fileName,
          closable: true,
          filePath,
          workspaceId,
          data: { line: options.line, jumpTimestamp: Date.now() },
        });
      }

      // Add to navigation history
      addToNavigationHistory('file', filePath, filePath.split('/').pop() || 'File');

      // Clear file tracking store's main panel view
      if (fileTrackingStore.mainPanelView) {
        fileTrackingStore.clearMainPanelView();
      }

      persistState();
    },

    async openBrowserUrl(url: string) {
      if (!url) {
        logger.warn('Cannot open browser URL - no URL provided');
        return;
      }

      logger.debug('Opening browser URL in panel tab', { url });

      // Extract domain from URL for tab title
      let title = url;
      try {
        const urlObj = new URL(url);
        title = urlObj.hostname;
      } catch {
        // If URL parsing fails, use the full URL
      }

      // Open in panel tab using panel layout manager
      const panelLayoutManager = getPanelLayoutManager(workspaceId);
      panelLayoutManager.openTab({
        type: 'browser',
        title,
        closable: true,
        browserUrl: url,
        workspaceId,
      });

      // Update current context for MCP tools
      this.updateCurrentContext();
    },

    async openNote(
      noteId: string,
      options?: { openInAdjacentPanel?: boolean; sourcePanelId?: string },
    ) {
      if (!noteId) {
        logger.warn('Cannot open note - no note ID provided');
        return;
      }

      // If openInAdjacentPanel is requested, use panel layout manager
      if (options?.openInAdjacentPanel) {
        const panelLayoutManager = getPanelLayoutManager(workspaceId);
        panelLayoutManager.openTabInAdjacentOrSplit(
          {
            type: 'note',
            title: 'Note',
            closable: true,
            noteId,
            workspaceId,
          },
          options.sourcePanelId,
        );
        // Request focus on the new panel
        if (panelLayoutManager.focusedPanelId) {
          window.dispatchEvent(
            new CustomEvent('panel:request-focus', {
              detail: { panelId: panelLayoutManager.focusedPanelId },
            }),
          );
        }
        return;
      }

      // Check if we're navigating to a different note (not the same one)
      const currentNoteId = state.mainPanel.selectedNoteId;
      const isSameNote = state.mainPanel.type === 'notes' && currentNoteId === noteId;

      if (isSameNote) {
        logger.debug('Already viewing this note, skipping navigation', { noteId });
        return;
      }

      logger.debug('Opening note', { noteId, from: currentNoteId });

      // Save scroll position before navigating away from current note
      await this.saveScrollPositionBeforeNavigation();

      // Update state
      state.mainPanel.type = 'notes';
      state.mainPanel.selectedNoteId = noteId;
      state.mainPanel.selectedFile = undefined;
      state.mainPanel.selectedChangeId = undefined;
      state.mainPanel.selectedTrackedChange = undefined;

      // Add to navigation history
      addToNavigationHistory('note', noteId, 'Note');

      // Clear file tracking store's main panel view
      if (fileTrackingStore.mainPanelView) {
        fileTrackingStore.clearMainPanelView();
      }

      persistState();
    },

    // Open accept changes panel
    openAcceptChanges() {
      logger.debug('Opening accept changes panel');

      // Update state
      state.mainPanel.type = 'accept-changes';
      state.mainPanel.selectedFile = undefined;
      state.mainPanel.selectedNoteId = undefined;
      state.mainPanel.selectedTrackedChange = undefined;
      state.mainPanel.selectedChangeId = undefined;
      state.mainPanel.selectedBrowserUrl = undefined;

      // Add to navigation history
      addToNavigationHistory('accept-changes', 'accept-changes', 'Accept Changes');

      persistState();
      // Update current context for MCP tools
      stateManager.updateCurrentContext();
    },

    // Open diff panel with a tracked change
    openDiff(change: TrackedChange) {
      if (!change) {
        logger.warn('Cannot open diff - no change provided');
        return;
      }

      logger.debug('Opening diff panel', {
        changeId: change.id,
        file: change.relativePath || change.file,
      });

      // Update state
      state.mainPanel.type = 'file-tracking-diff';
      state.mainPanel.selectedTrackedChange = change;
      state.mainPanel.selectedFile = change.relativePath || change.file;
      state.mainPanel.selectedChangeId = change.id;
      state.mainPanel.selectedNoteId = undefined;

      // Add to navigation history
      const filePath = change.relativePath || change.file;
      addToNavigationHistory('diff', change.id, filePath?.split('/').pop() || 'Diff');

      // Clear file tracking store's main panel view
      if (fileTrackingStore.mainPanelView) {
        fileTrackingStore.clearMainPanelView();
      }

      persistState();
      // Update current context for MCP tools
      stateManager.updateCurrentContext();
    },

    // Open browser panel with URL
    openBrowser(url: string) {
      if (!url) {
        logger.warn('Cannot open browser - no URL provided');
        return;
      }

      logger.debug('Opening browser', { url });

      // Update state
      state.mainPanel.type = 'browser';
      state.mainPanel.selectedBrowserUrl = url;
      state.mainPanel.selectedFile = undefined;
      state.mainPanel.selectedNoteId = undefined;
      state.mainPanel.selectedTrackedChange = undefined;
      state.mainPanel.selectedChangeId = undefined;

      // Add to navigation history
      addToNavigationHistory('browser', url, 'Browser');

      // Clear file tracking store's main panel view
      if (fileTrackingStore.mainPanelView) {
        fileTrackingStore.clearMainPanelView();
      }

      persistState();
    },

    // Clear the commit view and reset to empty state
    clearCommitView() {
      logger.debug('Clearing commit view');

      // Reset main panel state
      state.mainPanel.type = 'empty';
      state.mainPanel.selectedFile = undefined;
      state.mainPanel.selectedNoteId = undefined;
      state.mainPanel.selectedTrackedChange = undefined;
      state.mainPanel.selectedChangeId = undefined;

      // Clear file tracking store's main panel view
      fileTrackingStore.clearMainPanelView();

      persistState();
      // Update current context for MCP tools
      stateManager.updateCurrentContext();
    },

    // Update current context for MCP tools
    async updateCurrentContext() {
      if (!state.workspace?.id) {
        return;
      }

      // Determine the correct mainContentId based on the panel type
      let mainContentId: string | undefined;
      let mainContentPath: string | undefined;
      let mainContentType: string = state.mainPanel.type;

      if (state.mainPanel.type === 'notes') {
        mainContentId = state.mainPanel.selectedNoteId;
      } else if (state.mainPanel.type === 'file') {
        mainContentId = state.mainPanel.selectedFile;
        mainContentPath = state.mainPanel.selectedFile;
      } else if (state.mainPanel.type === 'diff' || state.mainPanel.type === 'file-tracking-diff') {
        // Both diff types should be treated as "diff" in the context
        mainContentType = 'diff';
        mainContentId = state.mainPanel.selectedFile;
        mainContentPath = state.mainPanel.selectedFile;
      }

      const context: import('$shared/types').WorkspaceUIContext = {
        workspaceId: WorkspaceIdFn(state.workspace.id),
        mainContentType: mainContentType as any,
        mainContentId,
        mainContentPath,
        lastUpdated: new Date().toISOString(),
      };

      // Add diff info if viewing a diff
      if (
        (state.mainPanel.type === 'diff' || state.mainPanel.type === 'file-tracking-diff') &&
        state.mainPanel.selectedFile
      ) {
        // Try to get git status from the tracked change if available
        const trackedChange = state.mainPanel.selectedTrackedChange;
        if (trackedChange) {
          context.diffInfo = {
            additions: trackedChange.stats?.additions || 0,
            deletions: trackedChange.stats?.deletions || 0,
            isStaged: trackedChange.stage === 'staged',
            gitStatus: 'modified',
            changeType: 'modified',
          };
        } else {
          // Fallback to basic info if no tracked change available
          context.diffInfo = {
            additions: 0,
            deletions: 0,
            isStaged: false,
            gitStatus: 'modified',
            changeType: 'modified',
          };
        }
      }

      try {
        const { workspaceStore } = await import('./workspace.store.svelte');
        await workspaceStore.updateCurrentContext(WorkspaceIdFn(state.workspace.id), context);
        logger.debug('Current context updated', { context });
      } catch (error) {
        logger.error('Failed to update current context', error);
      }
    },

    // Handle file rename - update selectedFile and panel tabs if they match the old path
    handleFileRenamed(oldPath: string, newPath: string) {
      logger.info('handleFileRenamed called', { oldPath, newPath });

      // Update panel layout tabs for the renamed file
      const panelLayoutManager = getPanelLayoutManager(workspaceId);
      panelLayoutManager.updateFileTabPath(oldPath, newPath);

      // Get workspace path from state data
      const wsPath =
        state.workspaceData?.worktreePath ||
        state.workspaceData?.repositoryPath ||
        state.workspaceData?.path ||
        '';

      // Normalize paths for comparison - paths may be absolute or relative
      // Extract just the filename/relative path if needed
      const getRelativePath = (path: string): string => {
        if (!path) return '';
        // If it starts with workspace path, strip it
        if (wsPath && path.startsWith(wsPath)) {
          const stripped = path.slice(wsPath.length);
          return stripped.startsWith('/') ? stripped.slice(1) : stripped;
        }
        return path;
      };

      const oldRelative = getRelativePath(oldPath);
      const newRelative = getRelativePath(newPath);
      const selectedRelative = getRelativePath(state.mainPanel.selectedFile || '');

      // Check if the renamed file is currently open in the main panel (for non-panel layouts)
      const isMatch =
        state.mainPanel.selectedFile === oldPath ||
        state.mainPanel.selectedFile === oldRelative ||
        selectedRelative === oldRelative;

      if (isMatch) {
        const newSelectedFile = state.mainPanel.selectedFile === oldPath ? newPath : newRelative;

        logger.info('Updating selected file path after rename', {
          oldPath,
          newPath,
          previousSelectedFile: state.mainPanel.selectedFile,
          newSelectedFile,
        });
        state.mainPanel.selectedFile = newSelectedFile;

        // Also update navigation history entries that reference this file
        const history = state.navigation.history;
        for (const entry of history) {
          if (!entry.id) continue;
          const entryRelative = getRelativePath(entry.id);
          if (entry.type === 'file' && (entry.id === oldPath || entryRelative === oldRelative)) {
            entry.id = entry.id === oldPath ? newPath : newRelative;
            entry.label = newPath.split('/').pop() || 'File';
          }
          if (entry.filePath) {
            const filePathRelative = getRelativePath(entry.filePath as string);
            if (entry.filePath === oldPath || filePathRelative === oldRelative) {
              entry.filePath = entry.filePath === oldPath ? newPath : newRelative;
            }
          }
        }

        persistState();
        stateManager.updateCurrentContext();
      }
    },

    // Reset for workspace change
    reset() {
      // CRITICAL: Flush any pending saves BEFORE loading persisted state
      // The save queue uses 300ms debounce, so if user opens an agent and quickly switches
      // workspaces, the drawer state may not be persisted yet. Flushing ensures we get
      // the latest state when we load.
      globalSaveQueue.flush();

      // Load persisted state for this workspace
      // The persisted state is workspace-specific, so drawer/agent IDs are valid for this workspace
      const persistedWorkspaceState = workspaceStorageManager.loadState(workspaceId);

      const newState = persistedWorkspaceState || {
        version: 2,
        workspace: { id: workspaceId, status: 'loading' },
        mainPanel: { type: 'notes', selectedNoteId: 'spec' },
        drawer: { open: false, type: null, itemId: null },
        navigation: { history: [], currentIndex: -1 },
        ui: { hasInitialized: false, lastUpdated: Date.now() },
      };

      // Don't restore drawer state immediately - let the workspace page handle it
      // after checking for streaming agents to avoid the flash where we show
      // the persisted agent briefly before switching to a streaming agent
      // The workspace page will restore the persisted drawer state if there's no streaming agent
      newState.drawer = { open: false, type: null, itemId: null };

      Object.assign(state, {
        ...newState,
        workspace: null,
        agentsList: [],
        terminalsList: [],
        workspaceEvents: [],
        isEditingTitle: false,
        editingTitle: '',
        isDraggingOver: false,
        showPullRequestModal: false,
        showAugieSetup: false,
        showWorkspaceInitializer: false,
        isComponentMounted: true,
        agentsLoadingInProgress: false,
      });
    },

    // Clean up with improved async handling and race condition prevention
    async dispose() {
      // Prevent concurrent disposal
      if (activeCleanups.has(workspaceId)) {
        logger.debug('Disposal already in progress', { workspaceId });
        return;
      }

      activeCleanups.add(workspaceId);

      try {
        // Decrement reference count
        const refCount = (stateReferences.get(state) || 1) - 1;

        if (refCount <= 0) {
          // No more references, safe to clean up
          logger.debug('Starting full disposal', { workspaceId });

          // Mark state as unmounted immediately to prevent further updates
          state.isComponentMounted = false;

          // Remove event listeners first to prevent any further updates
          if (typeof window !== 'undefined') {
            window.removeEventListener('workspace:open-file', handleWorkspaceOpenFile);
            window.removeEventListener('workspace:open-note', handleWorkspaceOpenNote);
            window.removeEventListener('workspace:open-diff', handleWorkspaceOpenDiff);
          }

          // Try to flush pending saves, but don't wait too long
          // During page unload, we need to be quick or the cleanup will timeout
          try {
            // Use a very short timeout - if saves can't complete quickly, skip them
            // The data is already persisted in localStorage on regular intervals
            await Promise.race([
              globalSaveQueue.flush(),
              new Promise<void>((resolve) => setTimeout(resolve, 500)),
            ]);
            logger.debug('Final state save completed', { workspaceId });
          } catch (error) {
            // Don't log as error - this is expected during fast navigation
            logger.debug('Save queue flush skipped during cleanup', { workspaceId });
          }

          // Clear all state to free memory
          state.workspaceData = null;
          state.agentsList = [];
          state.terminalsList = [];
          state.workspaceEvents = [];

          // Clear navigation history to free memory
          state.navigation.history = [];
          state.navigation.currentIndex = -1;

          // Mark cache entry as disposed and clean up cross-window listener
          const cached = stateCache.get(workspaceId);
          if (cached) {
            cached.crossWindowUnsub?.();
            cached.disposed = true;
          }

          // Remove from cache and references
          stateCache.delete(workspaceId);
          stateReferences.delete(state);

          logger.debug('Workspace state fully disposed', { workspaceId });
        } else {
          // Still has references, just update count
          stateReferences.set(state, refCount);
          state.isComponentMounted = false;
          logger.debug('Workspace state reference decremented', { workspaceId, refCount });
        }
      } finally {
        // Always remove from active cleanups
        activeCleanups.delete(workspaceId);
      }
    },
  };

  return stateManager;
}

// Note: Cleanup is already handled by the beforeunload listener added at line 152
// which calls stopCleanupInterval. Additional cleanup logic moved there.
