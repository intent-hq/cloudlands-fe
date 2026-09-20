import { DEFAULT_GITLAB_HOST } from '$features/forge-auth/constants';
import type { ForgeAuthMethod, ForgeDeviceFlowInfo, ForgeUser } from '$features/forge-auth/types';
import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { GitLabAuthChangedStatus, GitLabAuthState } from './gitlab-auth-types';

// ============================================================================
// Initial State
// ============================================================================

export const initialState: GitLabAuthState = {
  host: DEFAULT_GITLAB_HOST,
  isConfigured: false,
  isAuthenticating: false,
  deviceFlow: null,
  deviceGrantSupported: false,
  user: null,
  error: null,
  method: null,
};

// ============================================================================
// Actions
// ============================================================================

/** Trigger: read `sourceControl.authStatus { provider: "gitlab", host? }` and hydrate */
export const initializeGitLabAuth = createAction<[host?: string]>('gitlabAuth/initialize');

/** Trigger: start (or resume) the device grant against `host` */
export const startGitLabDeviceAuth = createAction<[host: string]>('gitlabAuth/startDeviceAuth');

/**
 * Trigger: connect with a personal access token. The token goes straight to
 * the daemon (`sourceControl.connect { method: "pat", token }`) and is never
 * stored in Redux state.
 */
export const connectGitLabWithToken = createAction<[host: string, token: string]>(
  'gitlabAuth/connectWithToken',
);

/** Trigger: cancel the pending device grant */
export const cancelGitLabAuth = createAction('gitlabAuth/cancelAuth');

/** Trigger: revoke the stored GitLab credential */
export const logoutGitLab = createAction('gitlabAuth/logout');

/** Trigger: check whether a pending device grant completed (window-focus fallback) */
export const checkGitLabAuthStatus = createAction('gitlabAuth/checkAuthStatus');

/** A `sourceControl:auth-changed { provider: "gitlab" }` event arrived from the daemon */
export const gitlabAuthChanged =
  createAction<[status: GitLabAuthChangedStatus, host?: string]>('gitlabAuth/authChanged');

/** Set the instance host the connection targets */
export const setGitLabHost = createAction<[host: string]>('gitlabAuth/setHost');

/** Hydrate the configured / identity fields from `sourceControl.authStatus` */
export const setGitLabAuthStatus = createAction(
  'gitlabAuth/setAuthStatus',
  (params: {
    host: string;
    isConfigured: boolean;
    deviceGrantSupported: boolean;
    user: ForgeUser | null;
    method: ForgeAuthMethod | null;
  }) => params,
);

/** Set authenticating flag and clear error */
export const setGitLabAuthenticating = createAction<[isAuthenticating: boolean]>(
  'gitlabAuth/setAuthenticating',
);

/** Set the device-grant codes after `sourceControl.connect` */
export const setGitLabDeviceFlowInfo = createAction<[deviceFlow: ForgeDeviceFlowInfo | null]>(
  'gitlabAuth/setDeviceFlowInfo',
);

/** The host refused the device grant — the UI must fall back to a PAT */
export const gitlabDeviceGrantUnsupported = createAction<[error: string]>(
  'gitlabAuth/deviceGrantUnsupported',
);

/** Connect completed (device grant authorized or PAT stored) */
export const gitlabAuthCompleted = createAction(
  'gitlabAuth/authCompleted',
  (params: { user: ForgeUser | null; method: ForgeAuthMethod | null }) => params,
);

/** Set error message */
export const setGitLabAuthError = createAction<[error: string | null]>('gitlabAuth/setError');

/** Clear error */
export const clearGitLabAuthError = createAction('gitlabAuth/clearError');

/** Pending device grant was cancelled */
export const gitlabAuthCancelled = createAction('gitlabAuth/authCancelled');

/** Credential revoked */
export const gitlabLogoutCompleted = createAction('gitlabAuth/logoutCompleted');

// ============================================================================
// Reducer
// ============================================================================

export const gitlabAuthReducer = createReducer<GitLabAuthState>(initialState);

gitlabAuthReducer.with(setGitLabHost, (state, { payload: [host] }) => ({ ...state, host }));
gitlabAuthReducer.with(setGitLabAuthStatus, (state, { payload }) => ({
  ...state,
  host: payload.host,
  isConfigured: payload.isConfigured,
  deviceGrantSupported: payload.deviceGrantSupported,
  user: payload.user,
  method: payload.method,
}));
gitlabAuthReducer.with(setGitLabAuthenticating, (state, { payload: [isAuthenticating] }) => ({
  ...state,
  isAuthenticating,
  error: isAuthenticating ? null : state.error,
}));
gitlabAuthReducer.with(setGitLabDeviceFlowInfo, (state, { payload: [deviceFlow] }) => ({
  ...state,
  deviceFlow,
}));
gitlabAuthReducer.with(gitlabDeviceGrantUnsupported, (state, { payload: [error] }) => ({
  ...state,
  deviceGrantSupported: false,
  isAuthenticating: false,
  deviceFlow: null,
  error,
}));
gitlabAuthReducer.with(gitlabAuthCompleted, (state, { payload }) => ({
  ...state,
  isConfigured: true,
  isAuthenticating: false,
  deviceFlow: null,
  user: payload.user,
  method: payload.method,
  error: null,
}));
gitlabAuthReducer.with(setGitLabAuthError, (state, { payload: [error] }) => ({
  ...state,
  error,
  isAuthenticating: false,
  deviceFlow: null,
}));
gitlabAuthReducer.with(clearGitLabAuthError, (state) => ({ ...state, error: null }));
gitlabAuthReducer.with(gitlabAuthCancelled, (state) => ({
  ...state,
  isAuthenticating: false,
  deviceFlow: null,
}));
gitlabAuthReducer.with(gitlabLogoutCompleted, (state) => ({
  ...state,
  isConfigured: false,
  isAuthenticating: false,
  deviceFlow: null,
  user: null,
  method: null,
}));
