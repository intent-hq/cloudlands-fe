import type { GitHubUser } from "$features/github-auth/types";
import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import type { GitHubAuthState } from "./github-auth-types";

// ============================================================================
// Initial State
// ============================================================================

export const initialState: GitHubAuthState = {
  isAuthenticated: false,
  requiresAugmentAuth: false,
  user: null,
  isAuthenticating: false,
  oauthUrl: null,
  needsScopeUpdate: false,
  error: null,
};

// ============================================================================
// Actions
// ============================================================================

/** Trigger: fetch auth state from backend and hydrate */
export const initializeGitHubAuth = createAction("githubAuth/initialize");

/** Trigger: start the OAuth authentication flow */
export const startGitHubAuth = createAction("githubAuth/startAuth");

/** Trigger: cancel ongoing authentication */
export const cancelGitHubAuth = createAction("githubAuth/cancelAuth");

/** Trigger: log out of GitHub */
export const logoutGitHub = createAction("githubAuth/logout");

/** Trigger: refresh auth state (alias for initialize) */
export const refreshGitHubAuth = createAction("githubAuth/refresh");

/** Set full auth state from backend response */
export const setGitHubAuthState = createAction(
  "githubAuth/setAuthState",
  (params: {
    isAuthenticated: boolean;
    requiresAugmentAuth: boolean;
    user: GitHubUser | null;
    needsScopeUpdate: boolean;
    oauthUrl: string | null;
  }) => params,
);

/** Set authenticating flag and clear error */
export const setAuthenticating = createAction<[isAuthenticating: boolean]>(
  "githubAuth/setAuthenticating",
);

/** Set OAuth URL and needsScopeUpdate after startAuth response */
export const setOAuthInfo = createAction(
  "githubAuth/setOAuthInfo",
  (oauthUrl: string | null, needsScopeUpdate: boolean) => ({ oauthUrl, needsScopeUpdate }),
);

/** Auth completed successfully */
export const authCompleted = createAction(
  "githubAuth/authCompleted",
  (user: GitHubUser | null) => ({ user }),
);

/** Set error message */
export const setGitHubAuthError = createAction<[error: string | null]>(
  "githubAuth/setError",
);

/** Clear error */
export const clearGitHubAuthError = createAction("githubAuth/clearError");

/** Trigger: check auth status once (used on window focus during auth) */
export const checkGitHubAuthStatus = createAction("githubAuth/checkAuthStatus");

/** Auth was cancelled */
export const authCancelled = createAction("githubAuth/authCancelled");

/** Logout completed */
export const logoutCompleted = createAction("githubAuth/logoutCompleted");

// ============================================================================
// Reducer
// ============================================================================

export const githubAuthReducer = createReducer<GitHubAuthState>(initialState)
  .with(setGitHubAuthState, (state, { payload }) => ({
    ...state,
    isAuthenticated: payload.isAuthenticated,
    requiresAugmentAuth: payload.requiresAugmentAuth,
    user: payload.user,
    needsScopeUpdate: payload.needsScopeUpdate,
    oauthUrl: payload.oauthUrl,
  }))
  .with(setAuthenticating, (state, { payload: [isAuthenticating] }) => ({
    ...state,
    isAuthenticating,
    error: isAuthenticating ? null : state.error,
  }))
  .with(setOAuthInfo, (state, { payload }) => ({
    ...state,
    oauthUrl: payload.oauthUrl,
    needsScopeUpdate: payload.needsScopeUpdate,
  }))
  .with(authCompleted, (state, { payload }) => ({
    ...state,
    isAuthenticated: true,
    isAuthenticating: false,
    user: payload.user,
    oauthUrl: null,
  }))
  .with(setGitHubAuthError, (state, { payload: [error] }) => ({
    ...state,
    error,
    isAuthenticating: false,
  }))
  .with(clearGitHubAuthError, (state) => ({
    ...state,
    error: null,
  }))
  .with(authCancelled, (state) => ({
    ...state,
    isAuthenticating: false,
    oauthUrl: null,
  }))
  .with(logoutCompleted, (state) => ({
    ...state,
    isAuthenticated: false,
    user: null,
    oauthUrl: null,
  }));

