import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { LinearAuthSliceState } from './linear-auth-types';
import type { LinearIssueFilter } from '$features/linear-auth/constants';
import type { LinearIssueResult } from '$features/linear-auth/renderer/linear-auth.client';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';

const initialState: LinearAuthSliceState = {
  isAuthenticated: false,
  requiresDaemonAuth: false,
  isAuthenticating: false,
  oauthUrl: null,
  error: null,
  issues: createCollection<LinearIssueResult, 'id'>('id'),
  isLoadingIssues: false,
  issueFilter: 'all',
  issueFilterLoaded: false,
};

// --- Actions ---

/** Trigger: initialize linear auth (store-service probes the daemon) */
export const initializeLinearAuth = createAction('linearAuth/initialize');

/**
 * Trigger: connect with a pasted Linear personal API key. The store-service
 * stores it via the daemon keyring path (`linear.token`, PROTOCOL §5.28) and
 * re-probes `linear.authStatus`.
 */
export const connectLinear = createAction<[apiKey: string]>('linearAuth/connect');

/**
 * Legacy trigger kept for surfaces with a one-click "Connect" button
 * (LinearPicker, IssueSuggestions). §5.28 has no OAuth flow to launch, so the
 * store-service maps this to a status re-probe; the real connect is
 * `connectLinear(apiKey)` from the settings panel.
 */
export const startLinearAuth = createAction('linearAuth/startAuth');

/** Trigger: logout — clears the daemon-held API key and re-probes */
export const logoutLinear = createAction('linearAuth/logout');

/** Trigger: hydrate the FE-local issue filter. */
export const initializeLinearIssueFilter = createAction('linearAuth/initializeIssueFilter');

/** User intent: update and persist the FE-local issue filter. */
export const setLinearIssueFilter = createAction<[filter: LinearIssueFilter]>(
  'linearAuth/setIssueFilter',
);

/** Hydration result; separate from user intent so boot does not write back. */
export const hydrateLinearIssueFilter = createAction<[filter: LinearIssueFilter]>(
  'linearAuth/hydrateIssueFilter',
);

export const loadLinearIssuesRequested = createAction<[filter: LinearIssueFilter]>(
  'linearAuth/loadIssuesRequested',
);
export const linearIssuesLoadStarted = createAction('linearAuth/issuesLoadStarted');
export const linearIssuesLoaded =
  createAction<[issues: LinearIssueResult[]]>('linearAuth/issuesLoaded');
export const linearIssuesLoadSettled = createAction('linearAuth/issuesLoadSettled');

/** Set auth state from IPC response */
export const setLinearAuthState = createAction(
  'linearAuth/setAuthState',
  (isAuthenticated: boolean, requiresDaemonAuth: boolean, oauthUrl: string | null) => ({
    isAuthenticated,
    requiresDaemonAuth,
    oauthUrl,
  }),
);

/** Set authenticating flag */
export const setLinearIsAuthenticating = createAction<[value: boolean]>(
  'linearAuth/setIsAuthenticating',
);

/** Set error */
export const setLinearError = createAction<[error: string | null]>('linearAuth/setError');

// --- Reducer ---

export const linearAuthReducer = createReducer<LinearAuthSliceState>(initialState);

linearAuthReducer.with(setLinearAuthState, (state, { payload }) => ({
  ...state,
  isAuthenticated: payload.isAuthenticated,
  requiresDaemonAuth: payload.requiresDaemonAuth,
  oauthUrl: payload.oauthUrl,
}));
linearAuthReducer.with(setLinearIsAuthenticating, (state, { payload: [value] }) => ({
  ...state,
  isAuthenticating: value,
}));
linearAuthReducer.with(setLinearError, (state, { payload: [error] }) => ({
  ...state,
  error,
}));
linearAuthReducer.with(setLinearIssueFilter, (state, { payload: [issueFilter] }) => ({
  ...state,
  issueFilter,
  issueFilterLoaded: true,
}));
linearAuthReducer.with(hydrateLinearIssueFilter, (state, { payload: [issueFilter] }) => ({
  ...state,
  issueFilter,
  issueFilterLoaded: true,
}));
linearAuthReducer.with(linearIssuesLoadStarted, (state) => ({
  ...state,
  isLoadingIssues: true,
}));
linearAuthReducer.with(linearIssuesLoaded, (state, { payload: [issues] }) => ({
  ...state,
  issues: createCollection<LinearIssueResult, 'id'>('id', issues),
}));
linearAuthReducer.with(linearIssuesLoadSettled, (state) => ({
  ...state,
  isLoadingIssues: false,
}));
