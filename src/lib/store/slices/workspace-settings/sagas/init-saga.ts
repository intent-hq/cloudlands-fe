import { call, put } from "typed-redux-saga";
import { loadAutoCommitSettings, initialState } from "../workspace-settings-slice";
import { SETTINGS_CHANNELS } from "$shared/ipc/channels";

async function loadFromIPC(): Promise<boolean> {
  try {
    if (typeof window !== "undefined" && window.electronAPI) {
      const result = await window.electronAPI.invoke(SETTINGS_CHANNELS.GET_ALL, undefined);
      const settings = (result && result.data) || {};
      return settings.autoCommit !== false;
    }
  } catch {
    // Ignore load errors, fall back to default
  }
  return initialState.autoCommitEnabled;
}

/**
 * Loads workspace settings from IPC on startup.
 * Dispatches loadAutoCommitSettings (not setAutoCommitEnabled) so the
 * persistence saga does not trigger on init.
 */
export function* initSaga() {
  const autoCommitEnabled: boolean = yield* call(loadFromIPC);
  yield* put(loadAutoCommitSettings(autoCommitEnabled));
}

