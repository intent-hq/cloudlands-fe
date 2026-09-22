/**
 * Sentry Auth Redux Slice
 *
 * Actions and reducer for Sentry authentication and issue state.
 */

import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { SentryAuthState } from './sentry-auth-types';
import type { SentryIssueResult, SentryProject } from '$features/sentry-auth/types';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';

// =============================================================================
// Initial State
// =============================================================================

const initialState: SentryAuthState = {
  isAuthenticated: false,
  organization: null,
  isConnecting: false,
  error: null,
  projects: [],
  isLoadingProjects: false,
  issues: createCollection<SentryIssueResult, 'id'>('id'),
  isLoadingIssues: false,
  issuesLoaded: false,
};

// =============================================================================
// Saga trigger actions (no reducer handling — sagas orchestrate state updates)
// =============================================================================

/** Trigger: initialize auth state from IPC */
export const initializeSentryAuth = createAction('sentryAuth/initialize');

/** Trigger: connect to Sentry with org + token */
export const connectSentry =
  createAction<[organization: string, apiToken: string]>('sentryAuth/connect');

/** Trigger: disconnect / logout from Sentry */
export const logoutSentry = createAction('sentryAuth/logout');

/** Trigger: load the first issue page for simple picker surfaces. */
export const loadSentryIssuesRequested = createAction('sentryAuth/loadIssuesRequested');

// =============================================================================
// State-setting actions (dispatched by sagas to update reducer)
// =============================================================================

/** Set the full auth state after initialization */
export const setSentryAuthState = createAction(
  'sentryAuth/setAuthState',
  (isAuthenticated: boolean, organization: string | null, error: string | null) => ({
    isAuthenticated,
    organization,
    error,
  }),
);

/** Set connecting state */
export const setSentryConnecting = createAction<[isConnecting: boolean]>(
  'sentryAuth/setConnecting',
);

/** Set error */
export const setSentryError = createAction<[error: string | null]>('sentryAuth/setError');

/** Clear error */
export const clearSentryError = createAction('sentryAuth/clearError');

/** Set authenticated + organization after successful connect */
export const setSentryConnected = createAction(
  'sentryAuth/setConnected',
  (organization: string) => ({ organization }),
);

/** Reset auth state on logout */
export const setSentryLoggedOut = createAction('sentryAuth/setLoggedOut');

/** Set projects */
export const setSentryProjects =
  createAction<[projects: SentryProject[]]>('sentryAuth/setProjects');

/** Set loading projects state */
export const setSentryLoadingProjects = createAction<[isLoading: boolean]>(
  'sentryAuth/setLoadingProjects',
);
export const sentryIssuesLoadStarted = createAction('sentryAuth/issuesLoadStarted');
export const sentryIssuesLoaded =
  createAction<[issues: SentryIssueResult[]]>('sentryAuth/issuesLoaded');
export const sentryIssuesLoadSettled = createAction('sentryAuth/issuesLoadSettled');

// =============================================================================
// Reducer
// =============================================================================

export const sentryAuthReducer = createReducer<SentryAuthState>(initialState);
sentryAuthReducer.with(setSentryAuthState, (state, { payload }) => ({
  ...state,
  isAuthenticated: payload.isAuthenticated,
  organization: payload.organization,
  error: payload.error,
}));
sentryAuthReducer.with(setSentryConnecting, (state, { payload: [isConnecting] }) => ({
  ...state,
  isConnecting,
}));
sentryAuthReducer.with(setSentryError, (state, { payload: [error] }) => ({
  ...state,
  error,
}));
sentryAuthReducer.with(clearSentryError, (state) => ({
  ...state,
  error: null,
}));
sentryAuthReducer.with(setSentryConnected, (state, { payload }) => ({
  ...state,
  isAuthenticated: true,
  organization: payload.organization,
  isConnecting: false,
  error: null,
}));
sentryAuthReducer.with(setSentryLoggedOut, (state) => ({
  ...state,
  isAuthenticated: false,
  organization: null,
  projects: [],
  issues: createCollection<SentryIssueResult, 'id'>('id'),
  issuesLoaded: false,
}));
sentryAuthReducer.with(setSentryProjects, (state, { payload: [projects] }) => ({
  ...state,
  projects,
}));
sentryAuthReducer.with(setSentryLoadingProjects, (state, { payload: [isLoading] }) => ({
  ...state,
  isLoadingProjects: isLoading,
}));
sentryAuthReducer.with(sentryIssuesLoadStarted, (state) => ({ ...state, isLoadingIssues: true }));
sentryAuthReducer.with(sentryIssuesLoaded, (state, { payload: [issues] }) => ({
  ...state,
  issues: createCollection<SentryIssueResult, 'id'>('id', issues),
  issuesLoaded: true,
}));
sentryAuthReducer.with(sentryIssuesLoadSettled, (state) => ({ ...state, isLoadingIssues: false }));
