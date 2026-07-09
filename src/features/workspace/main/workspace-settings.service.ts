/**
 * Workspace Settings Service (Main Process)
 *
 * Stores workspace-level settings like auto-commit preferences.
 *
 * The source of truth is the daemon-owned `git.autoCommit` setting
 * (PROTOCOL.md §5.12). At process start we hydrate an in-memory cache from
 * the daemon via `settings.get` so the sync `getWorkspaceSettings` API can
 * serve the correct default even before the renderer has pushed the user's
 * preference. Renderer-driven per-workspace overrides are stored in a
 * simple in-memory map keyed by workspace id (unchanged from the
 * pre-P3-4 shape). The legacy `settings` electron-store is retired.
 */

import { Logger } from '../../../shared/logger';

const logger = new Logger({ category: 'WorkspaceSettingsService' });

export interface WorkspaceSettings {
  /** Whether agents should auto-commit their changes when tasks complete */
  autoCommitEnabled: boolean;
}

const defaultSettings: WorkspaceSettings = {
  autoCommitEnabled: true, // Default to enabled
};

const SETTING_PATH_AUTO_COMMIT = 'git.autoCommit';

// In-memory store for workspace settings (populated by renderer sync)
const workspaceSettingsStore = new Map<string, WorkspaceSettings>();

// Daemon-hydrated global auto-commit preference. `null` while unhydrated;
// the sync API falls back to the default (true) until hydration completes.
let cachedAutoCommit: boolean | null = null;
let hydrationPromise: Promise<void> | null = null;

async function fetchAutoCommit(): Promise<boolean> {
  const { getBackendClient } = await import('../../backend/main/backend.ipc');
  const result = (await getBackendClient().request('settings.get', {
    path: SETTING_PATH_AUTO_COMMIT,
  })) as { value?: unknown } | null;
  const value = result?.value;
  // Same semantics as the legacy electron-store branch: any value other
  // than an explicit `false` means "enabled" (matches the catalog default).
  return value !== false;
}

/**
 * Hydrate `cachedAutoCommit` once from the daemon.
 * Safe to call repeatedly and eagerly; the sync API will simply keep
 * returning the default until this completes.
 */
export async function initWorkspaceSettings(): Promise<void> {
  if (cachedAutoCommit !== null) return;
  if (hydrationPromise) return hydrationPromise;
  hydrationPromise = (async () => {
    try {
      cachedAutoCommit = await fetchAutoCommit();
      logger.info('Workspace settings hydrated', { autoCommit: cachedAutoCommit });
    } catch (error) {
      logger.warn('Failed to hydrate git.autoCommit from daemon', {
        error: (error as Error).message,
      });
      // Keep the default (true) — matches the pre-P3 fallback.
      cachedAutoCommit = defaultSettings.autoCommitEnabled;
    }
  })();
  return hydrationPromise;
}

/**
 * Get settings for a workspace.
 *
 * If the renderer has synced settings for this workspace, returns those.
 * Otherwise, returns the daemon-hydrated global default (or the built-in
 * default if hydration has not completed yet).
 */
export function getWorkspaceSettings(workspaceId: string): WorkspaceSettings {
  const synced = workspaceSettingsStore.get(workspaceId);
  if (synced) return synced;

  // No renderer sync yet — use the hydrated daemon value, or the default
  // if hydration is still in flight.
  const autoCommitEnabled = cachedAutoCommit ?? defaultSettings.autoCommitEnabled;
  return { autoCommitEnabled };
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
        'Use agent_commit_changes with userRequested: true if the user asked to commit.',
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
 * Test-only: reset internal state so a fresh hydration can run in isolation.
 * @internal
 */
export function __resetWorkspaceSettingsForTesting(): void {
  cachedAutoCommit = null;
  hydrationPromise = null;
  workspaceSettingsStore.clear();
}
