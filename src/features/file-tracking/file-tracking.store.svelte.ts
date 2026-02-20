/**
 * File Tracking Store
 *
 * Reactive state management for file tracking using Svelte 5 runes.
 * This store coordinates with the git store for git status and provides
 * additional tracking for agent changes and UI state.
 */

import { untrack } from 'svelte';
import type {
  TrackedChange,
  StageTransition,
  WorkingChanges,
  ChangeFilter,
  FileListViewMode,
  MainPanelViewType,
  CommitInfo,
} from './types';
import { ChangeStage } from './types';
import {
  hasChangesDifference,
  hasTransitionsDifference,
  hasCommitsDifference,
} from './change-difference-utils';
import { invoke, invokeWithTimeout, IpcTimeoutError } from '$lib/electron-bridge';
import { Logger } from '$lib/utils/logger';
import { TRACKING_CONFIG } from './tracking.config';
import { FILE_TRACKING_CHANNELS } from '$shared/ipc/channels';

// Timeout constants for IPC operations
const IPC_INIT_TIMEOUT_MS = 10000; // 10 seconds for init (should be fast, it's a no-op)
const IPC_SYNC_TIMEOUT_MS = 30000; // 30 seconds for git sync
const IPC_LOAD_TIMEOUT_MS = 30000; // 30 seconds for loading data
const INIT_SAFETY_TIMEOUT_MS = 60000; // 60 seconds max for entire initialization

const logger = new Logger({ category: 'FileTrackingStore' });

// Type for main panel view state
interface MainPanelViewState {
  type: MainPanelViewType | 'diff';
  agentId?: string;
  sessionId?: string;
  turnNumber?: number;
  changeId?: string;
  change?: TrackedChange;
  commit?: { hash: string; message: string; author?: string; date?: string };
}

class FileTrackingStore {
  // State
  #changes: TrackedChange[] = $state([]);
  #transitions: StageTransition[] = $state([]);
  #commits: CommitInfo[] = $state([]);
  #boundarySha: string | null = $state(null);
  #olderCommits: CommitInfo[] = $state([]);
  #loadingOlderCommits = $state(false);
  #currentWorkspaceId: string | null = $state(null);
  #loading = $state(false);
  #error: string | null = $state(null);

  // Truncation state - tracks when there are more changes than we can display
  #changesTruncated = $state(false);
  #totalChangesCount = $state(0);

  // Track which workspace the current data belongs to
  // This is different from #currentWorkspaceId which tracks which workspace we WANT to display
  // Must be $state to trigger reactivity when data loads
  #dataWorkspaceId: string | null = $state(null);

  // Debouncing state
  #updateDebounceTimer: NodeJS.Timeout | null = null;
  #eventListenerCleanup: (() => void) | null = null;

  // Track pending stage/unstage operations to prevent reload from overwriting optimistic updates
  #pendingStageOperations = new Set<string>(); // Tracks by ID
  #pendingStageOperationsByPath = new Set<string>(); // Tracks by path (IDs can change)

  // Track paths with recent operations to prevent flickering during rapid state transitions
  // Maps path -> timestamp of last operation. Paths are excluded from loads for a short window.
  #recentOperationPaths = new Map<string, number>();
  readonly #OPERATION_COOLDOWN_MS = 1000; // Exclude paths from loads for 1 second after operation

  // Track initialization state to prevent parallel initializations
  #initializingWorkspaceId: string | null = null;
  #initializationPromise: Promise<void> | null = null;
  #hasLoadedInitialData = $state(false);

  // Sync throttling - prevent redundant sync calls
  #lastSyncTime = 0;
  #syncPromise: Promise<void> | null = null;
  readonly #SYNC_THROTTLE_MS = 10000; // Match backend MIN_SYNC_INTERVAL

  // Load deduplication - prevent concurrent loadWorkspaceData calls
  #loadPromise: Promise<void> | null = null;

  // Dirty flag - set when loadWorkspaceData() is called during an in-progress load.
  // After the current load completes, this triggers a fresh re-load so that
  // events arriving mid-load are not permanently lost.
  #loadDirty = false;

  // Sync dirty flag - same pattern as #loadDirty for syncWithGit().
  // Prevents sync requests from being silently dropped during an in-progress sync.
  #syncDirty = false;
  #syncDirtyForce = false;

  // Refresh deduplication - prevent concurrent refresh calls
  #refreshPromise: Promise<void> | null = null;

  // Configuration
  #config = TRACKING_CONFIG.fileTracking;

  // UI State
  #fileListViewMode: FileListViewMode = $state('flat');
  #mainPanelView: MainPanelViewState | null = $state(null);

