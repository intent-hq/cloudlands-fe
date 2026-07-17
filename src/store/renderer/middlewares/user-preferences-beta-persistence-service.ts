/**
 * User-preferences beta-updates persistence service — restores the beta updates
 * toggle channel switch + real-mode boot hydration that the removed
 * `user-preferences/sagas/persistence-saga` → `watchBetaUpdatesPersistence`
 * performed. With no saga listening, setBetaUpdatesEnabled/toggleBetaUpdates
 * dispatched from settings UI has NO EFFECT — the setting is not persisted and
 * the update channel is not switched, so user cannot toggle between stable/beta.
 *
 * This middleware reconnects the path WITHOUT re-adding a saga and WITHOUT
 * changing any call site:
 *   - Watches setBetaUpdatesEnabled and toggleBetaUpdates actions
 *   - Calls autoUpdateClient.setChannel(enabled ? "beta" : "stable")
 *     (which persists via local-prefs internally)
 *   - On first action, hydrates betaUpdatesEnabled from autoUpdateClient.getState()
 *     to ensure Redux reflects the actual channel in real mode
 *
 * Dependency-light per src/store/renderer AGENTS.md: imports only slice actions,
 * auto-update client, and safe logger — no selectors.
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import type { StoreState } from "../types";
import {
  setBetaUpdatesEnabled,
  toggleBetaUpdates,
} from "../slices/user-preferences/user-preferences-slice";
import { autoUpdateClient } from "$features/auto-update/auto-update.client";
import type { UpdateChannel } from "$features/auto-update/types";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("UserPreferencesBetaPersistenceService");

/**
 * Apply update channel (persistence handled inside autoUpdateClient.setChannel).
 */
async function applyUpdateChannel(enabled: boolean): Promise<void> {
  try {
    const channel: UpdateChannel = enabled ? "beta" : "stable";
    await autoUpdateClient.setChannel(channel);
  } catch (error) {
    logger.warn("Failed to apply update channel", { enabled, error });
  }
}

/**
 * Middleware giving beta-updates persistence real handlers again, plus real-mode
 * boot hydration. Watches setBetaUpdatesEnabled/toggleBetaUpdates and switches
 * channel. On first action, syncs Redux state with main-process channel.
 */
export function createUserPreferencesBetaPersistenceMiddleware(): StoreMiddleware {
  let hasHydrated = false;

  return (api) => (next) => (action) => {
    // Boot-time hydration on first action (real mode only — mock seeder handles it)
    if (!hasHydrated) {
      hasHydrated = true;
      // Async hydration (fire and forget, errors logged)
      void (async () => {
        try {
          const autoUpdateState = await autoUpdateClient.getState();
          const mainProcessBetaEnabled = autoUpdateState.channel === "beta";
          api.dispatch(setBetaUpdatesEnabled(mainProcessBetaEnabled));
        } catch (error) {
          logger.warn("Failed to hydrate betaUpdatesEnabled from main process", { error });
        }
      })();
    }

    const result = next(action);
    if (
      action &&
      (action.type === setBetaUpdatesEnabled.type || action.type === toggleBetaUpdates.type)
    ) {
      // Read the updated state after reducer ran
      const state = api.getState() as StoreState;
      const enabled = state.userPreferences.betaUpdatesEnabled ?? false;
      // Async channel switch (fire and forget, errors logged)
      void applyUpdateChannel(enabled);
    }
    return result;
  };
}
