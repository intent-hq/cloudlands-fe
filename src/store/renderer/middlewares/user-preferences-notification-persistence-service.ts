/**
 * User-preferences notification-settings persistence service — restores the
 * notification settings daemon persistence that the removed
 * `user-preferences/sagas/persistence-saga` → `watchNotificationSettingsPersistence`
 * performed. With no saga listening, setNotificationEnabled/setSoundEnabled/
 * setSoundOnlyWhenUnfocused/setVolume/resetNotificationSettings dispatched from
 * settings UI has NO EFFECT — settings are not persisted and reset every session.
 *
 * This middleware reconnects the path WITHOUT re-adding a saga and WITHOUT
 * changing any call site:
 *   - Watches notification actions (setNotificationEnabled, setSoundEnabled, etc.)
 *   - Persists to daemon settings catalog via settings.update on the four per-field
 *     notifications.* paths (notifications.enabled, notifications.soundEnabled,
 *     notifications.soundOnlyWhenUnfocused, notifications.volume)
 *   - Debounces via setTimeout (100ms delay like the saga did)
 *   - On first action, hydrates the Redux slice from daemon settings in real mode
 *
 * The daemon settings catalog (PROTOCOL §5.12) is the canonical store;
 * notification.service.ts reads notifications.enabled from there. The legacy
 * "notificationSettings" electron-store bag is retired.
 *
 * Dependency-light per src/store/renderer AGENTS.md: imports only backend transport,
 * slice actions, and safe logger — no selectors.
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { backendRequest } from "$lib/client/live/backend-transport";
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

/** Daemon setting paths for notification preferences (PROTOCOL §5.12). */
const NOTIFICATION_PATHS = {
  enabled: "notifications.enabled",
  soundEnabled: "notifications.soundEnabled",
  soundOnlyWhenUnfocused: "notifications.soundOnlyWhenUnfocused",
  volume: "notifications.volume",
} as const;

type NotificationSettingsState = {
  enabled: boolean;
  soundEnabled: boolean;
  soundOnlyWhenUnfocused: boolean;
  volume: number;
};

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let isDispatchingHydration = false;

/**
 * Persist notification settings to daemon via settings.update (per-field).
 */
async function persistNotificationSettings(settings: NotificationSettingsState): Promise<void> {
  try {
    await backendRequest("settings.update", {
      changes: [
        { path: NOTIFICATION_PATHS.enabled, value: settings.enabled },
        { path: NOTIFICATION_PATHS.soundEnabled, value: settings.soundEnabled },
        { path: NOTIFICATION_PATHS.soundOnlyWhenUnfocused, value: settings.soundOnlyWhenUnfocused },
        { path: NOTIFICATION_PATHS.volume, value: settings.volume },
      ],
    });
  } catch (error) {
    logger.warn("Failed to persist notification settings to daemon", { settings, error });
  }
}

/**
 * Hydrate notification settings from daemon on boot (real mode).
 */
async function hydrateFromDaemon(dispatch: (action: unknown) => void): Promise<void> {
  try {
    // Fetch all four notification paths from daemon
    const [enabled, soundEnabled, soundOnlyWhenUnfocused, volume] = await Promise.all([
      backendRequest("settings.get", { path: NOTIFICATION_PATHS.enabled }),
      backendRequest("settings.get", { path: NOTIFICATION_PATHS.soundEnabled }),
      backendRequest("settings.get", { path: NOTIFICATION_PATHS.soundOnlyWhenUnfocused }),
      backendRequest("settings.get", { path: NOTIFICATION_PATHS.volume }),
    ]);

    // Dispatch actions to sync Redux with daemon values
    // Set flag to suppress persistence echo-write for these dispatches
    isDispatchingHydration = true;
    try {
      if (typeof (enabled as { value?: unknown })?.value === "boolean") {
        dispatch(setNotificationEnabled((enabled as { value: boolean }).value));
      }
      if (typeof (soundEnabled as { value?: unknown })?.value === "boolean") {
        dispatch(setSoundEnabled((soundEnabled as { value: boolean }).value));
      }
      if (typeof (soundOnlyWhenUnfocused as { value?: unknown })?.value === "boolean") {
        dispatch(setSoundOnlyWhenUnfocused((soundOnlyWhenUnfocused as { value: boolean }).value));
      }
      if (typeof (volume as { value?: unknown })?.value === "number") {
        dispatch(setVolume((volume as { value: number }).value));
      }
    } finally {
      isDispatchingHydration = false;
    }
  } catch (error) {
    logger.warn("Failed to hydrate notification settings from daemon", { error });
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
 * Middleware giving notification-settings persistence real handlers again, plus
 * real-mode boot hydration. Watches notification actions and persists via daemon
 * settings.update with 100ms debounce. On first action, syncs Redux state with
 * daemon-backed settings.
 */
export function createUserPreferencesNotificationPersistenceMiddleware(): StoreMiddleware {
  let hasHydrated = false;

  return (api) => (next) => (action) => {
    // Boot-time hydration on first action (real mode only — mock seeder handles it)
    if (!hasHydrated) {
      hasHydrated = true;
      // Async hydration (fire and forget, errors logged)
      void hydrateFromDaemon(api.dispatch);
    }

    const result = next(action);
    // Skip persistence for hydration-dispatched actions to avoid echo-writes
    if (action && NOTIFICATION_ACTIONS.has(action.type) && !isDispatchingHydration) {
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
