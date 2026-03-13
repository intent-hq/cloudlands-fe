import { call, delay, takeLatest } from "typed-redux-saga";
import {
  setNotificationEnabled,
  setSoundEnabled,
  setSoundOnlyWhenUnfocused,
  setVolume,
  resetNotificationSettings,
} from "../notification-settings-slice";
import {
  selectNotificationEnabled,
  selectSoundEnabled,
  selectSoundOnlyWhenUnfocused,
  selectNotificationVolume,
} from "../notification-settings-selectors";

const STORAGE_KEY = "notificationSettings";

async function persistToIPC(settings: {
  enabled: boolean;
  soundEnabled: boolean;
  soundOnlyWhenUnfocused: boolean;
  volume: number;
}): Promise<void> {
  try {
    if (typeof window !== "undefined" && window.electronAPI) {
      await window.electronAPI.invoke("settings:set", {
        key: STORAGE_KEY,
        value: settings,
      });
    }
  } catch {
    // Ignore save errors
  }
}

/**
 * Watches for any notification setting change and persists via IPC.
 */
export function* persistenceSaga() {
  yield* takeLatest(
    [
      setNotificationEnabled.type,
      setSoundEnabled.type,
      setSoundOnlyWhenUnfocused.type,
      setVolume.type,
      resetNotificationSettings.type,
    ],
    function* () {
      yield* delay(100);
      const enabled = yield* selectNotificationEnabled.effect();
      const soundEnabled = yield* selectSoundEnabled.effect();
      const soundOnlyWhenUnfocused = yield* selectSoundOnlyWhenUnfocused.effect();
      const volume = yield* selectNotificationVolume.effect();
      yield* call(persistToIPC, { enabled, soundEnabled, soundOnlyWhenUnfocused, volume });
    }
  );
}

