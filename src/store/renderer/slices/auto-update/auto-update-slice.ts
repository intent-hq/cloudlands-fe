import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { AutoUpdateState } from './auto-update-types';
import type { UpdateProgress, UpdateState } from '$features/auto-update/types';
import { m } from '$shared/paraglide/messages.js';

const initialState: AutoUpdateState = {
  status: 'idle',
  currentVersion: '',
  updateInfo: null,
  progress: null,
  error: null,
  channel: 'stable',
  toastVisible: false,
  downloadedToastDismissedAt: null,
};

// --- Actions ---

/** Replace the entire update state (from IPC status-changed or initial fetch) */
export const setUpdateState = createAction<[state: UpdateState]>('autoUpdate/setUpdateState');

/** Set download progress */
export const setProgress = createAction<[progress: UpdateProgress]>('autoUpdate/setProgress');

/** Set update error */
export const setUpdateError = createAction<[error: string]>('autoUpdate/setUpdateError');

/** Show the update toast */
export const showToast = createAction('autoUpdate/showToast');

/** Hide the update toast */
export const hideToast = createAction('autoUpdate/hideToast');

/** Dismiss the "downloaded" toast — records timestamp for 24h cooldown */
export const dismissDownloadedToast = createAction<[dismissedAt: number]>(
  'autoUpdate/dismissDownloadedToast',
);

/** Menu-triggered: show toast + set checking immediately */
export const showToastChecking = createAction('autoUpdate/showToastChecking');

/** Up-to-date event received */
export const setUpToDate = createAction<[version: string]>('autoUpdate/setUpToDate');

/** Check timed out — set error state */
export const setCheckTimedOut = createAction('autoUpdate/setCheckTimedOut');

// --- Dev-only simulation actions ---
export const simulateSetState = createAction(
  'autoUpdate/simulateSetState',
  (state: Partial<AutoUpdateState>) => state,
);

/** Trigger: download the available update */
export const downloadUpdate = createAction('autoUpdate/downloadUpdate');

/** Trigger: install the downloaded update */
export const installUpdate = createAction('autoUpdate/installUpdate');

/** Trigger: initialize auto-update (IPC fetch + subscriptions) */
export const initAutoUpdate = createAction('autoUpdate/initAutoUpdate');

// --- Reducer ---

export const autoUpdateReducer = createReducer<AutoUpdateState>(initialState);

autoUpdateReducer.with(setUpdateState, (state, { payload: [updateState] }) => ({
  ...state,
  status: updateState.status,
  currentVersion: updateState.currentVersion,
  updateInfo: updateState.updateInfo,
  progress: updateState.progress,
  error: updateState.error,
  channel: updateState.channel,
}));
autoUpdateReducer.with(setProgress, (state, { payload: [progress] }) => ({
  ...state,
  progress,
}));
autoUpdateReducer.with(setUpdateError, (state, { payload: [error] }) => ({
  ...state,
  status: 'error' as const,
  error,
}));
autoUpdateReducer.with(showToast, (state) => ({
  ...state,
  toastVisible: true,
}));
autoUpdateReducer.with(hideToast, (state) => ({
  ...state,
  toastVisible: false,
}));
autoUpdateReducer.with(dismissDownloadedToast, (state, { payload: [dismissedAt] }) => ({
  ...state,
  toastVisible: false,
  downloadedToastDismissedAt: dismissedAt,
}));
autoUpdateReducer.with(showToastChecking, (state) => ({
  ...state,
  toastVisible: true,
  status: 'checking' as const,
  // A manual check is an explicit request to see the result — clear the 24h
  // dismiss cooldown so a re-landed 'downloaded' status shows persistently.
  downloadedToastDismissedAt: null,
}));
autoUpdateReducer.with(setUpToDate, (state, { payload: [version] }) => ({
  ...state,
  status: 'not-available' as const,
  currentVersion: version || state.currentVersion,
}));
autoUpdateReducer.with(setCheckTimedOut, (state) => {
  if (state.status !== 'checking') return state;
  return {
    ...state,
    status: 'error' as const,
    error: m.autoUpdate_check_timeout_error(),
  };
});
autoUpdateReducer.with(simulateSetState, (state, action) => ({
  ...state,
  ...action.payload,
}));
