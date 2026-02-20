/**
 * Auto-Update Svelte Store
 *
 * Reactive store for managing auto-update state in the UI.
 * Uses Svelte 5 runes for reactivity.
 */

import { autoUpdateClient } from './auto-update.client';
import type { UpdateChannel, UpdateState } from './types';

// Delay before attempting to initialize (allows IPC handlers to be registered)
const INIT_DELAY_MS = 2000;
// Number of retries if IPC handler not ready
const MAX_RETRIES = 3;
// Delay between retries
const RETRY_DELAY_MS = 1000;
// Timeout for update check (if no response, assume network issue)
const CHECK_TIMEOUT_MS = 15000;

function createAutoUpdateStore() {
  let state = $state<UpdateState>({
    status: 'idle',
    currentVersion: '',
    updateInfo: null,
    progress: null,
    error: null,
    channel: 'stable',
  });

  // Toast visibility state
  let toastVisible = $state(false);

  let initialized = false;
  let unsubscribeStatus: (() => void) | null = null;
  let unsubscribeProgress: (() => void) | null = null;
  let unsubscribeShowToast: (() => void) | null = null;
  let unsubscribeUpToDate: (() => void) | null = null;
  let initTimeout: ReturnType<typeof setTimeout> | null = null;
  // Safety timeout for menu-triggered checks (no renderer-side timeout in that path)
  let showToastTimeoutId: ReturnType<typeof setTimeout> | null = null;

  async function tryGetInitialState(retries = 0): Promise<void> {
    try {
      state = await autoUpdateClient.getState();
    } catch (e) {
      const errorMessage = (e as Error).message || '';
      // Retry if handler not registered yet
      if (errorMessage.includes('No handler registered') && retries < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        return tryGetInitialState(retries + 1);
      }
      // Only log if we've exhausted retries or it's a different error
      console.error('[AutoUpdate] Failed to get initial update state:', e);
    }
  }

  return {
    // State getters
    get state() {
      return state;
    },
    get status() {
      return state.status;
    },
    get currentVersion() {
      return state.currentVersion;
    },
    get updateInfo() {
      return state.updateInfo;
    },
    get progress() {
      return state.progress;
    },
    get error() {
      return state.error;
    },
    get channel() {
      return state.channel;
    },

    // Computed state
    get isUpdateAvailable() {
      return state.status === 'available';
    },
    get isDownloading() {
      return state.status === 'downloading';
    },
    get isReadyToInstall() {
      return state.status === 'downloaded';
    },
    get isChecking() {
      return state.status === 'checking';
    },
    get hasError() {
      return state.status === 'error';
    },

    // Toast visibility
    get toastVisible() {
      return toastVisible;
    },

    /**
     * Show the update toast
     */
    showToast() {
      toastVisible = true;
    },

    /**
     * Hide the update toast
     */
    hideToast() {
      toastVisible = false;
    },

    /**
     * Initialize the store and subscribe to updates
     * Delays initialization to ensure IPC handlers are registered
     */
    async initialize() {
      if (initialized) return;
      initialized = true;

      // Delay initialization to allow IPC handlers to be registered
      initTimeout = setTimeout(async () => {
        // Get initial state with retry logic
        await tryGetInitialState();

        // Subscribe to status changes
        unsubscribeStatus = autoUpdateClient.onStatusChanged((newState) => {
          state = newState;
          // Clear the show-toast safety timeout only when we reach a terminal state.
          // If the status is still 'checking', keep the renderer-side timeout as a
          // last-resort safety net (e.g., if the main process window ref goes stale
          // and subsequent events never arrive).
          if (showToastTimeoutId && newState.status !== 'checking') {
            clearTimeout(showToastTimeoutId);
            showToastTimeoutId = null;
          }
        });

        // Subscribe to progress updates
        unsubscribeProgress = autoUpdateClient.onProgress((progress) => {
          state = { ...state, progress };
        });

        // Subscribe to show toast events (from menu click)
        unsubscribeShowToast = autoUpdateClient.onShowToast(() => {
          toastVisible = true;
          // Also set checking state for immediate feedback
          state = { ...state, status: 'checking' };

          // Safety timeout: if the menu-triggered check doesn't resolve,
          // show an error instead of spinning forever.
          // This handles cases where the main process check hangs or
          // events are lost (e.g., stale window reference).
          if (showToastTimeoutId) clearTimeout(showToastTimeoutId);
          showToastTimeoutId = setTimeout(() => {
            if (state.status === 'checking') {
              console.warn('[AutoUpdate] Menu-triggered check timed out');
              state = {
                ...state,
                status: 'error',
                error: 'Update check timed out. Please check your network connection.',
              };
            }
            showToastTimeoutId = null;
          }, CHECK_TIMEOUT_MS);
        });

        // Subscribe to "up to date" events (handles dev mode and manual checks)
        unsubscribeUpToDate = autoUpdateClient.onUpToDate((data) => {
          state = {
            ...state,
            status: 'not-available',
            currentVersion: data.version || state.currentVersion,
          };
          // Clear any pending toast timeout
          if (showToastTimeoutId) {
            clearTimeout(showToastTimeoutId);
            showToastTimeoutId = null;
          }
        });
      }, INIT_DELAY_MS);
    },

    /**
     * Cleanup subscriptions
     */
    cleanup() {
      if (initTimeout) {
        clearTimeout(initTimeout);
        initTimeout = null;
      }
      if (showToastTimeoutId) {
        clearTimeout(showToastTimeoutId);
        showToastTimeoutId = null;
      }
      if (unsubscribeStatus) {
        unsubscribeStatus();
        unsubscribeStatus = null;
      }
      if (unsubscribeProgress) {
        unsubscribeProgress();
        unsubscribeProgress = null;
      }
      if (unsubscribeShowToast) {
        unsubscribeShowToast();
        unsubscribeShowToast = null;
      }
      if (unsubscribeUpToDate) {
        unsubscribeUpToDate();
        unsubscribeUpToDate = null;
      }
      initialized = false;
    },

    /**
     * Check for available updates
     */
    async checkForUpdates() {
      try {
        state = await autoUpdateClient.checkForUpdates();
      } catch (e) {
        console.error('Failed to check for updates:', e);
        state = { ...state, status: 'error', error: (e as Error).message };
      }
    },

    /**
     * Manually check for updates (shows toast immediately with checking state)
     * This is triggered by user clicking "Check for Updates"
     */
    async checkForUpdatesManual() {
      // Show toast immediately to give feedback
      toastVisible = true;
      // Set checking state immediately for instant UI feedback
      state = { ...state, status: 'checking' };

      // Set up a timeout to handle cases where electron-updater hangs
      // (e.g., network issues that don't fire error events)
      const checkingTimeoutId = setTimeout(() => {
        if (state.status === 'checking') {
          console.warn('[AutoUpdate] Check timed out, assuming network issue');
          state = {
            ...state,
            status: 'error',
            error: 'Update check timed out. Please check your network connection.',
          };
        }
      }, CHECK_TIMEOUT_MS);

      try {
        const result = await autoUpdateClient.checkForUpdatesManual();
        clearTimeout(checkingTimeoutId);
        // Only update state if we're still in checking state
        // (timeout might have already changed it)
        if (state.status === 'checking') {
          state = result;
        }
      } catch (e) {
        clearTimeout(checkingTimeoutId);
        console.error('Failed to check for updates:', e);
        state = { ...state, status: 'error', error: (e as Error).message };
      }
    },

    /**
     * Download the available update
     */
    async downloadUpdate() {
      try {
        await autoUpdateClient.downloadUpdate();
      } catch (e) {
        console.error('Failed to download update:', e);
        state = { ...state, status: 'error', error: (e as Error).message };
      }
    },

    /**
     * Install the downloaded update (will restart the app)
     */
    async installUpdate() {
      try {
        await autoUpdateClient.installUpdate();
      } catch (e) {
        console.error('Failed to install update:', e);
      }
    },

    /**
     * Set the update channel
     */
    async setChannel(channel: UpdateChannel) {
      try {
        await autoUpdateClient.setChannel(channel);
        state = { ...state, channel };
      } catch (e) {
        console.error('Failed to set update channel:', e);
      }
    },

    // ============================================
    // DEV-ONLY: Simulation methods for testing UI
    // ============================================

    /**
     * [DEV ONLY] Simulate the full update flow for testing
     * Shows: checking -> downloading (with progress) -> downloaded
     */
    async simulateUpdateFlow() {
      if (!import.meta.env.DEV) return;

      // Show toast and start checking
      toastVisible = true;
      state = {
        ...state,
        status: 'checking',
        updateInfo: null,
        progress: null,
        error: null,
      };

      // Simulate checking delay
      await new Promise((r) => setTimeout(r, 1500));

      // Update available, start downloading
      state = {
        ...state,
        status: 'downloading',
        updateInfo: {
          version: '99.0.0',
          releaseDate: new Date().toISOString(),
          releaseNotes: 'Simulated update for testing',
        },
        progress: { percent: 0, bytesPerSecond: 0, transferred: 0, total: 50000000 },
      };

      // Simulate download progress
      for (let i = 0; i <= 100; i += 5) {
        await new Promise((r) => setTimeout(r, 100));
        state = {
          ...state,
          progress: {
            percent: i,
            bytesPerSecond: 2500000 + Math.random() * 500000,
            transferred: (i / 100) * 50000000,
            total: 50000000,
          },
        };
      }

      // Download complete
      state = {
        ...state,
        status: 'downloaded',
        progress: null,
      };
    },

    /**
     * [DEV ONLY] Simulate "no update available" state
     */
    simulateNoUpdate() {
      if (!import.meta.env.DEV) return;

      toastVisible = true;
      state = { ...state, status: 'checking' };

      setTimeout(() => {
        state = {
          ...state,
          status: 'not-available',
          currentVersion: '1.0.0-dev',
        };
      }, 1500);
    },

    /**
     * [DEV ONLY] Reset to idle state
     */
    simulateReset() {
      if (!import.meta.env.DEV) return;

      toastVisible = false;
      state = {
        status: 'idle',
        currentVersion: '1.0.0-dev',
        updateInfo: null,
        progress: null,
        error: null,
        channel: 'stable',
      };
    },

    /**
     * [DEV ONLY] Simulate an error/timeout state
     */
    simulateError(message?: string) {
      if (!import.meta.env.DEV) return;

      toastVisible = true;
      state = { ...state, status: 'checking' };

      setTimeout(() => {
        state = {
          ...state,
          status: 'error',
          error: message || 'Update check timed out. Please check your network connection.',
        };
      }, 1500);
    },
  };
}

export const autoUpdateStore = createAutoUpdateStore();
