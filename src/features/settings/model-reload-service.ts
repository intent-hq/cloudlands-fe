/**
 * Model-reload service — the handler behind the `reloadModelsForProvider`
 * trigger (`ProviderSelector` "Set as default", post-auth flows).
 *
 * Post-saga gap: `reloadModelsForProvider` used to be handled by the model
 * persistence saga (`handleReloadModelsForProvider`), which cleared workspace
 * overrides, cleared the loading state, cleared the available model list, and
 * kicked off a fresh `loadModels`. When the saga runtime was removed the
 * trigger became a no-op, so switching providers left the picker showing the
 * previous provider's models until the next full reload.
 *
 * This restores the refresh path WITHOUT re-adding a saga and WITHOUT changing
 * any dispatch site: after the reducer runs the middleware calls
 * `appClient.models.list()` (daemon-backed `models.list`, PROTOCOL §5.30)
 * for the active provider and dispatches the loading → success/error
 * transitions that keep `ModelState.loadingState` and `availableModels` in sync
 * with the reference `handleLoadModels` semantics: a `loading` state upfront,
 * `success` with the fetched catalog on non-empty results, `error` on empty
 * results or transport failures so `ModelPicker` renders the fallback UI.
 *
 * Dependency-light per src/store/renderer/AGENTS.md: imports only the
 * AppClient seam, the configured store, model-slice actions, and the logger
 * (no selectors — the active provider is read directly off `appStore.state`).
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import { createLogger } from "$lib/utils/client-logger";
import {
  reloadModelsForProvider,
  setAvailableModels,
  setLoadingStateForProvider,
} from "$store/renderer/slices/model/model-slice";

const logger = createLogger("ModelReloadService");

/** Fetch the daemon catalog for the active provider and drive the loading transitions. */
async function reloadForActiveProvider(): Promise<void> {
  const providerId = appStore.state.providerSettings.activeProviderId;
  if (typeof providerId !== "string" || providerId.length === 0) return;

  appStore.dispatch(
    setLoadingStateForProvider({ providerId, status: "loading" }),
  );
  // Clear the previous catalog so the picker never renders stale rows for the
  // new provider between the trigger and the fetch resolving.
  appStore.dispatch(setAvailableModels([]));

  try {
    const models = await appClient.models.list();
    if (models.length === 0) {
      appStore.dispatch(
        setLoadingStateForProvider({
          providerId,
          status: "error",
          error: `No models available for ${providerId}. Please try again.`,
        }),
      );
      return;
    }
    appStore.dispatch(setAvailableModels(models));
    appStore.dispatch(
      setLoadingStateForProvider({
        providerId,
        status: "success",
        retryAttempt: 0,
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error && error.message ? error.message : "Failed to load models";
    logger.error("reloadModelsForProvider failed", { providerId, error });
    appStore.dispatch(
      setLoadingStateForProvider({ providerId, status: "error", error: message }),
    );
  }
}

export function createModelReloadMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    const result = next(action);
    if (action && action.type === reloadModelsForProvider.type) {
      void reloadForActiveProvider();
    }
    return result;
  };
}
