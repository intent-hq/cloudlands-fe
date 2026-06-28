import { shell } from 'electron';
import { Logger } from '../../../shared/logger';
import { getBackendClient } from '../../backend/main/backend.ipc';
import type {
  GitHubAuthState,
  GitHubAuthStatus,
  GitHubUser,
  StartAuthResult,
} from '../types';

const logger = new Logger('GitHubAuthService');

/**
 * GitHub Authentication Service
 *
 * Derives GitHub auth state from the daemon's `github.authStatus` method
 * (`isConfigured`). In the PAT-from-env model there is no Augment session
 * file, so auth state no longer depends on `~/.augment/session.json`.
 *
 * Flow:
 * 1. Call `github.authStatus` to check GitHub configuration status
 * 2. If not configured, redirect user to the daemon-provided oauth_url
 * 3. After OAuth completes, the daemon reports isConfigured: true
 */
export class GitHubAuthService {
  private cachedStatus: GitHubAuthStatus | null = null;
  private cachedUser: GitHubUser | null = null;
  private statusCacheTime: number = 0;
  private readonly CACHE_TTL = 30000; // 30 seconds

  /**
   * Check if user is authenticated with GitHub via Augment
   *
   * Note: We consider the user authenticated if `is_configured=true`, even if
   * `configured_but_needs_update=true`. The "needs update" flag typically means
   * optional scopes like `user:email` are missing, but the core functionality
   * (repo access, PR creation) still works with the base OAuth scopes.
   */
  async isAuthenticated(): Promise<boolean> {
    const status = await this.getGitHubStatus();

    // Log a warning if scopes need update, but don't block authentication
    if (status.isConfigured && status.configuredButNeedsUpdate) {
      logger.warn('GitHub is configured but needs scope update', {
        updatedScopes: status.updatedScopes,
      });
    }

    return status.isConfigured;
  }

  /**
   * Get the current GitHub authentication status from Augment API
   */
  async getGitHubStatus(forceRefresh = false): Promise<GitHubAuthStatus> {
    // Return cached status if still valid
    if (!forceRefresh && this.cachedStatus && Date.now() - this.statusCacheTime < this.CACHE_TTL) {
      return this.cachedStatus;
    }

    try {
      // The daemon returns the GitHubAuthStatus shape directly (camelCase parity).
      // PAT-from-env means oauthUrl is "" and hasSession is derived from isConfigured.
      const raw = await getBackendClient().request<Partial<GitHubAuthStatus>>('github.authStatus');
      const status: GitHubAuthStatus = {
        isConfigured: raw?.isConfigured ?? false,
        oauthUrl: raw?.oauthUrl ?? '',
        configuredButNeedsUpdate: raw?.configuredButNeedsUpdate ?? false,
        updatedScopes: raw?.updatedScopes ?? '',
      };
      this.cachedStatus = status;
      this.statusCacheTime = Date.now();

      logger.debug('GitHub auth status from daemon', {
        isConfigured: status.isConfigured,
        hasOauthUrl: !!status.oauthUrl,
        configuredButNeedsUpdate: status.configuredButNeedsUpdate,
      });

      return status;
    } catch (error) {
      logger.error('Failed to get GitHub status from daemon', error as Error);
      return {
        isConfigured: false,
        oauthUrl: '',
        configuredButNeedsUpdate: false,
        updatedScopes: '',
      };
    }
  }

  /**
   * Get the current GitHub user info
   * Note: This requires the GitHub token which we may not have direct access to.
   * The user info might need to come from a different Augment API endpoint.
   */
  async getUser(): Promise<GitHubUser | null> {
    if (this.cachedUser) {
      return this.cachedUser;
    }

    // For now, we don't have direct access to the GitHub token
    // The user info would need to come from an Augment API endpoint
    // TODO: Add an Augment API endpoint to get GitHub user info
    return null;
  }