  // PERF: Pre-computed stage sets for O(1) lookups
  static readonly #committedStages = new Set([
    ChangeStage.Committed,
    ChangeStage.Pushed,
    ChangeStage.PullRequest,
    ChangeStage.Merged,
    ChangeStage.Trunk,
  ]);

  // Derived state - PERF: Single pass through changes array
  // Returns empty if data belongs to different workspace
  workingChanges = $derived.by<WorkingChanges>(() => {
    // Return empty if data is stale (belongs to different workspace)
    if (this.#dataWorkspaceId !== this.#currentWorkspaceId) {
      logger.debug('[FileTrackingStore] workingChanges: workspace ID mismatch', {
        dataWorkspaceId: this.#dataWorkspaceId,
        currentWorkspaceId: this.#currentWorkspaceId,
      });
      return { unstaged: [], staged: [] };
    }
    const unstaged: TrackedChange[] = [];
    const staged: TrackedChange[] = [];
    for (const c of this.#changes) {
      if (c.stage === ChangeStage.Unstaged) unstaged.push(c);
      else if (c.stage === ChangeStage.Staged) staged.push(c);
    }
    logger.debug('[FileTrackingStore] workingChanges computed', {
      totalChanges: this.#changes.length,
      unstagedCount: unstaged.length,
      stagedCount: staged.length,
      dataWorkspaceId: this.#dataWorkspaceId,
      currentWorkspaceId: this.#currentWorkspaceId,
    });
    return { unstaged, staged };
  });

  committedChanges = $derived.by(() => {
    // Return empty if data is stale (belongs to different workspace)
    if (this.#dataWorkspaceId !== this.#currentWorkspaceId) {
      return [];
    }
    const committed: TrackedChange[] = [];
    for (const c of this.#changes) {
      if (FileTrackingStore.#committedStages.has(c.stage)) {
        committed.push(c);
      }
    }
    return committed;
  });

  // Getters - return empty if data belongs to a different workspace
  get changes() {
    // Return empty if data is stale (belongs to different workspace)
    if (this.#dataWorkspaceId !== this.#currentWorkspaceId) {
      return [];
    }
    return this.#changes;
  }

  get transitions() {
    // Return empty if data is stale (belongs to different workspace)
    if (this.#dataWorkspaceId !== this.#currentWorkspaceId) {
      return [];
    }
    return this.#transitions;
  }

  get commits() {
    // Return empty if data is stale (belongs to different workspace)
    if (this.#dataWorkspaceId !== this.#currentWorkspaceId) {
      return [];
    }
    return this.#commits;
  }

  get boundarySha() {
    if (this.#dataWorkspaceId !== this.#currentWorkspaceId) {
      return null;
    }
    return this.#boundarySha;
  }

  get olderCommits() {
    if (this.#dataWorkspaceId !== this.#currentWorkspaceId) {
      return [];
    }
    return this.#olderCommits;
  }

  get loadingOlderCommits() {
    return this.#loadingOlderCommits;
  }

  get loading() {
    return this.#loading;
  }

  get isInitialized() {
    // Only considered initialized if we have data for the current workspace
    return this.#hasLoadedInitialData && this.#dataWorkspaceId === this.#currentWorkspaceId;
  }

  get error() {
    return this.#error;
  }

  get fileListViewMode() {
    return this.#fileListViewMode;
  }

  get mainPanelView() {
    return this.#mainPanelView;
  }

  get currentWorkspaceId() {
    return this.#currentWorkspaceId;
  }

  /** Whether the changes list was truncated due to exceeding the limit */
  get changesTruncated() {
    // Return false if data belongs to a different workspace
    if (this.#dataWorkspaceId !== this.#currentWorkspaceId) {
      return false;
    }
    return this.#changesTruncated;
  }

  /** The total number of changes before truncation was applied */
  get totalChangesCount() {
    // Return 0 if data belongs to a different workspace
    if (this.#dataWorkspaceId !== this.#currentWorkspaceId) {
      return 0;
    }
    return this.#totalChangesCount;
  }

  // Initialize for a workspace
  async setWorkspace(workspaceId: string) {
    // If already initializing OR initialized for this workspace, skip or return promise
    if (this.#initializingWorkspaceId === workspaceId) {
      if (this.#initializationPromise) {
        logger.debug('[FileTrackingStore] Returning existing init promise', { workspaceId });
        return this.#initializationPromise;
      }
      // Already initializing but no promise (shouldn't happen, but guard against it)
      logger.debug('[FileTrackingStore] Already initializing, skipping', { workspaceId });
      return;
    }

    if (this.#currentWorkspaceId === workspaceId && this.#hasLoadedInitialData) {
      logger.debug('[FileTrackingStore] Already initialized, skipping', { workspaceId });
      return;
    }

    const isWorkspaceChange = this.#currentWorkspaceId !== workspaceId;

    logger.info('[FileTrackingStore] setWorkspace starting', {
      workspaceId,
      previousWorkspaceId: this.#currentWorkspaceId,
      isWorkspaceChange,
    });

    // CRITICAL: Set loading state IMMEDIATELY before any async work
    // This ensures UI shows loading state before the next render cycle
    this.#loading = true;
    this.#error = null;
    this.#hasLoadedInitialData = false;

    // Update currentWorkspaceId so components know which workspace is active
    this.#currentWorkspaceId = workspaceId;

    // DON'T clear changes immediately - keep showing old data with loading indicator
    // The data will be replaced atomically when new data loads
    // This prevents the flash of empty content during workspace switches

    // Mark that we're initializing this workspace (prevents parallel initializations)
    this.#initializingWorkspaceId = workspaceId;

    // Create and store the initialization promise
    this.#initializationPromise = this.#doSetWorkspace(workspaceId);

    try {
      await this.#initializationPromise;
    } catch (error) {
      // Handle any errors that escape #doSetWorkspace
      logger.error('[FileTrackingStore] setWorkspace error', error as Error, { workspaceId });
      // Ensure loading state is cleared even on error
      if (this.#currentWorkspaceId === workspaceId) {
        this.#loading = false;
        this.#hasLoadedInitialData = true; // Mark as complete so we don't retry endlessly
        this.#error = error instanceof Error ? error.message : 'Failed to initialize';
      }
    } finally {
      // Clear initialization state when done
      if (this.#initializingWorkspaceId === workspaceId) {
        this.#initializingWorkspaceId = null;
        this.#initializationPromise = null;
      }
    }
  }

  // Internal method that does the actual workspace initialization
  // Note: State is already cleared synchronously in setWorkspace() before this is called
  async #doSetWorkspace(workspaceId: string) {
    logger.info('[FileTrackingStore] #doSetWorkspace starting', { workspaceId });

    // Clean up resources from any previous workspace (event listeners, timers, etc.)
    // Note: We use #cleanupResources() instead of cleanup() to preserve the state
    // that was already set synchronously in setWorkspace()
    this.#cleanupResources();

    // Safety timeout to ensure loading state is ALWAYS cleared
    // This prevents the UI from showing a loading skeleton forever if something hangs
    let safetyTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let initCompleted = false;

    const clearSafetyTimeout = () => {
      if (safetyTimeoutId) {
        clearTimeout(safetyTimeoutId);
        safetyTimeoutId = null;
      }
    };

    safetyTimeoutId = setTimeout(() => {
      if (!initCompleted && this.#currentWorkspaceId === workspaceId && this.#loading) {
        logger.warn('[FileTrackingStore] Initialization safety timeout triggered', {
          workspaceId,
          timeoutMs: INIT_SAFETY_TIMEOUT_MS,
        });
        this.#loading = false;
        this.#hasLoadedInitialData = true;
        this.#error = 'Initialization timed out - please try refreshing';
      }
    }, INIT_SAFETY_TIMEOUT_MS);

    try {
      // Initialize file tracking on the backend
      // This ensures the git integration is set up and ready to send events
      if (typeof window !== 'undefined' && window.electronAPI) {
        try {
          const result = (await invokeWithTimeout(
            'file-tracking:init',
            { workspaceId },
            IPC_INIT_TIMEOUT_MS,
          )) as {
            success?: boolean;
            error?: string;
          };
          if (!result?.success) {
            logger.warn('File tracking backend initialization failed', {
              workspaceId,
              error: result?.error,
            });
          }
        } catch (error) {
          // Log timeout errors at warn level since they're recoverable
          if (error instanceof IpcTimeoutError) {
            logger.warn('File tracking init timed out, continuing...', {
              workspaceId,
              timeoutMs: IPC_INIT_TIMEOUT_MS,
            });
          } else {
            logger.error('Failed to initialize file tracking backend', error as Error, {
              workspaceId,
            });
          }
          // Continue - init is mostly a no-op anyway
        }
      }

      // Check if workspace changed during backend init - abort if so
      if (this.#currentWorkspaceId !== workspaceId) {
        logger.debug('Aborting workspace init - workspace changed during backend init', {
          requestedFor: workspaceId,
          currentWorkspace: this.#currentWorkspaceId,
        });
        return;
      }

      // Sync with git to get current file state instead of clearing
      // This ensures we have the current git status reflected in tracked changes
      // syncWithGit() handles errors internally and has timeout protection
      await this.syncWithGit();

      // Check if workspace changed during sync - abort if so
      if (this.#currentWorkspaceId !== workspaceId) {
        logger.debug('Aborting workspace init - workspace changed during sync', {
          requestedFor: workspaceId,
          currentWorkspace: this.#currentWorkspaceId,
        });
        return;
      }

      // loadWorkspaceData() handles errors internally and has timeout protection
      await this.loadWorkspaceData();

      // Check if workspace changed during load - don't set hasLoadedInitialData for wrong workspace
      if (this.#currentWorkspaceId !== workspaceId) {
        logger.debug('Aborting workspace init - workspace changed during load', {
          requestedFor: workspaceId,
          currentWorkspace: this.#currentWorkspaceId,
        });
        return;
      }

      this.#hasLoadedInitialData = true;
      this.#loading = false;
      initCompleted = true;

      // Set up listener for file tracking events
      // We'll use a simpler approach - just try to set it up directly
      // The invoke() function already handles the case where electronAPI isn't available
      if (typeof window !== 'undefined') {
        this.setupListener(workspaceId);
      }

      logger.info('[FileTrackingStore] Workspace initialization complete', {
        workspaceId,
        changesCount: this.#changes.length,
        hasLoadedInitialData: this.#hasLoadedInitialData,
        loading: this.#loading,
      });
    } catch (error) {
      // Catch-all for any unexpected errors during initialization
      logger.error('[FileTrackingStore] Unexpected error during workspace init', error as Error, {
        workspaceId,
      });
      // Ensure loading state is cleared even on error, but only if we're still the active workspace
      if (this.#currentWorkspaceId === workspaceId) {
        this.#hasLoadedInitialData = true; // Mark as loaded so we don't retry endlessly
        this.#loading = false;
        this.#error = error instanceof Error ? error.message : 'Failed to initialize workspace';
      }
      initCompleted = true;
    } finally {
      // Always clear the safety timeout when we're done
      clearSafetyTimeout();
      initCompleted = true;
    }
  }

  // Sync tracked changes with current git state (throttled, with timeout protection)
  private async syncWithGit(force = false): Promise<void> {
    if (!this.#currentWorkspaceId) return;

    // If there's already a sync in progress, mark dirty so we re-sync after it completes
    if (this.#syncPromise) {
      this.#syncDirty = true;
      this.#syncDirtyForce = this.#syncDirtyForce || force;
      logger.debug('Sync already in progress, marking dirty for re-sync', {
        workspaceId: this.#currentWorkspaceId,
        force,
      });
      return this.#syncPromise;
    }

    // Throttle sync calls to prevent redundant IPC overhead
    const now = Date.now();
    const timeSinceLastSync = now - this.#lastSyncTime;
    if (!force && timeSinceLastSync < this.#SYNC_THROTTLE_MS) {
      logger.debug('Skipping sync - too soon since last sync', {
        workspaceId: this.#currentWorkspaceId,
        timeSinceLastSync,
        throttleMs: this.#SYNC_THROTTLE_MS,
      });
      return;
    }

    this.#lastSyncTime = now;
    const workspaceId = this.#currentWorkspaceId;

    this.#syncPromise = (async () => {
      try {
        logger.debug('Syncing with git for workspace', { workspaceId, force });
        // Pass force flag to backend to bypass backend throttle when needed
        // Use timeout to prevent hanging forever if IPC hangs
        await invokeWithTimeout('file-tracking:sync', { workspaceId, force }, IPC_SYNC_TIMEOUT_MS);
      } catch (error) {
        // Log timeout errors at warn level since they're recoverable
        if (error instanceof IpcTimeoutError) {
          logger.warn('Git sync timed out', { workspaceId, timeoutMs: IPC_SYNC_TIMEOUT_MS });
        } else {
          logger.error('Failed to sync with git', error as Error, { workspaceId });
        }
      } finally {
        this.#syncPromise = null;

        // If a sync was requested while we were busy, schedule a re-sync
        if (this.#syncDirty) {
          const dirtyForce = this.#syncDirtyForce;
          this.#syncDirty = false;
          this.#syncDirtyForce = false;
          logger.debug('Re-syncing after dirty flag', { workspaceId, force: dirtyForce });
          setTimeout(() => this.syncWithGit(dirtyForce), 0);
        }
      }
    })();

    return this.#syncPromise;
  }

  // Separate method to set up the listener
  private setupListener(workspaceId: string) {
    // Prevent duplicate listeners - cleanup is already called in #doSetWorkspace,
    // but this guard prevents issues if setupListener is called directly
    if (this.#eventListenerCleanup) {
      logger.debug('Listeners already set up, skipping setupListener', { workspaceId });
      return;
    }

    // NOTE: We previously had a pathname guard here that checked
    // window.location.pathname.includes('/workspace/${workspaceId}').
    // This was removed because in the multi-tab sidebar, the store can be
    // initialized for a workspace that isn't in the current URL path,
    // which silently prevented all event listeners from being set up.
    // This caused the changes panel to show stale data indefinitely since
    // it would only have the initial load and never receive push updates.

    // Check if electronAPI is available
    if (!window.electronAPI || typeof window.electronAPI.on !== 'function') {
      return;
    }

    try {
      // Event data type for file tracking events
      type FileTrackingEvent = {
        workspaceId: string;
        changeCount?: number;
        source?: string;
        filePath?: string;
      };

      const changesListener = (data: FileTrackingEvent) => {
        // Only process events for our workspace
        if (data.workspaceId !== workspaceId) return;

        // Debounce rapid updates - reset timer on each event
        if (this.#updateDebounceTimer) {
          clearTimeout(this.#updateDebounceTimer);
        }

        this.#updateDebounceTimer = setTimeout(() => {
          this.loadWorkspaceData();
        }, this.#config.updateDebounce);
      };

      const readyListener = (data: FileTrackingEvent) => {
        if (data.workspaceId !== workspaceId) return;
        // Only reload if we haven't already loaded initial data
        if (!this.#hasLoadedInitialData) {
          this.loadWorkspaceData();
        }
      };

      // Agent file change listener - responds quickly to agent edits for snappy UI
      // Uses minimal debounce since we know the file was just changed by an agent
      let agentChangeDebounceTimer: NodeJS.Timeout | null = null;
      const agentFileChangeListener = (data: FileTrackingEvent) => {
        // Only process events for our workspace
        if (data.workspaceId !== workspaceId) return;

        logger.debug('Agent file change detected', {
          workspaceId,
          filePath: data.filePath,
          source: data.source,
        });

        // Use a short debounce (50ms) to batch rapid consecutive agent edits
        // while still feeling snappy
        if (agentChangeDebounceTimer) {
          clearTimeout(agentChangeDebounceTimer);
        }

        agentChangeDebounceTimer = setTimeout(async () => {
          // First trigger a git sync to ensure we have latest status
          await this.syncWithGit(true); // bypass throttle for agent changes
          // Then reload the data
          await this.loadWorkspaceData();
        }, 50);
      };

      // Workspace changes listener - responds to workspace-changes events
      // This is emitted by ChangeDetectorManager when file changes are detected
      // It's more reliable than file-tracking:changes-updated as a trigger for reloading
      let workspaceChangesDebounceTimer: NodeJS.Timeout | null = null;
      const workspaceChangesListener = (data: { workspaceId?: string; diffChunk?: any }) => {
        // Only process events for our workspace
        if (data.workspaceId !== workspaceId) return;

        logger.debug('Received workspace-changes event', {
          workspaceId,
          fileCount: data.diffChunk?.files?.length || 0,
        });

        // Debounce to avoid rapid reloads
        if (workspaceChangesDebounceTimer) {
          clearTimeout(workspaceChangesDebounceTimer);
        }

        workspaceChangesDebounceTimer = setTimeout(() => {
          this.loadWorkspaceData();
        }, this.#config.updateDebounce);
      };

      // Git status change listener - responds to .git directory changes detected by the git watcher
      // This is critical for detecting commit amends, rebases, branch switches, and other
      // operations that only modify .git internals without changing working tree files.
      // Without this, the changes panel would stay stale until the next polling cycle.
      let gitStatusDebounceTimer: NodeJS.Timeout | null = null;
      const gitStatusChangeListener = (data: { workspaceId?: string }) => {
        // Only process events for our workspace
        if (data.workspaceId !== workspaceId) return;

        logger.debug('Git status changed detected', {
          workspaceId,
          source: 'git:status-changed',
        });

        // Debounce to batch rapid git changes (e.g., rebase touching multiple refs)
        if (gitStatusDebounceTimer) {
          clearTimeout(gitStatusDebounceTimer);
        }

        gitStatusDebounceTimer = setTimeout(() => {
          this.loadWorkspaceData();
        }, this.#config.updateDebounce);
      };

      logger.info('[FileTrackingStore] Setting up listeners', { workspaceId });

      // Use ID-based listener removal to work with Electron's context isolation
      // The on() function returns a unique listener ID that can be used with offById()
      const changesListenerId = window.electronAPI.on(
        'file-tracking:changes-updated',
        changesListener,
      );
      const readyListenerId = window.electronAPI.on('file-tracking:listener-ready', readyListener);
      const agentFileListenerId = window.electronAPI.on(
        'file-tracking:agent-file-changed',
        agentFileChangeListener,
      );
      const workspaceChangesListenerId = window.electronAPI.on(
        'workspace-changes',
        workspaceChangesListener,
      );
      const gitStatusListenerId = window.electronAPI.on(
        'git:status-changed',
        gitStatusChangeListener,
      );

      // Store cleanup function for all listeners using ID-based removal
      this.#eventListenerCleanup = () => {
        if (window.electronAPI?.offById) {
          if (changesListenerId) {
            window.electronAPI.offById('file-tracking:changes-updated', changesListenerId);
          }
          if (readyListenerId) {
            window.electronAPI.offById('file-tracking:listener-ready', readyListenerId);
          }
          if (agentFileListenerId) {
            window.electronAPI.offById('file-tracking:agent-file-changed', agentFileListenerId);
          }
          if (workspaceChangesListenerId) {
            window.electronAPI.offById('workspace-changes', workspaceChangesListenerId);
          }
          if (gitStatusListenerId) {
            window.electronAPI.offById('git:status-changed', gitStatusListenerId);
          }
        }
        if (agentChangeDebounceTimer) {
          clearTimeout(agentChangeDebounceTimer);
        }
        if (workspaceChangesDebounceTimer) {
          clearTimeout(workspaceChangesDebounceTimer);
        }
        if (gitStatusDebounceTimer) {
          clearTimeout(gitStatusDebounceTimer);
        }
      };
    } catch (error) {
      logger.error('Failed to set up file tracking listener', error as Error, { workspaceId });
    }
  }

  // Load data from storage (made public so CodeChangesPanel can trigger reload)
  async loadWorkspaceData() {
    if (!this.#currentWorkspaceId) return;

    // If there are pending stage operations, skip reload to preserve optimistic updates
    // The pending operations will complete and the next load will get the correct state
    // Check both ID-based and path-based pending sets for robustness
    if (this.#pendingStageOperations.size > 0 || this.#pendingStageOperationsByPath.size > 0) {
      logger.debug('Skipping loadWorkspaceData - pending stage operations', {
        pendingCount: this.#pendingStageOperations.size,
        pendingPaths: this.#pendingStageOperationsByPath.size,
        pendingIds: Array.from(this.#pendingStageOperations),
      });
      return;
    }

    // If there's already a load in progress, mark dirty so we re-load after it completes.
    // This ensures events arriving mid-load are not permanently lost.
    if (this.#loadPromise) {
      logger.debug('Load already in progress, marking dirty for re-load after completion', {
        workspaceId: this.#currentWorkspaceId,
      });
      this.#loadDirty = true;
      return this.#loadPromise;
    }

    // Capture workspace ID at the start of the request to validate response
    const requestWorkspaceId = this.#currentWorkspaceId;

    // Wrap the loading logic in a promise to enable deduplication
    this.#loadPromise = (async () => {
      // Don't set loading immediately to avoid UI flicker
      let shouldShowLoading = false;
      const loadingTimer = setTimeout(() => {
        shouldShowLoading = true;
        untrack(() => {
          this.#loading = true;
        });
      }, 100); // Only show loading if operation takes more than 100ms

      try {
        // Load tracked changes and transitions in parallel with timeout protection
        const [changesResponse, transitionsResponse, commitsResponse] = await Promise.all([
          invokeWithTimeout(
            'file-tracking:load',
            { workspaceId: requestWorkspaceId },
            IPC_LOAD_TIMEOUT_MS,
          ) as Promise<{
            changes: TrackedChange[];
            truncated: boolean;
            totalCount: number;
          } | null>,
          invokeWithTimeout(
            'file-tracking:load-transitions',
            { workspaceId: requestWorkspaceId },
            IPC_LOAD_TIMEOUT_MS,
          ) as Promise<StageTransition[] | null>,
          // Pull recent commit history mapped by the main process
          invokeWithTimeout(
            FILE_TRACKING_CHANNELS.LOAD_COMMITS,
            { workspaceId: requestWorkspaceId, limit: 50 },
            IPC_LOAD_TIMEOUT_MS,
          ) as Promise<{ commits: CommitInfo[]; boundarySha?: string } | null>,
        ]);

        // IMPORTANT: Validate that the workspace hasn't changed while we were loading
        // If it has, discard the response to prevent showing stale data
        if (this.#currentWorkspaceId !== requestWorkspaceId) {
          logger.debug('Discarding stale load response - workspace changed', {
            requestedFor: requestWorkspaceId,
            currentWorkspace: this.#currentWorkspaceId,
          });
          return;
        }

        // Extract changes and truncation metadata from response
        const newChanges = changesResponse?.changes || [];
        const isTruncated = changesResponse?.truncated || false;
        const totalCount = changesResponse?.totalCount || newChanges.length;
        const newTransitions = transitionsResponse || [];
        const newCommits: CommitInfo[] = commitsResponse?.commits || [];
        const newBoundarySha = commitsResponse?.boundarySha ?? null;

        logger.info('[FileTrackingStore] IPC load response received', {
          workspaceId: requestWorkspaceId,
          changesCount: newChanges.length,
          changes: newChanges.map((c) => ({
            id: c.id?.slice(0, 8),
            file: c.file,
            stage: c.stage,
          })),
          transitionsCount: newTransitions.length,
          commitsCount: newCommits.length,
        });

        // Filter out changes that are pending operations or have had recent operations
        // This prevents rows from flickering when rapid stage/unstage/revert operations
        // cause background refreshes to load stale data
        const now = Date.now();
        const filteredChanges = newChanges.filter((c) => {
          // Check explicit pending operations
          if (this.#pendingStageOperations.has(c.id)) {
            logger.debug('[FileTrackingStore] Filtering out change - pending operation', {
              id: c.id,
              file: c.file,
            });
            return false;
          }
          if (this.#pendingStageOperationsByPath.has(c.relativePath)) {
            logger.debug('[FileTrackingStore] Filtering out change - pending path operation', {
              id: c.id,
              file: c.file,
            });
            return false;
          }

          // Check if this path had a recent operation (within cooldown window)
          const lastOpTime = this.#recentOperationPaths.get(c.relativePath);
          if (lastOpTime && now - lastOpTime < this.#OPERATION_COOLDOWN_MS) {
            // Path is in cooldown - keep existing state instead of using new data
            // Find the existing change for this path and stage
            const existingChange = this.#changes.find(
              (existing) => existing.relativePath === c.relativePath && existing.stage === c.stage,
            );
            // If we already have this exact path+stage combo, allow the update
            // If not, skip this incoming change to preserve optimistic state
            if (!existingChange) {
              logger.debug('[FileTrackingStore] Filtering out change - cooldown', {
                id: c.id,
                file: c.file,
                cooldownRemaining: this.#OPERATION_COOLDOWN_MS - (now - lastOpTime),
              });
              return false;
            }
          }

          return true;
        });

        // Clean up expired entries from recentOperationPaths
        for (const [path, timestamp] of this.#recentOperationPaths) {
          if (now - timestamp >= this.#OPERATION_COOLDOWN_MS) {
            this.#recentOperationPaths.delete(path);
          }
        }

        logger.info('[FileTrackingStore] After filtering', {
          workspaceId: requestWorkspaceId,
          filteredCount: filteredChanges.length,
          originalCount: newChanges.length,
          pendingOpsCount: this.#pendingStageOperations.size,
          pendingPathsCount: this.#pendingStageOperationsByPath.size,
          recentPathsCount: this.#recentOperationPaths.size,
        });

        // MERGE STRATEGY: Instead of replacing, merge new data with existing
        // This prevents UI flicker by maintaining stable references for unchanged items
        untrack(() => {
          // Only update if there are actual differences
          const hasChanges = hasChangesDifference(this.#changes, filteredChanges);
          const hasTransitionChanges = hasTransitionsDifference(this.#transitions, newTransitions);
          const hasCommitChanges = hasCommitsDifference(this.#commits, newCommits);

          logger.info('[FileTrackingStore] Applying changes', {
            workspaceId: requestWorkspaceId,
            hasChanges,
            hasTransitionChanges,
            hasCommitChanges,
            filteredChangesCount: filteredChanges.length,
            existingChangesCount: this.#changes.length,
          });

          if (hasChanges) {
            this.#changes = filteredChanges;
          }
          if (hasTransitionChanges) {
            this.#transitions = newTransitions;
          }
          if (hasCommitChanges) {
            this.#commits = newCommits;
            // Clear older commits when main commits change (e.g., after refresh)
            this.#olderCommits = [];
          }
          this.#boundarySha = newBoundarySha;
          this.#error = null;

          // Update truncation state
          this.#changesTruncated = isTruncated;
          this.#totalChangesCount = totalCount;

          // Mark that this data belongs to this workspace
          this.#dataWorkspaceId = requestWorkspaceId;

          logger.info('[FileTrackingStore] State updated', {
            workspaceId: requestWorkspaceId,
            dataWorkspaceId: this.#dataWorkspaceId,
            currentWorkspaceId: this.#currentWorkspaceId,
            changesCount: this.#changes.length,
          });
        });

        // Only log if there are actual changes
        if (this.#changes.length > 0 || this.#transitions.length > 0) {
          logger.debug('Loaded file tracking data', {
            workspaceId: requestWorkspaceId,
            changesCount: this.#changes.length,
            transitionsCount: this.#transitions.length,
            commitCount: this.#commits.length,
            truncated: isTruncated,
            totalCount,
          });
        }
      } catch (error) {
        // Only set error if workspace hasn't changed
        if (this.#currentWorkspaceId === requestWorkspaceId) {
          // Log timeout errors at warn level since they're recoverable
          if (error instanceof IpcTimeoutError) {
            logger.warn('Load file tracking data timed out', {
              workspaceId: requestWorkspaceId,
              timeoutMs: IPC_LOAD_TIMEOUT_MS,
            });
            untrack(() => {
              this.#error = 'Loading timed out - please try refreshing';
            });
          } else {
            logger.error('Failed to load file tracking data', error as Error);
            untrack(() => {
              this.#error = error instanceof Error ? error.message : 'Failed to load data';
            });
          }
        }
      } finally {
        clearTimeout(loadingTimer);
        if (shouldShowLoading || this.#loading) {
          untrack(() => {
            this.#loading = false;
          });
        }
        // Clear the promise so future calls can start a new load
        this.#loadPromise = null;

        // If new events arrived during this load, trigger a fresh re-load.
        // Use setTimeout(0) to avoid synchronous recursion and allow the
        // current call stack to unwind first.
        if (this.#loadDirty) {
          this.#loadDirty = false;
          logger.debug('Load completed with dirty flag set, scheduling re-load', {
            workspaceId: this.#currentWorkspaceId,
          });
          setTimeout(() => this.loadWorkspaceData(), 0);
        }
      }
    })();

    return this.#loadPromise;
  }

  // Track a new change
  async trackChange(change: Omit<TrackedChange, 'id'>): Promise<{ ok: boolean; id?: string }> {
    const response = (await invoke('file-tracking:track-change', {
      workspaceId: this.#currentWorkspaceId,
      change,
    })) as { ok: boolean; id?: string };

    if (response?.ok) {
      await this.loadWorkspaceData();
    }

    return response;
  }

  // Stage changes with optimistic UI update
  // This method is designed to be snappy - optimistic update happens immediately,
  // backend call is fire-and-forget with rollback on failure
  async stageChanges(changeIds: string[], changesFromUI?: TrackedChange[]) {
    // Mark these changes as pending to prevent loadWorkspaceData from overwriting
    // Track both IDs and file paths since IDs can change (synthetic ID -> UUID)
    changeIds.forEach((id) => this.#pendingStageOperations.add(id));

    // Optimistic update: move changes to staged immediately
    // Use a new array to trigger Svelte reactivity
    const originalStages = new Map<string, ChangeStage>();
    const originalChanges = [...this.#changes];
    const pendingPaths: string[] = [];

    // For synthetic IDs (from gitStore fallback), we need to create the tracked change
    // if it doesn't exist in our store yet
    const syntheticChangesToAdd: TrackedChange[] = [];

    for (const id of changeIds) {
      const existingChange = this.#changes.find((c) => c.id === id);
      if (existingChange) {
        // Change exists, track original stage for rollback
        originalStages.set(id, existingChange.stage);
        pendingPaths.push(existingChange.relativePath);
        this.#pendingStageOperationsByPath.add(existingChange.relativePath);
      } else if (id.startsWith('git-') && changesFromUI) {
        // Synthetic ID - find the change from UI data and add it to store
        const uiChange = changesFromUI.find((c) => c.id === id);
        if (uiChange) {
          syntheticChangesToAdd.push({
            ...uiChange,
            stage: ChangeStage.Staged,
          });
          originalStages.set(id, ChangeStage.Unstaged);
          pendingPaths.push(uiChange.relativePath);
          this.#pendingStageOperationsByPath.add(uiChange.relativePath);
        }
      }
    }

    // Build a set of file paths that are being staged
    const filesToStage = new Set<string>();
    for (const id of changeIds) {
      const change = this.#changes.find((c) => c.id === id);
      if (change) {
        filesToStage.add(change.relativePath);
      }
    }

    // Also add paths from UI changes for synthetic IDs
    if (changesFromUI) {
      for (const change of changesFromUI) {
        if (changeIds.includes(change.id)) {
          filesToStage.add(change.relativePath);
        }
      }
    }

    // Update existing changes with deduplication:
    // If a file already has a staged entry, don't create a duplicate
    // Instead, remove the unstaged entry (it will merge into the existing staged entry)
    const updatedChanges: TrackedChange[] = [];

    for (const c of this.#changes) {
      if (changeIds.includes(c.id) && c.stage === ChangeStage.Unstaged) {
        // This is an unstaged entry being staged
        // Check if there's already a staged entry for this file
        const hasExistingStaged = this.#changes.some(
          (other) => other.relativePath === c.relativePath && other.stage === ChangeStage.Staged,
        );
        if (hasExistingStaged) {
          // Skip this entry - the staged version already exists
          // The backend will handle deduplication and keep the appropriate stats
          continue;
        }
        // No existing staged entry, so move this one
        updatedChanges.push({ ...c, stage: ChangeStage.Staged });
      } else {
        updatedChanges.push(c);
      }
    }

    // Add synthetic changes that weren't in the store
    // But only if there's no existing staged entry for that file
    for (const syntheticChange of syntheticChangesToAdd) {
      const hasExistingStaged = updatedChanges.some(
        (c) => c.relativePath === syntheticChange.relativePath && c.stage === ChangeStage.Staged,
      );
      if (!hasExistingStaged) {
        updatedChanges.push(syntheticChange);
      }
    }

    // Apply optimistic update immediately
    this.#changes = updatedChanges;

    // Helper to clear all pending state for this operation
    // Also record paths as recently operated to prevent flickering from delayed loads
    const clearPendingState = () => {
      changeIds.forEach((id) => this.#pendingStageOperations.delete(id));
      const now = Date.now();
      pendingPaths.forEach((path) => {
        this.#pendingStageOperationsByPath.delete(path);
        this.#recentOperationPaths.set(path, now);
      });
    };

    // Await backend call to ensure git add completes before returning.
    // This is important because callers like AcceptChangesPanel.refreshPrepareData()
    // need the git state to be updated before they query it.
    try {
      const response = (await invoke('file-tracking:stage-changes', {
        workspaceId: this.#currentWorkspaceId,
        changeIds,
      })) as { ok: boolean; error?: string };

      if (!response.ok) {
        logger.error('Backend staging failed, rolling back', undefined, {
          error: response.error,
        });
        // Rollback optimistic update on failure
        clearPendingState();
        this.#changes = originalChanges;
        return { ok: false };
      }

      clearPendingState();
      return { ok: true };
    } catch (error) {
      clearPendingState();
      logger.error('Backend staging threw error, rolling back', error as Error);
      // Rollback optimistic update on error
      this.#changes = originalChanges;
      return { ok: false };
    }
  }

  // Unstage changes with optimistic UI update
  async unstageChanges(changeIds: string[], changesFromUI?: TrackedChange[]) {
    // Mark these changes as pending to prevent loadWorkspaceData from overwriting
    // Track both IDs and file paths since IDs can change (synthetic ID -> UUID)
    changeIds.forEach((id) => this.#pendingStageOperations.add(id));

    // Optimistic update: move changes to unstaged immediately
    // Use a new array to trigger Svelte reactivity
    const originalStages = new Map<string, ChangeStage>();
    const originalChanges = [...this.#changes];
    const pendingPaths: string[] = [];

    // For synthetic IDs (from gitStore fallback), we need to create the tracked change
    // if it doesn't exist in our store yet
    const syntheticChangesToAdd: TrackedChange[] = [];

    for (const id of changeIds) {
      const existingChange = this.#changes.find((c) => c.id === id);
      if (existingChange) {
        // Change exists, track original stage for rollback
        originalStages.set(id, existingChange.stage);
        pendingPaths.push(existingChange.relativePath);
        this.#pendingStageOperationsByPath.add(existingChange.relativePath);
      } else if (id.startsWith('git-') && changesFromUI) {
        // Synthetic ID - find the change from UI data and add it to store
        const uiChange = changesFromUI.find((c) => c.id === id);
        if (uiChange) {
          syntheticChangesToAdd.push({
            ...uiChange,
            stage: ChangeStage.Unstaged,
          });
          originalStages.set(id, ChangeStage.Staged);
          pendingPaths.push(uiChange.relativePath);
          this.#pendingStageOperationsByPath.add(uiChange.relativePath);
        }
      }
    }

    // Build a set of file paths that are being unstaged
    const filesToUnstage = new Set<string>();
    for (const id of changeIds) {
      const change = this.#changes.find((c) => c.id === id);
      if (change) {
        filesToUnstage.add(change.relativePath);
      }
    }

    // Also add paths from UI changes for synthetic IDs
    if (changesFromUI) {
      for (const change of changesFromUI) {
        if (changeIds.includes(change.id)) {
          filesToUnstage.add(change.relativePath);
        }
      }
    }

    // Update existing changes with deduplication:
    // If a file already has an unstaged entry, don't create a duplicate
    // Instead, remove the staged entry (it will merge into the existing unstaged entry)
    const updatedChanges: TrackedChange[] = [];

    for (const c of this.#changes) {
      if (changeIds.includes(c.id) && c.stage === ChangeStage.Staged) {
        // This is a staged entry being unstaged
        // Check if there's already an unstaged entry for this file
        const hasExistingUnstaged = this.#changes.some(
          (other) => other.relativePath === c.relativePath && other.stage === ChangeStage.Unstaged,
        );
        if (hasExistingUnstaged) {
          // Skip this entry - the unstaged version already exists
          // The backend will handle deduplication and keep the appropriate stats
          continue;
        }
        // No existing unstaged entry, so move this one
        updatedChanges.push({ ...c, stage: ChangeStage.Unstaged });
      } else {
        updatedChanges.push(c);
      }
    }

    // Add synthetic changes that weren't in the store
    // But only if there's no existing unstaged entry for that file
    for (const syntheticChange of syntheticChangesToAdd) {
      const hasExistingUnstaged = updatedChanges.some(
        (c) => c.relativePath === syntheticChange.relativePath && c.stage === ChangeStage.Unstaged,
      );
      if (!hasExistingUnstaged) {
        updatedChanges.push(syntheticChange);
      }
    }

    // Apply optimistic update immediately
    this.#changes = updatedChanges;

    // Helper to clear all pending state for this operation
    // Also record paths as recently operated to prevent flickering from delayed loads
    const clearPendingState = () => {
      changeIds.forEach((id) => this.#pendingStageOperations.delete(id));
      const now = Date.now();
      pendingPaths.forEach((path) => {
        this.#pendingStageOperationsByPath.delete(path);
        this.#recentOperationPaths.set(path, now);
      });
    };

    // Await backend call to ensure git reset completes before returning.
    // This is important because callers like AcceptChangesPanel.refreshPrepareData()
    // need the git state to be updated before they query it.
    try {
      const response = (await invoke('file-tracking:unstage-changes', {
        workspaceId: this.#currentWorkspaceId,
        changeIds,
      })) as { ok: boolean; error?: string };

      if (!response.ok) {
        logger.error('Backend unstaging failed, rolling back', undefined, {
          error: response.error,
        });
        // Rollback optimistic update on failure
        clearPendingState();
        this.#changes = originalChanges;
        return { ok: false };
      }

      clearPendingState();
      return { ok: true };
    } catch (error) {
      clearPendingState();
      logger.error('Backend unstaging threw error, rolling back', error as Error);
      // Rollback optimistic update on error
      this.#changes = originalChanges;
      return { ok: false };
    }
  }

  // Get changes for a specific agent turn
  async getAgentChanges(agentId: string, sessionId: string, turnNumber?: number) {
    const filter: ChangeFilter = {
      agentId,
      sessionId,
    };

    if (turnNumber !== undefined) {
      filter.turnNumber = turnNumber;
    }

    const response = (await invoke('file-tracking:get-changes', {
      workspaceId: this.#currentWorkspaceId,
      filter,
    })) as { changes?: TrackedChange[] };

    return response.changes || [];
  }

  /**
   * Stage files by path - convenience method for components that work with file paths.
   * Looks up existing tracked changes by path, or creates synthetic IDs for untracked files.
   */
  async stageByPath(filePaths: string[]): Promise<{ ok: boolean }> {
    const validPaths = filePaths.filter(Boolean);
    if (validPaths.length === 0) return { ok: true };

    const changeIds: string[] = [];
    const changesFromUI: TrackedChange[] = [];

    for (const filePath of validPaths) {
      // When staging, we specifically want to find the UNSTAGED entry for this file
      // (a file can have both staged and unstaged portions)
      const existingChange = this.#changes.find(
        (c) => c.relativePath === filePath && c.stage === ChangeStage.Unstaged,
      );

      if (existingChange) {
        changeIds.push(existingChange.id);
        changesFromUI.push(existingChange);
      } else {
        // Create a synthetic change for files not yet tracked
        const syntheticId = `git-path-${filePath}`;
        changeIds.push(syntheticId);
        changesFromUI.push({
          id: syntheticId,
          file: filePath,
          relativePath: filePath,
          stage: ChangeStage.Unstaged,
          stats: { additions: 0, deletions: 0 },
          attribution: { manual: true, timestamp: Date.now() },
        } as TrackedChange);
      }
    }

    return this.stageChanges(changeIds, changesFromUI);
  }

  /**
   * Unstage files by path - convenience method for components that work with file paths.
   * Looks up existing tracked changes by path, or creates synthetic IDs for untracked files.
   */
  async unstageByPath(filePaths: string[]): Promise<{ ok: boolean }> {
    const validPaths = filePaths.filter(Boolean);
    if (validPaths.length === 0) return { ok: true };

    const changeIds: string[] = [];
    const changesFromUI: TrackedChange[] = [];

    for (const filePath of validPaths) {
      // When unstaging, we specifically want to find the STAGED entry for this file
      // (a file can have both staged and unstaged portions)
      const existingChange = this.#changes.find(
        (c) => c.relativePath === filePath && c.stage === ChangeStage.Staged,
      );

      if (existingChange) {
        changeIds.push(existingChange.id);
        changesFromUI.push(existingChange);
      } else {
        // Create a synthetic change for files not yet tracked
        const syntheticId = `git-path-${filePath}`;
        changeIds.push(syntheticId);
        changesFromUI.push({
          id: syntheticId,
          file: filePath,
          relativePath: filePath,
          stage: ChangeStage.Staged,
          stats: { additions: 0, deletions: 0 },
          attribution: { manual: true, timestamp: Date.now() },
        } as TrackedChange);
      }
    }

    return this.unstageChanges(changeIds, changesFromUI);
  }

  // UI Methods
  setFileListViewMode(mode: FileListViewMode) {
    this.#fileListViewMode = mode;
  }

  setMainPanelView(view: MainPanelViewState | null) {
    this.#mainPanelView = view;
  }

  clearMainPanelView() {
    this.#mainPanelView = null;
  }

  // Clear tracked changes from storage
  async clearTrackedChanges() {
    if (!this.#currentWorkspaceId) return;

    try {
      logger.info('Clearing tracked changes for workspace', {
        workspaceId: this.#currentWorkspaceId,
      });

      // Clear the changes in storage
      await invoke('file-tracking:clear', { workspaceId: this.#currentWorkspaceId });

      // Clear local state
      untrack(() => {
        this.#changes = [];
        this.#transitions = [];
      });
    } catch (error) {
      logger.error('Failed to clear tracked changes', error as Error);
    }
  }

  // Refresh data (force sync to bypass throttle for explicit user action)
  async refresh() {
    // If there's already a refresh in progress, wait for it instead of starting a new one
    // This prevents the infinite loop where multiple callers trigger concurrent refreshes
    if (this.#refreshPromise) {
      logger.debug('Refresh already in progress, waiting...', {
        workspaceId: this.#currentWorkspaceId,
      });
      return this.#refreshPromise;
    }

    // Capture workspace ID to validate between async operations
    const refreshWorkspaceId = this.#currentWorkspaceId;

    this.#refreshPromise = (async () => {
      try {
        // Force sync with git to get latest changes (bypasses throttle for explicit refresh)
        await this.syncWithGit(true);

        // Check if workspace changed during sync - if so, abort refresh
        if (this.#currentWorkspaceId !== refreshWorkspaceId) {
          logger.debug('Aborting refresh - workspace changed during sync', {
            requestedFor: refreshWorkspaceId,
            currentWorkspace: this.#currentWorkspaceId,
          });
          return;
        }

        // Then load the updated data
        await this.loadWorkspaceData();
      } finally {
        this.#refreshPromise = null;
      }
    })();

    return this.#refreshPromise;
  }

  /**
   * Load older commits before the boundary SHA.
   * These are commits that exist before the workspace's base commit boundary.
   */
  async loadOlderCommits(beforeSha: string, limit = 10) {
    if (!this.#currentWorkspaceId || this.#loadingOlderCommits) return;

    this.#loadingOlderCommits = true;
    try {
      const result = (await invokeWithTimeout(
        FILE_TRACKING_CHANNELS.LOAD_OLDER_COMMITS,
        { workspaceId: this.#currentWorkspaceId, beforeSha, limit },
        IPC_LOAD_TIMEOUT_MS,
      )) as CommitInfo[] | null;

      if (result && result.length > 0) {
        // Append to existing older commits (for "load more" behavior)
        // Deduplicate by hash to prevent duplicates from race conditions
        const existingHashes = new Set(this.#olderCommits.map((c) => c.hash));
        const newCommits = result.filter((c) => !existingHashes.has(c.hash));
        if (newCommits.length > 0) {
          this.#olderCommits = [...this.#olderCommits, ...newCommits];
        }
      }
    } catch (error) {
      logger.error('Failed to load older commits', error as Error);
    } finally {
      this.#loadingOlderCommits = false;
    }
  }

  /**
   * Clear loaded older commits (collapse the older commits section).
   */
  clearOlderCommits() {
    this.#olderCommits = [];
  }

  /**
   * Revert a file change with optimistic UI update.
   * Removes the change from UI immediately, then calls git:discard in background.
   * On failure, the change will reappear on next refresh.
   */
  async revertChange(change: TrackedChange): Promise<{ ok: boolean }> {
    const filePath = change.relativePath || change.file;
    if (!filePath || !this.#currentWorkspaceId) {
      return { ok: false };
    }

    // Track pending operation to prevent reload from re-adding the change
    const changeId = change.id;
    this.#pendingStageOperations.add(changeId);
    this.#pendingStageOperationsByPath.add(filePath);

    // Optimistic update: remove the change from UI immediately
    const originalChanges = [...this.#changes];
    this.#changes = this.#changes.filter((c) => c.id !== changeId);

    // Helper to clear pending state
    // Also record path as recently operated to prevent flickering from delayed loads
    const clearPendingState = () => {
      this.#pendingStageOperations.delete(changeId);
      this.#pendingStageOperationsByPath.delete(filePath);
      this.#recentOperationPaths.set(filePath, Date.now());
    };

    // Fire-and-forget the backend call, but handle errors
    try {
      await invoke('git:discard', {
        workspaceId: this.#currentWorkspaceId,
        paths: [filePath],
      });

      clearPendingState();

      // Refresh in background to sync with actual git state
      // Don't await - let it happen asynchronously
      this.refresh().catch((err) => {
        logger.error('Background refresh after revert failed', err as Error);
      });

      return { ok: true };
    } catch (error) {
      logger.error('Failed to revert change', error as Error, { filePath });

      // Rollback: restore the change to UI
      clearPendingState();
      this.#changes = originalChanges;

      return { ok: false };
    }
  }

  /**
   * Revert multiple file changes with optimistic UI update.
   */
  async revertChanges(changes: TrackedChange[]): Promise<{ ok: boolean }> {
    if (changes.length === 0 || !this.#currentWorkspaceId) {
      return { ok: true };
    }

    const filePaths = changes.map((c) => c.relativePath || c.file).filter((p): p is string => !!p);

    if (filePaths.length === 0) {
      return { ok: false };
    }

    // Track pending operations
    const changeIds = changes.map((c) => c.id);
    changeIds.forEach((id) => this.#pendingStageOperations.add(id));
    filePaths.forEach((path) => this.#pendingStageOperationsByPath.add(path));

    // Optimistic update: remove all changes from UI immediately
    const originalChanges = [...this.#changes];
    const idsToRemove = new Set(changeIds);
    this.#changes = this.#changes.filter((c) => !idsToRemove.has(c.id));

    // Helper to clear pending state
    // Also record paths as recently operated to prevent flickering from delayed loads
    const clearPendingState = () => {
      changeIds.forEach((id) => this.#pendingStageOperations.delete(id));
      const now = Date.now();
      filePaths.forEach((path) => {
        this.#pendingStageOperationsByPath.delete(path);
        this.#recentOperationPaths.set(path, now);
      });
    };

    try {
      await invoke('git:discard', {
        workspaceId: this.#currentWorkspaceId,
        paths: filePaths,
      });

      clearPendingState();

      // Refresh in background
      this.refresh().catch((err) => {
        logger.error('Background refresh after batch revert failed', err as Error);
      });

      return { ok: true };
    } catch (error) {
      logger.error('Failed to revert changes', error as Error, { filePaths });

      // Rollback
      clearPendingState();
      this.#changes = originalChanges;

      return { ok: false };
    }
  }

  /**
   * Revert files by path - convenience method for components that work with file paths.
   * Looks up existing tracked changes by path, or creates synthetic changes for untracked files.
   */
  async revertByPath(filePaths: string[]): Promise<{ ok: boolean }> {
    const validPaths = filePaths.filter(Boolean);
    if (validPaths.length === 0 || !this.#currentWorkspaceId) {
      return { ok: true };
    }

    // Find existing changes or create synthetic ones
    const changes: TrackedChange[] = [];
    for (const filePath of validPaths) {
      const existingChange = this.#changes.find((c) => c.relativePath === filePath);
      if (existingChange) {
        changes.push(existingChange);
      } else {
        // Create a synthetic change for files not in the store
        changes.push({
          id: `git-path-${filePath}`,
          file: filePath,
          relativePath: filePath,
          stage: ChangeStage.Unstaged,
          stats: { additions: 0, deletions: 0 },
          attribution: { manual: true, timestamp: Date.now() },
        } as TrackedChange);
      }
    }

    return this.revertChanges(changes);
  }

  // Clean up resources (event listeners, timers) without resetting state
  // Use this when switching workspaces (state is managed separately)
  #cleanupResources() {
    logger.debug('[FileTrackingStore] #cleanupResources called', {
      hasEventListenerCleanup: !!this.#eventListenerCleanup,
      currentWorkspaceId: this.#currentWorkspaceId,
    });

    // Clean up event listener
    if (this.#eventListenerCleanup) {
      this.#eventListenerCleanup();
      this.#eventListenerCleanup = null;
    }

    // Clear timers
    if (this.#updateDebounceTimer) {
      clearTimeout(this.#updateDebounceTimer);
      this.#updateDebounceTimer = null;
    }

    // Clear pending operations and recent operation tracking
    this.#pendingStageOperations.clear();
    this.#pendingStageOperationsByPath.clear();
    this.#recentOperationPaths.clear();

    // Reset sync state
    this.#lastSyncTime = 0;
    this.#syncPromise = null;
    this.#syncDirty = false;
    this.#syncDirtyForce = false;

    // Clear pending load/refresh promises so new workspace can start fresh
    // The promises will resolve but their results will be discarded due to workspace mismatch
    this.#loadPromise = null;
    this.#loadDirty = false;
    this.#refreshPromise = null;
  }

  // Clean up all resources (for full teardown, e.g., component unmount)
  cleanup() {
    // First clean up resources
    this.#cleanupResources();

    // Then reset all state
    untrack(() => {
      this.#changes = [];
      this.#transitions = [];
      this.#commits = [];
      this.#boundarySha = null;
      this.#olderCommits = [];
      this.#loadingOlderCommits = false;
      this.#currentWorkspaceId = null;
      this.#loading = false;
      this.#error = null;
      this.#mainPanelView = null;
    });

    // Reset initialization tracking
    this.#initializingWorkspaceId = null;
    this.#initializationPromise = null;
    this.#hasLoadedInitialData = false;
    this.#dataWorkspaceId = null;
  }
}

// Export singleton instance
export const fileTrackingStore = new FileTrackingStore();
