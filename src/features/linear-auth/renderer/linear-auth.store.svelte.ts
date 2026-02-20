import { linearAuthClient, type LinearIssueResult } from './linear-auth.client';

interface LinearAuthStoreState {
  /** Whether user is authenticated with Linear via Augment */
  isAuthenticated: boolean;
  /** Whether user needs to authenticate with Augment first */
  requiresAugmentAuth: boolean;
  /** Whether authentication is in progress */
  isAuthenticating: boolean;
  /** OAuth URL for authentication (shown to user) */
  oauthUrl: string | null;
  /** Error message if any */
  error: string | null;
  /** Cached issues for the current user */
  issues: LinearIssueResult[];
  /** Whether issues are being loaded */
  isLoadingIssues: boolean;
}

const POLL_INTERVAL = 3000; // 3 seconds
const POLL_TIMEOUT = 300000; // 5 minutes max wait

function createLinearAuthStore() {
  const state = $state<LinearAuthStoreState>({
    isAuthenticated: false,
    requiresAugmentAuth: false,
    isAuthenticating: false,
    oauthUrl: null,
    error: null,
    issues: [],
    isLoadingIssues: false,
  });

  let pollIntervalId: ReturnType<typeof setInterval> | null = null;
  let pollStartTime: number = 0;

  async function initialize() {
    // Force refresh on initialize to get latest status
    const authState = await linearAuthClient.getAuthState(true);
    state.isAuthenticated = authState.isAuthenticated;
    state.requiresAugmentAuth = authState.requiresAugmentAuth;
    state.oauthUrl = authState.oauthUrl ?? null;
  }

  async function startAuth() {
    state.error = null;
    state.isAuthenticating = true;

    try {
      const result = await linearAuthClient.startAuth();

      if (!result.success) {
        state.error = result.error ?? 'Failed to start authentication';
        state.isAuthenticating = false;
        return;
      }

      if (result.alreadyAuthenticated) {
        state.isAuthenticated = true;
        state.isAuthenticating = false;
        return;
      }

      // Store the OAuth URL for display
      state.oauthUrl = result.oauthUrl ?? null;

      // Start polling for completion
      startPolling();
    } catch (error) {
      state.error = error instanceof Error ? error.message : 'Failed to start authentication';
      state.isAuthenticating = false;
    }
  }

  function startPolling() {
    stopPolling();
    pollStartTime = Date.now();

    pollIntervalId = setInterval(async () => {
      // Check for timeout
      if (Date.now() - pollStartTime > POLL_TIMEOUT) {
        stopPolling();
        state.error = 'Authentication timed out. Please try again.';
        state.isAuthenticating = false;
        return;
      }

      // Check if auth completed - force refresh to bypass cache
      const authState = await linearAuthClient.getAuthState(true);

      if (authState.isAuthenticated) {
        stopPolling();
        state.isAuthenticated = true;
        state.isAuthenticating = false;
        state.oauthUrl = null;
      }
    }, POLL_INTERVAL);
  }

  function stopPolling() {
    if (pollIntervalId) {
      clearInterval(pollIntervalId);
      pollIntervalId = null;
    }
  }

  async function cancelAuth() {
    stopPolling();
    await linearAuthClient.cancelAuth();
    state.isAuthenticating = false;
    state.oauthUrl = null;
  }

  async function logout() {
    stopPolling();
    await linearAuthClient.logout();
    state.isAuthenticated = false;
    state.oauthUrl = null;
  }

  function clearError() {
    state.error = null;
  }

  async function refresh() {
    await initialize();
  }

  /**
   * Fetch issues based on filter type
   * @param filter - The type of issues to fetch (defaults to 'assigned')
   */
  async function fetchMyIssues(
    filter: 'assigned' | 'created' | 'subscribed' | 'team' | 'all' = 'assigned',
  ): Promise<LinearIssueResult[]> {
    if (!state.isAuthenticated) {
      return [];
    }

    state.isLoadingIssues = true;
    try {
      const issues = await linearAuthClient.fetchMyIssues(filter);
      state.issues = issues;
      return issues;
    } catch (error) {
      console.error('[LinearAuthStore] Failed to fetch issues:', error);
      return [];
    } finally {
      state.isLoadingIssues = false;
    }
  }

  /**
   * Search issues by query
   */
  async function searchIssues(query: string): Promise<LinearIssueResult[]> {
    if (!state.isAuthenticated) {
      return [];
    }

    state.isLoadingIssues = true;
    try {
      return await linearAuthClient.searchIssues(query);
    } catch (error) {
      console.error('[LinearAuthStore] Failed to search issues:', error);
      return [];
    } finally {
      state.isLoadingIssues = false;
    }
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
    fetchMyIssues,
    searchIssues,
  };
}

export const linearAuthStore = createLinearAuthStore();

// Re-export the type for convenience
export type { LinearIssueResult } from './linear-auth.client';
