/**
 * User-preferences notification-settings persistence service — restores the
 * notification settings IPC persistence that the removed
 * `user-preferences/sagas/persistence-saga` → `watchNotificationSettingsPersistence`
 * performed. With no saga listening, setNotificationEnabled/setSoundEnabled/
 * setSoundOnlyWhenUnfocused/setVolume/resetNotificationSettings dispatched from
 * settings UI has NO EFFECT — settings are not persisted and reset every session.
 *
 * This middleware reconnects the path WITHOUT re-adding a saga and WITHOUT
 * changing any call site:
 *   - Watches notification actions (setNotificationEnabled, setSoundEnabled, etc.)
 *   - Invokes settings:set with {key:"notificationSettings", value:{enabled,soundEnabled,...}}
 *   - Debounces via setTimeout (100ms delay like the saga did)
 *
 * Storage key "notificationSettings" matches the deleted saga so existing users'
 * stored values are honored.
 *
 * Dependency-light per src/store/renderer AGENTS.md: imports only IPC client,
 * slice actions, and safe logger — no selectors.
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { invoke } from "$shared/generated/ipc-client";
import type { StoreState } from "../types";
import {
  setNotificationEnabled,
  setSoundEnabled,
  setSoundOnlyWhenUnfocused,
  setVolume,
  resetNotificationSettings,
} from "../slices/user-preferences/user-preferences-slice";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("UserPreferencesNotificationPersistenceService");
const NOTIFICATION_STORAGE_KEY = "notificationSettings";

type NotificationSettingsState = {
  enabled: boolean;
  soundEnabled: boolean;
  soundOnlyWhenUnfocused: boolean;
  volume: number;
};

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Persist notification settings to IPC.
 */
async function persistNotificationSettings(settings: NotificationSettingsState): Promise<void> {
  try {
    if (typeof window !== "undefined" && window.electronAPI) {
      await invoke("settings:set", {
        key: NOTIFICATION_STORAGE_KEY,
        value: settings,
      });
    }
  } catch (error) {
    logger.warn("Failed to persist notification settings", { settings, error });
  }
}

const NOTIFICATION_ACTIONS = new Set<string>([
  setNotificationEnabled.type,
  setSoundEnabled.type,
  setSoundOnlyWhenUnfocused.type,
  setVolume.type,
  resetNotificationSettings.type,
]);

/**
 * Middleware giving notification-settings persistence real handlers again.
 * Watches notification actions and persists via IPC with 100ms debounce.
 */
export function createUserPreferencesNotificationPersistenceMiddleware(): StoreMiddleware {
  return (api) => (next) => (action) => {
    const result = next(action);
    if (action && NOTIFICATION_ACTIONS.has(action.type)) {
      // Debounce persistence (100ms delay like the saga did)
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        // Read the updated state after reducer ran
        const state = api.getState() as StoreState;
        const { enabled, soundEnabled, soundOnlyWhenUnfocused, volume } = state.userPreferences;
        const settings: NotificationSettingsState = {
          enabled: enabled ?? true,
          soundEnabled: soundEnabled ?? true,
          soundOnlyWhenUnfocused: soundOnlyWhenUnfocused ?? false,
          volume: volume ?? 0.5,
        };
        // Async persist (fire and forget, errors logged)
        void persistNotificationSettings(settings);
      }, 100);
    }
    return result;
  };
}
