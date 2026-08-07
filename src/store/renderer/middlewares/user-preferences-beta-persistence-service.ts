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
 *   - At store init (middleware chain construction), hydrates
 *     betaUpdatesEnabled from autoUpdateClient.getState() so Redux reflects
 *     the actual channel in real mode without waiting for any action
 *
 * Hydration dispatches loadBetaUpdatesSettings (NOT setBetaUpdatesEnabled) so the
 * middleware never re-persists the channel in response to its own hydration — a
 * user toggle is distinguishable from a boot-time sync (intent-hq/monorepo#1672).
 *
 * Dependency-light per src/store/renderer AGENTS.md: imports only slice actions,
 * auto-update client, and safe logger — no selectors.
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import type { StoreState } from "../types";
import {
  loadBetaUpdatesSettings,
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
 * channel. At store init, syncs Redux state with the main-process channel.
 */
export function createUserPreferencesBetaPersistenceMiddleware(): StoreMiddleware {
  return (api) => {
    // Boot-time hydration at store init (Store.init() builds the middleware
    // chain) — unconditional, so real mode never depends on the mock seeder
    // path (live getUserPreferences() returns null per PROTOCOL §5.12) or on
    // a first action being dispatched. The GET_STATE IPC handler answers
    // after AutoUpdateService.initialize() has loaded the persisted channel
    // (see auto-update.ipc.ts), so this read reflects local-prefs.json.
    // Async hydration (fire and forget, errors logged).
    void (async () => {
      try {
        const autoUpdateState = await autoUpdateClient.getState();
        const mainProcessBetaEnabled = autoUpdateState.channel === "beta";
        // Hydrate via loadBetaUpdatesSettings so this middleware does not
        // echo the hydration back into setChannel/local-prefs.json.
        api.dispatch(loadBetaUpdatesSettings(mainProcessBetaEnabled));
      } catch (error) {
        logger.warn("Failed to hydrate betaUpdatesEnabled from main process", { error });
      }
    })();

    return (next) => (action) => {
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
  };
}
