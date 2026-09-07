/**
 * GitHub auth-status probe.
 *
 * Thin main-process helper over the daemon's `github.authStatus` method
 * (PROTOCOL §5.27). The user counts as authenticated when `isConfigured` is
 * true — even if `configuredButNeedsUpdate` is set (the "needs update" flag
 * typically means optional scopes like `user:email` are missing, but repo
 * access and PR creation still work with the base OAuth scopes). Errors fold
 * to false so callers degrade to the unauthenticated path instead of erroring.
 */

import { Logger } from '../../shared/logger';
import {
  getBackendClient,
  onBackendNotification,
  onBackendReconnected,
} from '../../features/backend/main/backend.ipc';

const logger = new Logger('GitHubAuthStatus');

let cachedStatus: boolean | undefined;
let pendingStatus: { generation: number; promise: Promise<boolean> } | undefined;
let trailingStatus: Promise<boolean> | undefined;
let generation = 0;
let lifecycleInstalled = false;

function invalidateGitHubAuthStatus(): void {
  generation += 1;
  cachedStatus = undefined;
}

function clearPendingStatus(run: Promise<boolean>): void {
  if (pendingStatus?.promise === run) pendingStatus = undefined;
}

function ensureLifecycle(): void {
  if (lifecycleInstalled) return;
  lifecycleInstalled = true;
  if (typeof onBackendNotification === 'function') {
    onBackendNotification((notification) => {
      if (notification.method !== 'events.event' || !notification.params) return;
      const params = notification.params as { event?: unknown; type?: unknown };
      const event = params.event && typeof params.event === 'object' ? params.event : params;
      if ((event as { type?: unknown }).type === 'github:auth-changed') {
        invalidateGitHubAuthStatus();
      }
    });
  }
  if (typeof onBackendReconnected === 'function') {
    onBackendReconnected(() => invalidateGitHubAuthStatus());
  }
}

/** Wire shape of `github.authStatus` (PROTOCOL §5.27). */
interface WireAuthStatus {
  isConfigured?: boolean;
  oauthUrl?: string;
  configuredButNeedsUpdate?: boolean;
  updatedScopes?: string;
}

/**
 * Probe the daemon for GitHub auth state (`isConfigured` ⇒ authenticated).
 */
export async function isGitHubConfigured(): Promise<boolean> {
  ensureLifecycle();
  if (cachedStatus !== undefined) return cachedStatus;
  if (pendingStatus?.generation === generation) return pendingStatus.promise;
  if (pendingStatus) {
    if (trailingStatus) return trailingStatus;
    const next = pendingStatus.promise
      .then(() => {
        if (trailingStatus === next) trailingStatus = undefined;
        return isGitHubConfigured();
      })
      .finally(() => {
        if (trailingStatus === next) trailingStatus = undefined;
      });
    trailingStatus = next;
    return next;
  }
  const requestGeneration = generation;
  let run!: Promise<boolean>;
  run = (async () => {
    try {
      const status = await getBackendClient().request<WireAuthStatus>('github.authStatus');
      if (status?.isConfigured && status.configuredButNeedsUpdate) {
        logger.warn('GitHub is configured but needs scope update', {
          updatedScopes: status.updatedScopes,
        });
      }
      const isConfigured = status?.isConfigured ?? false;
      if (requestGeneration === generation) cachedStatus = isConfigured;
      return isConfigured;
    } catch (error) {
      logger.error('Failed to get GitHub auth status from daemon', error as Error);
      return false;
    } finally {
      clearPendingStatus(run);
    }
  })();
  pendingStatus = { generation: requestGeneration, promise: run };
  return run;
}

export function __resetGitHubAuthStatusForTests(): void {
  cachedStatus = undefined;
  pendingStatus = undefined;
  trailingStatus = undefined;
  generation += 1;
}
