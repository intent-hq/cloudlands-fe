import { call, takeLatest } from "typed-redux-saga";
import {
  setBetaUpdatesEnabled,
  toggleBetaUpdates,
} from "../beta-updates-slice";
import { selectBetaUpdatesEnabled } from "../beta-updates-selectors";
import { applyChannel } from "./apply-channel";

const STORAGE_KEY = "betaUpdatesEnabled";

async function persistToIPC(enabled: boolean): Promise<void> {
  try {
    if (typeof window !== "undefined" && window.electronAPI) {
      await window.electronAPI.invoke("settings:set", {
        key: STORAGE_KEY,
        value: enabled,
      });
    }
  } catch {
    // Ignore save errors
  }
}

/**
 * Watches for beta updates setting changes, persists via IPC, and applies the channel.
 */
export function* persistenceSaga() {
  yield* takeLatest(
    [
      setBetaUpdatesEnabled.type,
      toggleBetaUpdates.type,
    ],
    function* () {
      const enabled = yield* selectBetaUpdatesEnabled.effect();
      yield* call(persistToIPC, enabled);
      yield* call(applyChannel, enabled);
    }
  );
}

