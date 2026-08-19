import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { LinearAuthSliceState } from './linear-auth-types';

const initialState: LinearAuthSliceState = {
  isAuthenticated: false,
  requiresDaemonAuth: false,
  isAuthenticating: false,
  oauthUrl: null,
  error: null,
  issues: [],
  isLoadingIssues: false,
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