  /**
   * Start GitHub authentication flow
   * Returns the OAuth URL for the user to visit
   */
  async startAuth(): Promise<StartAuthResult> {
    logger.info('Starting GitHub authentication via Augment');

    // Get the OAuth URL from the daemon
    const status = await this.getGitHubStatus(true);

    logger.info('GitHub status for auth flow', {
      isConfigured: status.isConfigured,
      configuredButNeedsUpdate: status.configuredButNeedsUpdate,
      hasOauthUrl: !!status.oauthUrl,
      oauthUrlLength: status.oauthUrl?.length ?? 0,
    });

    if (status.isConfigured && !status.configuredButNeedsUpdate) {
      logger.info('GitHub already authenticated, skipping browser open');
      return {
        success: true,
        alreadyAuthenticated: true,
      };
    }

    if (!status.oauthUrl) {
      logger.error('No OAuth URL available from Augment API');
      return {
        success: false,
        error: 'Could not get GitHub OAuth URL from Augment API',
      };
    }

    // Open the OAuth URL in the browser
    logger.info('Opening GitHub OAuth URL in browser', {
      url: `${status.oauthUrl.substring(0, 50)  }...`,
    });

    try {
      await shell.openExternal(status.oauthUrl);
      logger.info('Successfully called shell.openExternal for GitHub OAuth');
    } catch (error) {
      logger.error('Failed to open GitHub OAuth URL in browser', error as Error);
      return {
        success: false,
        error: 'Failed to open browser for GitHub authentication',
      };
    }

    return {
      success: true,
      oauthUrl: status.oauthUrl,
      needsScopeUpdate: status.configuredButNeedsUpdate,
      updatedScopes: status.updatedScopes,
    };
  }

  /**
   * Check if authentication completed after user visited OAuth URL
   * This should be called periodically after startAuth()
   */
  async checkAuthComplete(): Promise<boolean> {
    const status = await this.getGitHubStatus(true);
    return status.isConfigured && !status.configuredButNeedsUpdate;
  }

  /**
   * Cancel ongoing authentication (no-op for OAuth redirect flow)
   */
  cancelAuth(): void {
    // Clear cached status to force refresh on next check
    this.cachedStatus = null;
    this.statusCacheTime = 0;
  }

  /**
   * Revoke GitHub access through the daemon.
   *
   * With PAT-from-env auth, `github.revoke` is inert and returns
   * `{ ok: false, guidance }`. We preserve the existing semantics (the UI
   * button stays but does nothing) by always returning the daemon's `ok` flag.
   */
  async revokeAccess(): Promise<boolean> {
    logger.info('Revoking GitHub access');

    // Clear local cache regardless of daemon result
    this.cachedStatus = null;
    this.cachedUser = null;
    this.statusCacheTime = 0;

    try {
      const result = await getBackendClient().request<{ ok?: boolean; guidance?: string }>(
        'github.revoke',
      );
      const success = result?.ok ?? false;
      if (success) {
        logger.info('GitHub access revoked successfully');
      } else {
        logger.warn('GitHub revoke is inert', { guidance: result?.guidance });
      }
      return success;
    } catch (error) {
      logger.warn('Failed to revoke GitHub access via daemon', error as Error);
      return false;
    }
  }

  /**
   * Clear cached authentication state (legacy method)
   */
  async clearAuth(): Promise<void> {
    // Use the new revokeAccess method which actually disconnects
    await this.revokeAccess();
  }

  /**
   * Get the full authentication state for the UI
   */
  async getAuthState(): Promise<GitHubAuthState> {
    const status = await this.getGitHubStatus();
    const user = await this.getUser();

    return {
      isAuthenticated: status.isConfigured,
      requiresAugmentAuth: false,
      needsScopeUpdate: status.configuredButNeedsUpdate,
      updatedScopes: status.updatedScopes,
      oauthUrl: status.oauthUrl,
      user,
    };
  }

  /**
   * Get a validated access token for git operations.
   *
   * Note: With the Augment API integration, we don't have direct access to the
   * GitHub token. All GitHub API operations go through Augment's backend proxy.
   * For git push/pull operations, users need to configure their own git credentials
   * (SSH keys or git credential manager).
   *
   * @returns null - Token is not directly accessible with Augment API integration
   */
  async getValidatedAccessToken(): Promise<string | null> {
    logger.debug(
      'getValidatedAccessToken called - token not available with Augment API integration',
    );
    // With Augment API integration, we don't have direct access to the GitHub token.
    // Git operations should use the user's configured git credentials (SSH or credential manager).
    return null;
  }
}

export const githubAuthService = new GitHubAuthService();
