import { invoke } from '$lib/electron-bridge';
import { GITHUB_AUTH_CHANNELS } from '../constants';
import type {
  GitHubAuthState,
  GitHubAuthStatus,
  GithubRepo,
  GitHubUser,
  StartAuthResult,
} from '../types';

export const githubAuthClient = {
  /**
   * Check if user is authenticated with GitHub via the daemon
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      return await invoke<boolean>(GITHUB_AUTH_CHANNELS.IS_AUTHENTICATED);
    } catch {
      return false;
    }
  },

  /**
   * Get GitHub user info (may be null if not available from daemon API)
   */
  async getUser(): Promise<GitHubUser | null> {
    try {
      return await invoke<GitHubUser | null>(GITHUB_AUTH_CHANNELS.GET_USER);
    } catch {
      return null;
    }
  },

  /**
   * Start GitHub authentication - opens OAuth URL in browser
   */
  async startAuth(): Promise<StartAuthResult> {
    return await invoke<StartAuthResult>(GITHUB_AUTH_CHANNELS.START_AUTH);
  },

  /**
   * Check if authentication completed after OAuth redirect
   * Call this periodically after startAuth() to detect when user completes OAuth
   */
  async checkAuthComplete(): Promise<{
    success: boolean;
    data?: { user: GitHubUser | null; isComplete: boolean };
    error?: string;
  }> {
    return await invoke(GITHUB_AUTH_CHANNELS.POLL_FOR_TOKEN);
  },

  /**
   * Cancel ongoing authentication (daemon-side `github.cancelAuth`).
   * Returns the seam envelope so callers only clear UI state on success.
   */
  async cancelAuth(): Promise<{ success: boolean; error?: string }> {
    return invoke(GITHUB_AUTH_CHANNELS.CANCEL_AUTH);
  },

  /**
   * Log out (daemon-side `github.revoke`).
   * Returns the seam envelope so callers only clear UI state on success.
   */
  async logout(): Promise<{ success: boolean; error?: string }> {
    return invoke(GITHUB_AUTH_CHANNELS.LOGOUT);
  },

  /**
   * Get full authentication state for UI
   */
  async getAuthState(): Promise<GitHubAuthState> {
    try {
      return await invoke<GitHubAuthState>(GITHUB_AUTH_CHANNELS.GET_AUTH_STATE);
    } catch {
      return {
        isAuthenticated: false,
        requiresDaemonAuth: true,
        user: null,
      };
    }
  },

  /**
   * Get GitHub status from daemon API
   */
  async getStatus(): Promise<GitHubAuthStatus> {
    try {
      return await invoke<GitHubAuthStatus>(GITHUB_AUTH_CHANNELS.GET_STATUS);
    } catch {
      return {
        isConfigured: false,
        oauthUrl: '',
        configuredButNeedsUpdate: false,
        updatedScopes: '',
      };
    }
  },

  /**
   * List GitHub repositories for the authenticated user
   */
  async listRepos(page?: number): Promise<GithubRepo[]> {
    try {
      const result = await invoke<{ success: boolean; data?: GithubRepo[]; error?: string }>(
        GITHUB_AUTH_CHANNELS.LIST_REPOS,
        { page },
      );
      if (result.success && result.data) {
        return result.data;
      }
      return [];
    } catch {
      return [];
    }
  },

  /**
   * Global GitHub repository search. Returns the seam envelope so the caller
   * can tell a genuinely empty result set apart from a daemon/IPC failure and
   * surface the error in its own loading/error state; a thrown transport error
   * is normalized into an unsuccessful envelope.
   */
  async searchRepos(
    query: string,
  ): Promise<{ success: boolean; data?: GithubRepo[]; error?: string }> {
    try {
      return await invoke<{ success: boolean; data?: GithubRepo[]; error?: string }>(
        GITHUB_AUTH_CHANNELS.SEARCH_REPOS,
        { query },
      );
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};
