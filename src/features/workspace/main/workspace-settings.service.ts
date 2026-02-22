/**
 * Workspace Settings Service (Main Process)
 *
 * Stores workspace-level settings like auto-commit preferences.
 *
 * Settings are synced from the renderer via IPC, but the source of truth
 * is electron-store (persisted on disk). When no explicit sync has happened
 * yet for a workspace, we read directly from electron-store to avoid a race
 * condition where the main process defaults to autoCommitEnabled=true before
 * the renderer has had a chance to push the user's actual preference.
 */

import ElectronStore from 'electron-store';
import { Logger } from '../../../shared/logger';

const logger = new Logger({ category: 'WorkspaceSettingsService' });

export interface WorkspaceSettings {
  /** Whether agents should auto-commit their changes when tasks complete */
  autoCommitEnabled: boolean;
}

const defaultSettings: WorkspaceSettings = {
  autoCommitEnabled: true, // Default to enabled
};

// In-memory store for workspace settings (populated by renderer sync)
const workspaceSettingsStore = new Map<string, WorkspaceSettings>();

// Lazy-initialized electron-store for reading persisted settings
let _electronSettingsStore: ElectronStore | null = null;

/**
 * Get the electron-store instance for reading persisted settings.
 * Lazy-initialized so it's only created when needed (avoids import
 * issues in test environments).
 */
function getElectronSettingsStore(): ElectronStore | null {
  if (_electronSettingsStore) return _electronSettingsStore;
  try {
    _electronSettingsStore = new ElectronStore({ name: 'settings' });
    return _electronSettingsStore;
  } catch (error) {
    logger.warn('Failed to initialize electron-store for settings fallback', {
      error: (error as Error).message,
    });
    return null;
  }
}

/**
 * Read the autoCommit setting directly from electron-store.
 * This is the source of truth — the user's persisted preference.
 * Returns the default (true) only if electron-store can't be read.
 */
function readAutoCommitFromStore(): boolean {
  const store = getElectronSettingsStore();
  if (!store) return defaultSettings.autoCommitEnabled;
  try {
    const value = store.get('autoCommit');
    // If the key has never been set, treat as default (true).
    // If it was explicitly set to false, respect that.
    return value !== false;
  } catch (error) {
    logger.warn('Failed to read autoCommit from electron-store', {
      error: (error as Error).message,
    });
    return defaultSettings.autoCommitEnabled;
  }
}

/**
 * Get settings for a workspace.
 *
 * If the renderer has synced settings for this workspace, returns those.
 * Otherwise, reads the autoCommit preference directly from electron-store
 * to avoid the race condition where agents act before the renderer syncs.
 */
export function getWorkspaceSettings(workspaceId: string): WorkspaceSettings {
  const synced = workspaceSettingsStore.get(workspaceId);
  if (synced) return synced;

  // No renderer sync yet — read from electron-store (source of truth)
  return { autoCommitEnabled: readAutoCommitFromStore() };
}

/**
 * Update settings for a workspace
 */
export function updateWorkspaceSettings(
  workspaceId: string,
  settings: Partial<WorkspaceSettings>,
): WorkspaceSettings {
  const current = getWorkspaceSettings(workspaceId);
  const updated = { ...current, ...settings };
  workspaceSettingsStore.set(workspaceId, updated);
  logger.info('Updated workspace settings', { workspaceId, settings: updated });
  return updated;
}

/**
 * Check if auto-commit is enabled for a workspace
 */
export function isAutoCommitEnabled(workspaceId: string): boolean {
  return getWorkspaceSettings(workspaceId).autoCommitEnabled;
}

/**
 * Centralized guard for agent-initiated commits.
 *
 * Call this from ANY tool or code path where an agent attempts to commit.
 * Returns { allowed: true } if the commit should proceed, or
 * { allowed: false, reason: string } if it should be blocked.
 *
 * This exists to prevent the class of bug where a new commit tool/path
 * is added without checking the auto-commit setting. All agent commit
 * paths should use this single function rather than inlining the check.
 *
 * @param workspaceId - The workspace to check
 * @param opts.userRequested - If the user explicitly asked for the commit (bypasses auto-commit check)
 */
export function assertAgentCommitAllowed(
  workspaceId: string,
  opts?: { userRequested?: boolean },
): { allowed: true } | { allowed: false; reason: string } {
  if (opts?.userRequested) {
    return { allowed: true };
  }
  if (!isAutoCommitEnabled(workspaceId)) {
    logger.info('Agent commit blocked: auto-commit disabled', { workspaceId });
    return {
      allowed: false,
      reason:
        'Auto-commit is disabled for this workspace. ' +
        'Use agent_commit_changes with userRequested: true if the user asked you to commit.',
    };
  }
  return { allowed: true };
}

/**
 * Clear settings for a workspace (e.g., when workspace is closed)
 */
export function clearWorkspaceSettings(workspaceId: string): void {
  workspaceSettingsStore.delete(workspaceId);
  logger.info('Cleared workspace settings', { workspaceId });
}

/**
 * Reset the electron-store instance (for testing only).
 * @internal
 */
export function _resetElectronSettingsStore(): void {
  _electronSettingsStore = null;
}
