import type { GitHubUser } from '../types';
import { githubAuthClient } from './github-auth.client';

interface GitHubAuthStoreState {
  /** Whether user is authenticated with GitHub via Augment */
  isAuthenticated: boolean;
  /** Whether user needs to authenticate with Augment first */
  requiresAugmentAuth: boolean;
  /** GitHub user info (if available) */
  user: GitHubUser | null;
  /** Whether authentication is in progress */
  isAuthenticating: boolean;
  /** OAuth URL for authentication (shown to user) */
  oauthUrl: string | null;
  /** Whether GitHub is configured but needs scope update */
  needsScopeUpdate: boolean;
  /** Error message if any */
  error: string | null;
}

// Polling interval for checking auth completion (1 second for snappier updates)
const AUTH_POLL_INTERVAL = 1000;
// Maximum time to poll for auth completion (5 minutes)
const AUTH_POLL_TIMEOUT = 300000;

function createGitHubAuthStore() {
  const state = $state<GitHubAuthStoreState>({
    isAuthenticated: false,
    requiresAugmentAuth: false,
    user: null,
    isAuthenticating: false,
    oauthUrl: null,
    needsScopeUpdate: false,
    error: null,
  });

  let pollIntervalId: ReturnType<typeof setInterval> | null = null;
  let pollStartTime: number = 0;

  async function initialize() {
    const authState = await githubAuthClient.getAuthState();
    state.isAuthenticated = authState.isAuthenticated;
    state.requiresAugmentAuth = authState.requiresAugmentAuth;
    state.user = authState.user;
    state.needsScopeUpdate = authState.needsScopeUpdate ?? false;
    state.oauthUrl = authState.oauthUrl ?? null;
  }

  async function startAuth() {
    state.error = null;
    state.isAuthenticating = true;

    try {
      const result = await githubAuthClient.startAuth();

      if (!result.success) {
        state.error = result.error || 'Failed to start authentication';
        state.isAuthenticating = false;
        console.error('[GitHubAuth] startAuth failed', result.error);
        return;
      }

      // If already authenticated, just update state
      if (result.alreadyAuthenticated) {
        state.isAuthenticated = true;
        state.isAuthenticating = false;
        state.oauthUrl = null;
        return;
      }

      // Store OAuth URL for display
      state.oauthUrl = result.oauthUrl ?? null;
      state.needsScopeUpdate = result.needsScopeUpdate ?? false;

      // Start polling for auth completion
      pollStartTime = Date.now();

      // Do an immediate check before starting the interval
      checkAuthStatus();

      pollIntervalId = setInterval(checkAuthStatus, AUTH_POLL_INTERVAL);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      // Surface clearer guidance for preload/channel issues
      if (message.includes('Unauthorized channel')) {
        state.error =
          'GitHub auth IPC was blocked. Please restart the app so the preload allowlist is refreshed.';
      } else {
        state.error = message;
      }
      state.isAuthenticating = false;
      console.error('[GitHubAuth] startAuth error', error);
    }
  }

  async function checkAuthStatus() {
    // Check for timeout
    if (Date.now() - pollStartTime > AUTH_POLL_TIMEOUT) {
      stopPolling();
      state.error = 'Authentication timed out. Please try again.';
      state.isAuthenticating = false;
      return;
    }

    try {
      const checkResult = await githubAuthClient.checkAuthComplete();

      if (checkResult.success && checkResult.data?.isComplete) {
        stopPolling();
        state.isAuthenticated = true;
        state.user = checkResult.data.user ?? null;
        state.oauthUrl = null;
        state.isAuthenticating = false;
      }
    } catch (error) {
      console.error('[GitHubAuth] Poll check failed', error);
    }
  }

  function stopPolling() {
    if (pollIntervalId) {
      clearInterval(pollIntervalId);
      pollIntervalId = null;
    }
  }

  async function cancelAuth() {
    stopPolling();
    await githubAuthClient.cancelAuth();
    state.isAuthenticating = false;
    state.oauthUrl = null;
  }

  async function logout() {
    stopPolling();
    await githubAuthClient.logout();
    state.isAuthenticated = false;
    state.user = null;
    state.oauthUrl = null;
  }

  function clearError() {
    state.error = null;
  }

  /**
   * Refresh the auth state from the API
   */
  async function refresh() {
    await initialize();
  }

  return {
    get state() {
      return state;
    },
    initialize,
    startAuth,
    cancelAuth,
    logout,
    clearError,
    refresh,
    checkAuthStatus,
  };
}

export const githubAuthStore = createGitHubAuthStore();
