import { DEFAULT_GITLAB_HOST } from '$features/forge-auth/constants';
import type { ForgeAuthMethod, ForgeDeviceFlowInfo, ForgeUser } from '$features/forge-auth/types';
import { normalizeGitLabInstanceUrl } from '$lib/utils/gitlab-host';
import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type { GitLabAuthChangedStatus, GitLabAuthState } from './gitlab-auth-types';

// ============================================================================
// Initial State
// ============================================================================

export const initialState: GitLabAuthState = {
  statusReady: false,
  host: DEFAULT_GITLAB_HOST,
  instanceBaseUrl: null,
  isConfigured: false,
  isAuthenticating: false,
  isCancelling: false,
  cancelOutcome: null,
  deviceFlow: null,
  deviceGrantSupported: null,
  user: null,
  error: null,
  method: null,
};

// ============================================================================
// Actions
// ============================================================================

/** Trigger: read `sourceControl.authStatus { provider: "gitlab", host? }` and hydrate */
export const initializeGitLabAuth =
  createAction<[host?: string, mode?: 'resume' | 'status-only']>('gitlabAuth/initialize');

export const resetGitLabAdmission = createAction('gitlabAuth/resetAdmission');

/** Trigger: start (or resume) the device grant against `host` */
export const startGitLabDeviceAuth = createAction<[host: string]>('gitlabAuth/startDeviceAuth');

/**
 * Single-use handoff for the PAT. Redux action logging and the saga monitor
 * trace action payloads verbatim, so the token never rides on the action:
 * the creator stages it here and the saga takes it by `tokenRef`.
 */
let stagedGitLabPatToken: { ref: number; token: string } | null = null;
let nextGitLabPatTokenRef = 0;

/** Take (and clear) the PAT staged for `ref`; `null` when absent or already consumed. */
export function takeGitLabPatToken(ref: number): string | null {
  if (!stagedGitLabPatToken || stagedGitLabPatToken.ref !== ref) return null;
  const { token } = stagedGitLabPatToken;
  stagedGitLabPatToken = null;
  return token;
}

/**
 * Trigger: connect with a personal access token. The token goes straight to
 * the daemon (`sourceControl.connect { method: "pat", token }`) and is never
 * stored in Redux state nor carried on this action (see `takeGitLabPatToken`).
 */
export const connectGitLabWithToken = createAction(
  'gitlabAuth/connectWithToken',
  (host: string, token: string) => {
    const tokenRef = ++nextGitLabPatTokenRef;
    stagedGitLabPatToken = { ref: tokenRef, token };
    return { host, tokenRef };
  },
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
    instanceBaseUrl?: string;
    isConfigured: boolean;
    deviceGrantSupported: boolean | null;
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

export const setGitLabCancelling = createAction<[value: boolean]>('gitlabAuth/setCancelling');
export const setGitLabCancelOutcome = createAction<[value: GitLabAuthState['cancelOutcome']]>(
  'gitlabAuth/setCancelOutcome',
);

/** Pending device grant was cancelled */
export const gitlabAuthCancelled = createAction('gitlabAuth/authCancelled');

/** Credential revoked */
export const gitlabLogoutCompleted = createAction('gitlabAuth/logoutCompleted');

// ============================================================================
// Reducer
// ============================================================================

export const gitlabAuthReducer = createReducer<GitLabAuthState>(initialState);

gitlabAuthReducer.with(resetGitLabAdmission, () => ({ ...initialState }));
gitlabAuthReducer.with(initializeGitLabAuth, (state) => ({ ...state, statusReady: false }));
gitlabAuthReducer.with(setGitLabHost, (state, { payload: [host] }) => {
  const root = /[/?#\\]/.test(host) ? normalizeGitLabInstanceUrl(host) : null;
  const authority = root ? new URL(root).host : host;
  const sameAuthority = authority.toLowerCase() === state.host.toLowerCase();
  const instanceBaseUrl = root ?? (sameAuthority ? state.instanceBaseUrl : null);
  if (sameAuthority && instanceBaseUrl === state.instanceBaseUrl)
    return { ...state, host: authority };
  // The configured identity, grant support and any pending grant belong to the
  // previous instance; a new host starts unconfigured until its own status is read.
  return {
    ...state,
    host: authority,
    instanceBaseUrl,
    statusReady: false,
    isConfigured: false,
    deviceGrantSupported: null,
    user: null,
    method: null,
    deviceFlow: null,
    isCancelling: false,
    cancelOutcome: null,
  };
});
gitlabAuthReducer.with(setGitLabAuthStatus, (state, { payload }) => ({
  ...state,
  host: payload.host,
  instanceBaseUrl:
    payload.instanceBaseUrl ??
    (payload.host.toLowerCase() === state.host.toLowerCase() ? state.instanceBaseUrl : null),
  statusReady: true,
  isConfigured: payload.isConfigured,
  deviceGrantSupported: payload.deviceGrantSupported,
  user: payload.user,
  method: payload.method,
}));
gitlabAuthReducer.with(setGitLabAuthenticating, (state, { payload: [isAuthenticating] }) => ({
  ...state,
  isAuthenticating,
  ...(isAuthenticating ? { isCancelling: false, cancelOutcome: null } : {}),
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
gitlabAuthReducer.with(setGitLabCancelling, (state, { payload: [isCancelling] }) => ({
  ...state,
  isCancelling,
  ...(isCancelling ? { cancelOutcome: null } : {}),
}));
gitlabAuthReducer.with(setGitLabCancelOutcome, (state, { payload: [cancelOutcome] }) => ({
  ...state,
  isCancelling: false,
  cancelOutcome,
}));
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
