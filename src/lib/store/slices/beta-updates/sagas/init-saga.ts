import { call, put } from "typed-redux-saga";
import { loadBetaUpdatesSettings } from "../beta-updates-slice";
import { applyChannel } from "./apply-channel";

const STORAGE_KEY = "betaUpdatesEnabled";

async function loadFromIPC(): Promise<boolean | null> {
  try {
    if (typeof window !== "undefined" && window.electronAPI) {
      const result = await window.electronAPI.invoke("settings:get", { key: STORAGE_KEY });
      if (result?.success && typeof result.data === "boolean") {
        return result.data;
      }
    }
  } catch {
    // Ignore load errors
  }
  return null;
}

/**
 * Loads beta updates setting from IPC on startup and applies the channel.
 */
export function* initSaga() {
  const enabled: boolean | null = yield* call(loadFromIPC);
  if (enabled !== null) {
    yield* put(loadBetaUpdatesSettings(enabled));
  }
  // Apply channel on startup (use loaded value or default false)
  yield* call(applyChannel, enabled ?? false);
}

