/**
 * Model-selection persistence service — the write half of the default-model
 * path (the read half is `settings-hydration-service`, which routes the
 * daemon's `model.providerDefaults` into the model slice on boot and on
 * `settings:changed`).
 *
 * Two post-saga gaps are re-homed here without changing any dispatch site:
 *
 * 1. The `selectModel` trigger (ModelPicker global pick, settings proposals)
 *    lost its saga handler, so picking a model outside a workspace updated
 *    nothing. The middleware maps it to `setSelectedModel` for the active
 *    provider — the same translation the deleted saga performed.
 * 2. Nothing persisted the selection, so every pick was lost on reload. After
 *    the reducer runs, the middleware writes the authoritative slice state to
 *    the daemon settings catalog (PROTOCOL §5.12): `model.providerDefaults`
 *    on per-provider picks. Writes are fire-and-forget; the daemon echoes
 *    them back via `settings:changed`, which hydration applies through the
 *    `loadProviderModelsFromStorage` action — deliberately NOT observed
 *    here, so there is no write loop.
 *
 * Dependency-light per src/store/renderer/AGENTS.md: imports only the
 * AppClient seam, the configured store, model-slice actions, and the logger
 * (no selectors — state is read directly off `appStore.state`).
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import { createLogger } from "$lib/utils/client-logger";
import {
  reloadModelsForProvider,
  selectModel,
  setDefaultReasoningEffort,
  setSelectedModel,
} from "$store/renderer/slices/model/model-slice";
import { setActiveProvider } from "$store/renderer/slices/provider-settings/provider-settings-slice";
import { getItem } from "$lib/store-shim/utils/collections/collection-utils";
import { splitCompoundModelId } from "$shared/utils/compound-model-id";

const logger = createLogger("ModelSelectionPersistenceService");

/** Persist one settings path (fire-and-forget; failures only log). */
function persist(path: string, value: unknown): void {
  void appClient.settings
    .update([{ path, value }])
    .catch((error) => logger.error(`Failed to persist ${path}`, { error }));
}

export function createModelSelectionPersistenceMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (action && typeof action.type === "string") {
      const payload = Array.isArray(action.payload) ? action.payload : [];
      switch (action.type) {
        case selectModel.type: {
          // Trigger → concrete per-provider selection. Compound ids carry
          // their provider (`opencode:model`); bare ids — and malformed ids
          // with an empty prefix (`:model`) — fall back to the active
          // provider. The re-dispatched setSelectedModel comes back through
          // this middleware, which is where the persistence write happens.
          const model = payload[0];
          if (typeof model === "string" && model.length > 0) {
            const compoundProviderId = model.includes(":")
              ? (splitCompoundModelId(model).providerId ?? "")
              : "";
            const activeProviderId =
              appStore.state.providerSettings.activeProviderId;
            const providerId =
              compoundProviderId.length > 0
                ? compoundProviderId
                : activeProviderId;
            // A cross-provider compound pick is an explicit provider choice:
            // switch the active provider too, so downstream resolution
            // (resolveOnboardingModel, provider persistence) sees it. The
            // re-dispatched setActiveProvider is persisted to
            // `providers.active` (PROTOCOL §5.12) by the provider-settings
            // persistence middleware, and reloadModelsForProvider refetches
            // the daemon catalog for the new provider (clearing the previous
            // provider's `availableModels` up front) — matching every other
            // setActiveProvider call site. The switch is gated on a known
            // provider id so a malformed compound prefix cannot flip
            // `activeProviderId` globally.
            if (
              compoundProviderId.length > 0 &&
              compoundProviderId !== activeProviderId &&
              getItem(appStore.state.providerCatalog.providers, compoundProviderId) !== undefined
            ) {
              appStore.dispatch(setActiveProvider(compoundProviderId));
              appStore.dispatch(reloadModelsForProvider());
            }
            appStore.dispatch(setSelectedModel({ providerId, model }));
          }
          break;
        }
        case setSelectedModel.type:
          persist("model.providerDefaults", appStore.state.model.providerModels);
          break;
        case setDefaultReasoningEffort.type:
          persist(
            "model.defaultReasoningEffort",
            appStore.state.model.defaultReasoningEffort,
          );
          break;
      }
    }
    return result;
  };
}
