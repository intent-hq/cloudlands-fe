import { invoke } from '$lib/electron-bridge';
import type { GitHubAuthStatus, GithubRepo } from '../../../shared/augment-api/augment-api.client';
import { GITHUB_AUTH_CHANNELS } from '../constants';
import type { GitHubAuthState, GitHubUser, StartAuthResult } from '../types';

export const githubAuthClient = {
  /**
   * Check if user is authenticated with GitHub via Augment
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      return await invoke<boolean>(GITHUB_AUTH_CHANNELS.IS_AUTHENTICATED);
    } catch {
      return false;
    }
  },

  /**
   * Get GitHub user info (may be null if not available from Augment API)
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
   * Cancel ongoing authentication
   */
  async cancelAuth(): Promise<void> {
    await invoke(GITHUB_AUTH_CHANNELS.CANCEL_AUTH);
  },

  /**
   * Clear cached authentication state
   */
  async logout(): Promise<void> {
    await invoke(GITHUB_AUTH_CHANNELS.LOGOUT);
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
        requiresAugmentAuth: true,
        user: null,
      };
    }
  },

  /**
   * Get GitHub status from Augment API
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
};
