/**
 * User-preferences beta-updates persistence service — restores the beta updates
 * toggle IPC persistence + channel switch that the removed
 * `user-preferences/sagas/persistence-saga` → `watchBetaUpdatesPersistence`
 * performed. With no saga listening, setBetaUpdatesEnabled/toggleBetaUpdates
 * dispatched from settings UI has NO EFFECT — the setting is not persisted and
 * the update channel is not switched, so user cannot toggle between stable/beta.
 *
 * This middleware reconnects the path WITHOUT re-adding a saga and WITHOUT
 * changing any call site:
 *   - Watches setBetaUpdatesEnabled and toggleBetaUpdates actions
 *   - Invokes settings:set with {key:"betaUpdatesEnabled", value}
 *   - Calls autoUpdateClient.setChannel(enabled ? "beta" : "stable")
 *
 * Storage key "betaUpdatesEnabled" matches the deleted saga so existing users'
 * stored values are honored.
 *
 * Dependency-light per src/store/renderer AGENTS.md: imports only IPC client,
 * slice actions, auto-update client, and safe logger — no selectors.
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { invoke } from "$shared/generated/ipc-client";
import type { StoreState } from "../types";
import {
  setBetaUpdatesEnabled,
  toggleBetaUpdates,
} from "../slices/user-preferences/user-preferences-slice";
import { autoUpdateClient } from "$features/auto-update/auto-update.client";
import type { UpdateChannel } from "$features/auto-update/types";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("UserPreferencesBetaPersistenceService");
const BETA_UPDATES_STORAGE_KEY = "betaUpdatesEnabled";

/**
 * Persist beta updates setting to IPC and apply update channel.
 */
async function persistBetaUpdates(enabled: boolean): Promise<void> {
  // Persist to electron-store
  try {
    if (typeof window !== "undefined" && window.electronAPI) {
      await invoke("settings:set", {
        key: BETA_UPDATES_STORAGE_KEY,
        value: enabled,
      });
    }
  } catch (error) {
    logger.warn("Failed to persist betaUpdatesEnabled", { enabled, error });
  }

  // Apply update channel
  try {
    const channel: UpdateChannel = enabled ? "beta" : "stable";
    await autoUpdateClient.setChannel(channel);
  } catch (error) {
    logger.warn("Failed to apply update channel", { enabled, error });
  }
}

/**
 * Middleware giving beta-updates persistence real handlers again.
 * Watches setBetaUpdatesEnabled/toggleBetaUpdates and persists + switches channel.
 */
export function createUserPreferencesBetaPersistenceMiddleware(): StoreMiddleware {
  return (api) => (next) => (action) => {
    const result = next(action);
    if (
      action &&
      (action.type === setBetaUpdatesEnabled.type || action.type === toggleBetaUpdates.type)
    ) {
      // Read the updated state after reducer ran
      const state = api.getState() as StoreState;
      const enabled = state.userPreferences.betaUpdatesEnabled ?? false;
      // Async persist (fire and forget, errors logged)
      void persistBetaUpdates(enabled);
    }
    return result;
  };
}
