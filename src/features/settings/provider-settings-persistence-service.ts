/**
 * Provider-settings persistence service — the write half of the
 * provider-settings path (the read half is `settings-hydration-service`,
 * which routes the daemon's `providers.active` / `providers.enabled` into the
 * provider-settings slice on boot and on `settings:changed`).
 *
 * Post-saga gap: the `setActiveProvider` trigger (ProviderSelector "Set as
 * default", provider-switch flows) lost its saga handler, so picking a
 * provider updated the local slice but nothing wrote it back to the daemon.
 * Every restart therefore reverted to whatever `providers.active` the daemon
 * still had persisted. This restores the write path WITHOUT changing any
 * dispatch site: after the reducer runs, the middleware forwards the pick to
 * `appClient.settings.setProviderSettings` (which resolves to
 * `settings.update { changes: [{ path: "providers.active", value }] }`,
 * PROTOCOL §5.12) so the hydration middleware picks it up on next boot.
 *
 * The enabled-providers toggles (`toggleProvider` from
 * AdditionalAgentsSettings, `setProviderEnabled` from
 * settings-proposal-actions) had the same gap: the local slice updated but
 * nothing wrote `providers.enabled` back, so a reload rehydrated the stale
 * daemon map and reverted the toggle. After the reducer runs, the middleware
 * reads the post-reducer `enabledProviders` map off `appStore.state` and —
 * only when the reducer actually changed it (e.g. not for
 * `canBeDisabled: false` no-ops) — persists the full map via
 * `settings.update { changes: [{ path: "providers.enabled", value }] }`.
 *
 * Persistence is fire-and-forget; the daemon echoes it back via
 * `settings:changed`, and hydration reapplies it through
 * `hydrateActiveProvider` / `loadEnabledProvidersFromStorage` — deliberately
 * NOT observed here, so there is no write loop.
 *
 * Dependency-light per src/store/renderer/AGENTS.md: imports only the
 * AppClient seam, the configured store, the slice trigger actions, and the
 * logger (no selectors — mirrors `agent-mutation-service.ts`).
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import { appClient } from "$lib/client";
import { createLogger } from "$lib/utils/client-logger";
import { store as appStore } from "$store/renderer/store";
import {
  setActiveProvider,
  setProviderEnabled,
  toggleProvider,
} from "$store/renderer/slices/provider-settings/provider-settings-slice";

const logger = createLogger("ProviderSettingsPersistenceService");

/** Direct one-time read of the post-reducer map, dependency-light (no selector import). */
function readEnabledProviders(): Record<string, boolean> | undefined {
  const state = appStore.state as {
    providerSettings?: { enabledProviders: Record<string, boolean> };
  };
  return state.providerSettings?.enabledProviders;
}

export function createProviderSettingsPersistenceMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const isEnabledMutation =
      action &&
      (action.type === toggleProvider.type ||
        action.type === setProviderEnabled.type);
    const before = isEnabledMutation ? readEnabledProviders() : undefined;
    const result = next(action);
    if (action && action.type === setActiveProvider.type) {
      const payload = Array.isArray(action.payload) ? action.payload : [];
      const providerId = payload[0];
      if (typeof providerId === "string" && providerId.length > 0) {
        void appClient.settings
          .setProviderSettings({ activeProviderId: providerId })
          .then((mutation) => {
            if (!mutation.success) {
              logger.error("Failed to persist active provider", {
                error: mutation.error,
              });
            }
          })
          .catch((error) =>
            logger.error("Failed to persist active provider", { error }),
          );
      }
    }
    if (isEnabledMutation) {
      const enabledProviders = readEnabledProviders();
      if (enabledProviders && enabledProviders !== before) {
        void appClient.settings
          .setProviderSettings({ enabledProviders })
          .then((mutation) => {
            if (!mutation.success) {
              logger.error("Failed to persist enabled providers", {
                error: mutation.error,
              });
            }
          })
          .catch((error) =>
            logger.error("Failed to persist enabled providers", { error }),
          );
      }
    }
    return result;
  };
}
