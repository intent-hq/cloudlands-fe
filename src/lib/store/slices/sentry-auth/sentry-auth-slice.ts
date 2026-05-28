/**
 * Sentry Auth Redux Slice
 *
 * Actions and reducer for Sentry authentication and issue state.
 */

import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import type { SentryAuthState } from "./sentry-auth-types";
import type { SentryIssueResult, SentryProject } from "$features/sentry-auth/types";
import type { SentryIssueStatusType } from "$features/sentry-auth/constants";

// =============================================================================
// Initial State
// =============================================================================

export const initialState: SentryAuthState = {
  isAuthenticated: false,
  organization: null,
  isConnecting: false,
  error: null,
  projects: [],
  isLoadingProjects: false,
  issues: [],
  isLoadingIssues: false,
};

// =============================================================================
// Saga trigger actions (no reducer handling — sagas orchestrate state updates)
// =============================================================================

/** Trigger: initialize auth state from IPC */
export const initializeSentryAuth = createAction("sentryAuth/initialize");

/** Trigger: connect to Sentry with org + token */
export const connectSentry = createAction<[organization: string, apiToken: string]>(
  "sentryAuth/connect",
);

/** Trigger: disconnect / logout from Sentry */
export const logoutSentry = createAction("sentryAuth/logout");

/** Trigger: fetch projects for the configured organization */
export const fetchSentryProjects = createAction("sentryAuth/fetchProjects");

/** Trigger: fetch issues with optional filters */
export const fetchSentryIssues = createAction(
  "sentryAuth/fetchIssues",
  (status?: SentryIssueStatusType | "all", project?: string) => ({ status, project }),
);

/** Trigger: search issues by query */
export const searchSentryIssues = createAction(
  "sentryAuth/searchIssues",
  (query: string, project?: string) => ({ query, project }),
);

// =============================================================================
// State-setting actions (dispatched by sagas to update reducer)
// =============================================================================

/** Set the full auth state after initialization */
export const setSentryAuthState = createAction(
  "sentryAuth/setAuthState",
  (isAuthenticated: boolean, organization: string | null, error: string | null) => ({
    isAuthenticated,
    organization,
    error,
  }),
);

/** Set connecting state */
export const setSentryConnecting = createAction<[isConnecting: boolean]>(
  "sentryAuth/setConnecting",
);

/** Set error */
export const setSentryError = createAction<[error: string | null]>("sentryAuth/setError");

/** Clear error */
export const clearSentryError = createAction("sentryAuth/clearError");

/** Set authenticated + organization after successful connect */
export const setSentryConnected = createAction(
  "sentryAuth/setConnected",
  (organization: string) => ({ organization }),
);

/** Reset auth state on logout */
export const setSentryLoggedOut = createAction("sentryAuth/setLoggedOut");

/** Set projects */
export const setSentryProjects = createAction<[projects: SentryProject[]]>(
  "sentryAuth/setProjects",
);

/** Set loading projects state */
export const setSentryLoadingProjects = createAction<[isLoading: boolean]>(
  "sentryAuth/setLoadingProjects",
);

/** Set issues */
export const setSentryIssues = createAction<[issues: SentryIssueResult[]]>(
  "sentryAuth/setIssues",
);

/** Set loading issues state */
export const setSentryLoadingIssues = createAction<[isLoading: boolean]>(
  "sentryAuth/setLoadingIssues",
);

// =============================================================================
// Reducer
// =============================================================================

export const sentryAuthReducer = createReducer<SentryAuthState>(initialState)
  .with(setSentryAuthState, (state, { payload }) => ({
    ...state,
    isAuthenticated: payload.isAuthenticated,
    organization: payload.organization,
    error: payload.error,
  }))
  .with(setSentryConnecting, (state, { payload: [isConnecting] }) => ({
    ...state,
    isConnecting,
  }))
  .with(setSentryError, (state, { payload: [error] }) => ({
    ...state,
    error,
  }))
  .with(clearSentryError, (state) => ({
    ...state,
    error: null,
  }))
  .with(setSentryConnected, (state, { payload }) => ({
    ...state,
    isAuthenticated: true,
    organization: payload.organization,
    isConnecting: false,
    error: null,
  }))
  .with(setSentryLoggedOut, (state) => ({
    ...state,
    isAuthenticated: false,
    organization: null,
    projects: [],
    issues: [],
  }))
  .with(setSentryProjects, (state, { payload: [projects] }) => ({
    ...state,
    projects,
  }))
  .with(setSentryLoadingProjects, (state, { payload: [isLoading] }) => ({
    ...state,
    isLoadingProjects: isLoading,
  }))
  .with(setSentryIssues, (state, { payload: [issues] }) => ({
    ...state,
    issues,
  }))
  .with(setSentryLoadingIssues, (state, { payload: [isLoading] }) => ({
    ...state,
    isLoadingIssues: isLoading,
  }));

