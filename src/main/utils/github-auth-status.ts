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
import { getBackendClient } from '../../features/backend/main/backend.ipc';
import { createCache } from './cache';

const logger = new Logger('GitHubAuthStatus');

// 30s TTL matching the deleted broker's CACHE_TTL — callers like
// git-tracking gate every poll on this probe, so successful results are
// cached to avoid a github.authStatus round-trip per poll. Failures are
// not cached so recovery is immediate.
const statusCache = createCache<'status', boolean>({ name: 'github-auth-status', ttlMs: 30_000 });

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
  const cached = statusCache.get('status');
  if (cached !== undefined) {
    return cached;
  }
  try {
    const status = await getBackendClient().request<WireAuthStatus>('github.authStatus');
    if (status?.isConfigured && status.configuredButNeedsUpdate) {
      logger.warn('GitHub is configured but needs scope update', {
        updatedScopes: status.updatedScopes,
      });
    }
    const isConfigured = status?.isConfigured ?? false;
    statusCache.set('status', isConfigured);
    return isConfigured;
  } catch (error) {
    logger.error('Failed to get GitHub auth status from daemon', error as Error);
    return false;
  }
}
