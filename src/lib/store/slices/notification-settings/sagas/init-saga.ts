import { call, put } from "typed-redux-saga";
import {
  setNotificationEnabled,
  setSoundEnabled,
  setSoundOnlyWhenUnfocused,
  setVolume,
  type NotificationSettingsState,
  initialState,
} from "../notification-settings-slice";

const STORAGE_KEY = "notificationSettings";

async function loadFromIPC(): Promise<NotificationSettingsState | null> {
  try {
    if (typeof window !== "undefined" && window.electronAPI) {
      const result = await window.electronAPI.invoke("settings:get", { key: STORAGE_KEY });
      if (result?.success && result.data) {
        return result.data as NotificationSettingsState;
      }
    }
  } catch {
    // Ignore load errors
  }
  return null;
}

/**
 * Loads notification settings from IPC on startup.
 */
export function* initSaga() {
  const settings: NotificationSettingsState | null = yield* call(loadFromIPC);
  if (settings) {
    yield* put(setNotificationEnabled(settings.enabled ?? initialState.enabled));
    yield* put(setSoundEnabled(settings.soundEnabled ?? initialState.soundEnabled));
    yield* put(setSoundOnlyWhenUnfocused(settings.soundOnlyWhenUnfocused ?? initialState.soundOnlyWhenUnfocused));
    yield* put(setVolume(settings.volume ?? initialState.volume));
  }
}

