import { call } from "typed-redux-saga";
import { invoke } from "$shared/generated/ipc-client";
import { emptyWorkspaceSettings } from "../workspace-settings-slice";
import { SETTINGS_CHANNELS } from "$shared/ipc/channels";

let _globalAutoCommitDefault = emptyWorkspaceSettings.autoCommitEnabled;

export function getGlobalAutoCommitDefault(): boolean {
  return _globalAutoCommitDefault;
}

async function loadFromIPC(): Promise<boolean> {
  try {
    if (typeof window !== "undefined" && window.electronAPI) {
      const result = await invoke<{ data?: { autoCommit?: boolean } }>(SETTINGS_CHANNELS.GET_ALL, undefined);
      const settings = (result && result.data) || {};
      return settings.autoCommit !== false;
    }
  } catch {
    // Ignore load errors, fall back to default
  }
  return emptyWorkspaceSettings.autoCommitEnabled;
}

/**
 * Loads the global autoCommit default from IPC on startup.
 * Individual workspaces get their settings loaded when synced.
 */
export function* initSaga() {
  _globalAutoCommitDefault = yield* call(loadFromIPC);
}

