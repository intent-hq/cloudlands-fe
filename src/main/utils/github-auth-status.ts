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

const logger = new Logger('GitHubAuthStatus');

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
  try {
    const status = await getBackendClient().request<WireAuthStatus>('github.authStatus');
    if (status?.isConfigured && status.configuredButNeedsUpdate) {
      logger.warn('GitHub is configured but needs scope update', {
        updatedScopes: status.updatedScopes,
      });
    }
    return status?.isConfigured ?? false;
  } catch (error) {
    logger.error('Failed to get GitHub auth status from daemon', error as Error);
    return false;
  }
}
