/**
 * Workspace Settings Store
 *
 * Uses global autoCommit setting from electron-store.
 * No per-workspace overrides - the global setting applies everywhere.
 */

import { invoke } from '$lib/electron-bridge';
import { WORKSPACE_CHANNELS, SETTINGS_CHANNELS } from '$shared/ipc/channels';

interface WorkspaceSettings {
  /** Whether agents should auto-commit their changes when tasks complete */
  autoCommitEnabled: boolean;
}

const defaultSettings: WorkspaceSettings = {
  autoCommitEnabled: true, // Default to enabled
};

// Global reactive state for autoCommit
let globalAutoCommit = $state(defaultSettings.autoCommitEnabled);
let globalSettingsLoaded = false;

// Track which workspaces have had their settings synced to the main process.
// This prevents repeated IPC calls on every component mount — the sync only
// needs to happen once per workspace per app session.
const syncedWorkspaces = new Set<string>();

/**
 * Load global autoCommit setting from electron-store
 */
async function loadGlobalAutoCommit(): Promise<void> {
  if (globalSettingsLoaded) return;
  try {
    if (typeof window !== 'undefined' && window.electronAPI) {
      const result = await window.electronAPI.invoke(SETTINGS_CHANNELS.GET_ALL, undefined);
      const settings = (result && result.data) || {};
      globalAutoCommit = settings.autoCommit !== false;
      globalSettingsLoaded = true;
    }
  } catch {
    // Ignore errors, fall back to default
  }
}

/**
 * Refresh the global autoCommit setting from electron-store.
 * Call this when the global setting changes.
 * Also clears the synced-workspaces set so all workspaces re-sync on next access.
 */
export function refreshGlobalAutoCommit(): void {
  globalSettingsLoaded = false;
  syncedWorkspaces.clear();
  loadGlobalAutoCommit();
}

/**
 * Sync autoCommit setting to main process for a workspace
 * Also persists to electron-store so it survives app restarts
 */
function syncToMainProcess(workspaceId: string, autoCommitEnabled: boolean): void {
  // Update workspace-level settings
  invoke(WORKSPACE_CHANNELS.UPDATE_SETTINGS, {
    id: workspaceId,
    settings: { autoCommitEnabled },
  }).catch((error) => {
    console.warn('[WorkspaceSettings] Failed to sync autoCommit to main process', {
      workspaceId,
      autoCommitEnabled,
      error,
    });
  });

  // Persist to electron-store so the setting survives app restarts
  if (typeof window !== 'undefined' && window.electronAPI) {
    window.electronAPI.invoke(SETTINGS_CHANNELS.SET, {
      key: 'autoCommit',
      value: autoCommitEnabled,
    }).catch((error) => {
      console.warn('[WorkspaceSettings] Failed to persist autoCommit to electron-store', {
        autoCommitEnabled,
        error,
      });
    });
  }
}

/**
 * Get workspace settings store for a specific workspace
 */
export function getWorkspaceSettings(workspaceId: string) {
  return {
    get autoCommitEnabled(): boolean {
      return globalAutoCommit;
    },

    set autoCommitEnabled(value: boolean) {
      globalAutoCommit = value;
      syncToMainProcess(workspaceId, value);
    },

    toggleAutoCommit() {
      this.autoCommitEnabled = !this.autoCommitEnabled;
    },
  };
}

/**
 * Reactive workspace settings store
 * Creates a $state-based store for use in Svelte 5 components
 */
export function createWorkspaceSettingsStore(workspaceId: string) {
  // Sync settings to main process once per workspace per session.
  // This ensures the main process knows about a saved autoCommit=false
  // without re-sending on every component mount.
  if (!syncedWorkspaces.has(workspaceId)) {
    syncedWorkspaces.add(workspaceId);
    loadGlobalAutoCommit().then(() => {
      syncToMainProcess(workspaceId, globalAutoCommit);
    });
  }

  return {
    get autoCommitEnabled() {
      return globalAutoCommit;
    },

    set autoCommitEnabled(value: boolean) {
      globalAutoCommit = value;
      syncToMainProcess(workspaceId, value);
    },

    toggleAutoCommit() {
      this.autoCommitEnabled = !this.autoCommitEnabled;
    },
  };
}
