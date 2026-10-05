import { invoke } from '$lib/electron-bridge';
import { GITHUB_AUTH_CHANNELS } from '../constants';
import type {
  CancelAuthOptions,
  GitHubAuthState,
  GitHubAuthStatus,
  GithubRepo,
  GitHubUser,
  GithubUserSearchHit,
  StartAuthOptions,
  StartAuthResult,
} from '../types';

export const githubAuthClient = {
  /**
   * Check if user is authenticated with GitHub via the daemon
   */
  async isAuthenticated(workspaceId?: string): Promise<boolean> {
    try {
      return await invoke<boolean>(
        GITHUB_AUTH_CHANNELS.IS_AUTHENTICATED,
        ...(workspaceId === undefined ? [] : [{ workspaceId }]),
      );
    } catch {
      return false;
    }
  },

  /**
   * Get GitHub user info (may be null if not available from daemon API)
   */
  async getUser(workspaceId?: string): Promise<GitHubUser | null> {
    try {
      return await invoke<GitHubUser | null>(
        GITHUB_AUTH_CHANNELS.GET_USER,
        ...(workspaceId === undefined ? [] : [{ workspaceId }]),
      );
    } catch {
      return null;
    }
  },

  /**
   * Start GitHub authentication - opens OAuth URL in browser.
   * `reconnect: true` forces a fresh device flow on an existing connection.
   */
  async startAuth(options?: StartAuthOptions): Promise<StartAuthResult> {
    return options
      ? await invoke<StartAuthResult>(GITHUB_AUTH_CHANNELS.START_AUTH, options)
      : await invoke<StartAuthResult>(GITHUB_AUTH_CHANNELS.START_AUTH);
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
   * Cancel ongoing authentication (daemon-side `github.cancelAuth`), scoped
   * to the flow `startAuth` returned when `options.flowId` is known.
   * Returns the seam envelope so callers only clear UI state on success.
   */
  async cancelAuth(options?: CancelAuthOptions): Promise<{ success: boolean; error?: string }> {
    return options
      ? invoke(GITHUB_AUTH_CHANNELS.CANCEL_AUTH, options)
      : invoke(GITHUB_AUTH_CHANNELS.CANCEL_AUTH);
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
  async getAuthState(workspaceId?: string): Promise<GitHubAuthState> {
    try {
      return await invoke<GitHubAuthState>(
        GITHUB_AUTH_CHANNELS.GET_AUTH_STATE,
        ...(workspaceId === undefined ? [] : [{ workspaceId }]),
      );
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
  async getStatus(workspaceId?: string): Promise<GitHubAuthStatus> {
    try {
      return await invoke<GitHubAuthStatus>(
        GITHUB_AUTH_CHANNELS.GET_STATUS,
        ...(workspaceId === undefined ? [] : [{ workspaceId }]),
      );
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
  async listRepos(page?: number, workspaceId?: string): Promise<GithubRepo[]> {
    const result = await invoke<{ success: boolean; data?: GithubRepo[]; error?: string }>(
      GITHUB_AUTH_CHANNELS.LIST_REPOS,
      { page, ...(workspaceId === undefined ? {} : { workspaceId }) },
    );
    if (!result.success) throw new Error(result.error || 'Repository discovery failed'); // i18n-ignore (wire-error fallback)
    return result.data ?? [];
  },

  /**
   * Global GitHub repository search. Returns the seam envelope so the caller
   * can tell a genuinely empty result set apart from a daemon/IPC failure and
   * surface the error in its own loading/error state; a thrown transport error
   * is normalized into an unsuccessful envelope.
   */
  async searchRepos(
    query: string,
    workspaceId?: string,
  ): Promise<{ success: boolean; data?: GithubRepo[]; error?: string }> {
    try {
      return await invoke<{ success: boolean; data?: GithubRepo[]; error?: string }>(
        GITHUB_AUTH_CHANNELS.SEARCH_REPOS,
        { query, ...(workspaceId === undefined ? {} : { workspaceId }) },
      );
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  /**
   * Login-prefix GitHub user search (`github.users.search`, §5.27) for the
   * Share dialog's pin typeahead. Same envelope contract as `searchRepos`.
   */
  async searchUsers(
    query: string,
    workspaceId?: string,
  ): Promise<{ success: boolean; data?: GithubUserSearchHit[]; error?: string }> {
    try {
      return await invoke<{ success: boolean; data?: GithubUserSearchHit[]; error?: string }>(
        GITHUB_AUTH_CHANNELS.SEARCH_USERS,
        { query, ...(workspaceId === undefined ? {} : { workspaceId }) },
      );
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};
