/**
 * App Settings Service (Main Process)
 *
 * Sync accessors for the three workspace-scoped app settings consumed on
 * synchronous main-process paths (branch-prefix injection, worktree layout,
 * git-env SSH key). The source of truth is the daemon settings catalog
 * (PROTOCOL.md §5.12):
 *
 *   - `workspace.branchPrefix`      → `getBranchPrefix()`
 *   - `workspace.worktreesLocation` → `getWorktreesLocation()`
 *   - `workspace.sshKeyPath`        → `getSshKeyPath()`  (plain string,
 *                                     see intent-services/settings.rs A9)
 *
 * `initAppSettingsService()` hydrates each value into a module-level cache
 * via `settings.get` at process start; the sync getters serve the cached
 * value and fall back to `''` while unhydrated (matches the pre-P3-4
 * behaviour when the electron-store key was absent). This mirrors the
 * hydration-cache pattern used by workspace-settings.service.ts and
 * notification.service.ts.
 *
 * The legacy `settings` electron-store, its `getSetting`/`setSetting`
 * facade, and the dead `websocketApi-*` helpers are retired here — no
 * remaining consumers in main.
 */

import { Logger } from '../../../shared/logger';
import { getBackendClient } from '../../backend/main/backend.ipc';

const logger = new Logger({ category: 'AppSettingsService' });

/** Daemon setting paths hydrated by this service (§5.12). */
const SETTING_PATH_BRANCH_PREFIX = 'workspace.branchPrefix';
const SETTING_PATH_WORKTREES_LOCATION = 'workspace.worktreesLocation';
const SETTING_PATH_SSH_KEY_PATH = 'workspace.sshKeyPath';

/**
 * Hydrated caches. `null` while unhydrated; the sync getters fall back to
 * `''` in that window (identical to the pre-P3-4 default).
 */
let cachedBranchPrefix: string | null = null;
let cachedWorktreesLocation: string | null = null;
let cachedSshKeyPath: string | null = null;
let hydrationPromise: Promise<void> | null = null;

async function fetchStringSetting(path: string): Promise<string> {
  const result = (await getBackendClient().request('settings.get', {
    path,
  })) as { value?: unknown } | null;
  const value = result?.value;
  return typeof value === 'string' ? value : '';
}

/**
 * Hydrate the branchPrefix / worktreesLocation / sshKeyPath caches once
 * from the daemon. Safe to call repeatedly; sync getters keep returning
 * the empty-string default until this resolves.
 */
export async function initAppSettingsService(): Promise<void> {
  if (
    cachedBranchPrefix !== null &&
    cachedWorktreesLocation !== null &&
    cachedSshKeyPath !== null
  ) {
    return;
  }
  if (hydrationPromise) return hydrationPromise;
  hydrationPromise = (async () => {
    const [prefix, worktrees, ssh] = await Promise.all([
      fetchStringSetting(SETTING_PATH_BRANCH_PREFIX).catch((error) => {
        logger.warn('Failed to hydrate workspace.branchPrefix from daemon', {
          error: (error as Error).message,
        });
        return '';
      }),
      fetchStringSetting(SETTING_PATH_WORKTREES_LOCATION).catch((error) => {
        logger.warn('Failed to hydrate workspace.worktreesLocation from daemon', {
          error: (error as Error).message,
        });
        return '';
      }),
      fetchStringSetting(SETTING_PATH_SSH_KEY_PATH).catch((error) => {
        logger.warn('Failed to hydrate workspace.sshKeyPath from daemon', {
          error: (error as Error).message,
        });
        return '';
      }),
    ]);
    cachedBranchPrefix = prefix;
    cachedWorktreesLocation = worktrees;
    cachedSshKeyPath = ssh;
    logger.info('App settings hydrated', {
      hasBranchPrefix: prefix.length > 0,
      hasWorktreesLocation: worktrees.length > 0,
      hasSshKeyPath: ssh.length > 0,
    });
  })();
  return hydrationPromise;
}

/**
 * Get the branch prefix setting.
 * Returns empty string if not set (no prefix) or before hydration completes.
 */
export function getBranchPrefix(): string {
  return cachedBranchPrefix ?? '';
}

/**
 * Get the custom worktrees location setting.
 * Returns empty string if not set (use default ~/intent/workspaces) or
 * before hydration completes.
 */
export function getWorktreesLocation(): string {
  return cachedWorktreesLocation ?? '';
}

/**
 * Get the SSH key path setting.
 * Returns empty string if not set (use default SSH behavior) or before
 * hydration completes.
 */
export function getSshKeyPath(): string {
  return cachedSshKeyPath ?? '';
}

/**
 * Test-only: reset internal caches so a fresh hydration can run in isolation.
 * @internal
 */
export function __resetAppSettingsForTesting(): void {
  cachedBranchPrefix = null;
  cachedWorktreesLocation = null;
  cachedSshKeyPath = null;
  hydrationPromise = null;
}
