import type { LinearIssueResult } from "$features/linear-auth/renderer/linear-auth.client";
import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
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

/** Trigger: initialize linear auth (saga handles IPC) */
export const initializeLinearAuth = createAction("linearAuth/initialize");

/** Trigger: start auth flow (saga handles IPC + polling) */
export const startLinearAuth = createAction("linearAuth/startAuth");

/** Trigger: cancel auth flow */
export const cancelLinearAuth = createAction("linearAuth/cancelAuth");

/** Trigger: logout */
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

/** Set OAuth URL */
export const setLinearOauthUrl = createAction<[url: string | null]>(
  "linearAuth/setOauthUrl",
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
  .with(setLinearOauthUrl, (state, { payload: [url] }) => ({
    ...state,
    oauthUrl: url,
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

