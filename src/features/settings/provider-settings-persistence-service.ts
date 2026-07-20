/**
 * Provider-settings persistence service — the write half of the active-provider
 * path (the read half is `settings-hydration-service`, which routes the
 * daemon's `providers.active` into the provider-settings slice on boot and on
 * `settings:changed`).
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
 * Persistence is fire-and-forget; the daemon echoes it back via
 * `settings:changed`, and hydration reapplies it through
 * `hydrateActiveProvider` — deliberately NOT observed here, so there is no
 * write loop.
 *
 * Dependency-light per src/store/renderer/AGENTS.md: imports only the
 * AppClient seam, the slice trigger action, and the logger (no selectors —
 * the value is on the action payload).
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import { appClient } from "$lib/client";
import { createLogger } from "$lib/utils/client-logger";
import { setActiveProvider } from "$store/renderer/slices/provider-settings/provider-settings-slice";

const logger = createLogger("ProviderSettingsPersistenceService");

export function createProviderSettingsPersistenceMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
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
    return result;
  };
}
