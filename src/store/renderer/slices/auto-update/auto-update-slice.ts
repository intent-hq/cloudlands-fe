import { createAction } from "ag-redux-toolkit/utils/store/create-action";
import { createReducer } from "ag-redux-toolkit/utils/store/create-reducer";
import type { AutoUpdateState } from "./auto-update-types";
import type { UpdateChannel, UpdateProgress, UpdateState } from "$features/auto-update/types";

export const initialState: AutoUpdateState = {
  status: "idle",
  currentVersion: "",
  updateInfo: null,
  progress: null,
  error: null,
  channel: "stable",
  toastVisible: false,
  downloadedToastDismissedAt: null,
};

// --- Actions ---

/** Replace the entire update state (from IPC status-changed or initial fetch) */
export const setUpdateState = createAction<[state: UpdateState]>("autoUpdate/setUpdateState");

/** Set download progress */
export const setProgress = createAction<[progress: UpdateProgress]>("autoUpdate/setProgress");

/** Set update error */
export const setUpdateError = createAction<[error: string]>("autoUpdate/setUpdateError");

/** Set the update channel */
export const setChannel = createAction<[channel: UpdateChannel]>("autoUpdate/setChannel");

/** Show the update toast */
export const showToast = createAction("autoUpdate/showToast");

/** Hide the update toast */
export const hideToast = createAction("autoUpdate/hideToast");

/** Dismiss the "downloaded" toast — records timestamp for 24h cooldown */
export const dismissDownloadedToast = createAction<[dismissedAt: number]>("autoUpdate/dismissDownloadedToast");

/** Menu-triggered: show toast + set checking immediately */
export const showToastChecking = createAction("autoUpdate/showToastChecking");

/** Up-to-date event received */
export const setUpToDate = createAction<[version: string]>("autoUpdate/setUpToDate");

/** Check timed out — set error state */
export const setCheckTimedOut = createAction("autoUpdate/setCheckTimedOut");

// --- Dev-only simulation actions ---
export const simulateSetState = createAction(
  "autoUpdate/simulateSetState",
  (state: Partial<AutoUpdateState>) => state,
);

// --- Trigger-only actions (handled by sagas, not reducers) ---

/** Trigger: check for updates */
export const checkForUpdates = createAction("autoUpdate/checkForUpdates");

/** Trigger: manual check for updates (shows toast) */
export const checkForUpdatesManual = createAction("autoUpdate/checkForUpdatesManual");

/** Trigger: download the available update */
export const downloadUpdate = createAction("autoUpdate/downloadUpdate");

/** Trigger: install the downloaded update */
export const installUpdate = createAction("autoUpdate/installUpdate");

/** Trigger: set the channel via IPC */
export const setChannelIPC = createAction<[channel: UpdateChannel]>("autoUpdate/setChannelIPC");

/** Trigger: initialize auto-update (IPC fetch + subscriptions) */
export const initAutoUpdate = createAction("autoUpdate/initAutoUpdate");

// --- Reducer ---

export const autoUpdateReducer = createReducer<AutoUpdateState>(initialState)
  .with(setUpdateState, (state, { payload: [updateState] }) => ({
    ...state,
    status: updateState.status,
    currentVersion: updateState.currentVersion,
    updateInfo: updateState.updateInfo,
    progress: updateState.progress,
    error: updateState.error,
    channel: updateState.channel,
  }))
  .with(setProgress, (state, { payload: [progress] }) => ({
    ...state,
    progress,
  }))
  .with(setUpdateError, (state, { payload: [error] }) => ({
    ...state,
    status: "error" as const,
    error,
  }))
  .with(setChannel, (state, { payload: [channel] }) => ({
    ...state,
    channel,
  }))
  .with(showToast, (state) => ({
    ...state,
    toastVisible: true,
  }))
  .with(hideToast, (state) => ({
    ...state,
    toastVisible: false,
  }))
  .with(dismissDownloadedToast, (state, { payload: [dismissedAt] }) => ({
    ...state,
    toastVisible: false,
    downloadedToastDismissedAt: dismissedAt,
  }))
  .with(showToastChecking, (state) => ({
    ...state,
    toastVisible: true,
    status: "checking" as const,
  }))
  .with(setUpToDate, (state, { payload: [version] }) => ({
    ...state,
    status: "not-available" as const,
    currentVersion: version || state.currentVersion,
  }))
  .with(setCheckTimedOut, (state) => {
    if (state.status !== "checking") return state;
    return {
      ...state,
      status: "error" as const,
      error: "Update check timed out. Please check your network connection.",
    };
  })
  .with(simulateSetState, (state, action) => ({
    ...state,
    ...action.payload,
  }));