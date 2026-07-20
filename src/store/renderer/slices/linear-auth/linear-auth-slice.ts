import type { LinearIssueResult } from "$features/linear-auth/renderer/linear-auth.client";
import { createAction } from "$lib/store-shim/utils/store/create-action";
import { createReducer } from "$lib/store-shim/utils/store/create-reducer";
import type { LinearAuthSliceState, LinearIssueFilter } from "./linear-auth-types";

export const initialState: LinearAuthSliceState = {
  isAuthenticated: false,
  requiresAugmentAuth: false,
  isAuthenticating: false,
  oauthUrl: null,
  error: null,
  issues: [],
  isLoadingIssues: false,
};

// --- Actions ---

/** Trigger: initialize linear auth (store-service probes the daemon) */
export const initializeLinearAuth = createAction("linearAuth/initialize");

/**
 * Trigger: connect with a pasted Linear personal API key. The store-service
 * stores it via the daemon keyring path (`linear.token`, PROTOCOL §5.28) and
 * re-probes `linear.authStatus`.
 */
export const connectLinear = createAction<[apiKey: string]>("linearAuth/connect");

/**
 * Legacy trigger kept for surfaces with a one-click "Connect" button
 * (LinearPicker, IssueSuggestions). §5.28 has no OAuth flow to launch, so the
 * store-service maps this to a status re-probe; the real connect is
 * `connectLinear(apiKey)` from the settings panel.
 */
export const startLinearAuth = createAction("linearAuth/startAuth");

/** Trigger: logout — clears the daemon-held API key and re-probes */
export const logoutLinear = createAction("linearAuth/logout");

/** Trigger: refresh auth state */
export const refreshLinearAuth = createAction("linearAuth/refresh");

/** Trigger: fetch issues */
export const fetchLinearIssues = createAction<[filter: LinearIssueFilter]>(
  "linearAuth/fetchIssues",
);

/** Trigger: search issues */
export const searchLinearIssues = createAction<[query: string]>(
  "linearAuth/searchIssues",
);

/** Set auth state from IPC response */
export const setLinearAuthState = createAction(
  "linearAuth/setAuthState",
  (isAuthenticated: boolean, requiresAugmentAuth: boolean, oauthUrl: string | null) => ({
    isAuthenticated,
    requiresAugmentAuth,
    oauthUrl,
  }),
);

/** Set authenticating flag */
export const setLinearIsAuthenticating = createAction<[value: boolean]>(
  "linearAuth/setIsAuthenticating",
);

/** Set error */
export const setLinearError = createAction<[error: string | null]>(
  "linearAuth/setError",
);

/** Set issues loading state */
export const setLinearIsLoadingIssues = createAction<[value: boolean]>(
  "linearAuth/setIsLoadingIssues",
);

/** Set issues */
export const setLinearIssues = createAction<[issues: LinearIssueResult[]]>(
  "linearAuth/setIssues",
);

// --- Reducer ---

export const linearAuthReducer = createReducer<LinearAuthSliceState>(initialState)
  .with(setLinearAuthState, (state, { payload }) => ({
    ...state,
    isAuthenticated: payload.isAuthenticated,
    requiresAugmentAuth: payload.requiresAugmentAuth,
    oauthUrl: payload.oauthUrl,
  }))
  .with(setLinearIsAuthenticating, (state, { payload: [value] }) => ({
    ...state,
    isAuthenticating: value,
  }))
  .with(setLinearError, (state, { payload: [error] }) => ({
    ...state,
    error,
  }))
  .with(setLinearIsLoadingIssues, (state, { payload: [value] }) => ({
    ...state,
    isLoadingIssues: value,
  }))
  .with(setLinearIssues, (state, { payload: [issues] }) => ({
    ...state,
    issues,
  }));

