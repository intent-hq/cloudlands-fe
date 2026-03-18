import { call, put, takeLatest } from "typed-redux-saga";
import { unifiedStateStore } from "$features/agent/services/unified-state-store";
import { createLogger } from "$lib/utils/client-logger";
import { selectActiveProviderId } from "../../active-provider/active-provider-selectors";
import {
  selectModel,
  setSelectedModel,
  setProviderModel,
  resetToDefaults,
  clearAllWorkspaceModels,
  GLOBAL_MODEL_KEY,
  PROVIDER_MODELS_KEY,
  WORKSPACE_MODELS_KEY,
} from "../model-slice";
import { MODEL_DEFAULTS } from "$shared/constants/agent-services";

const logger = createLogger("SelectModelSaga");

/**
 * Handle selecting a model: update state, persist, sync with unified store,
 * and remember per-provider preference.
 */
export function* handleSelectModel(action: ReturnType<typeof selectModel>) {
  const [model] = action.payload;
  logger.debug("Selecting model:", { model });

  // Update Redux state
  yield* put(setSelectedModel(model));

  // Persist to localStorage
  try {
    yield* call(
      [localStorage, localStorage.setItem],
      GLOBAL_MODEL_KEY,
      model
    );
  } catch (e) {
    logger.warn("Failed to persist model to localStorage", e);
  }

  // Sync with unified state store
  try {
    unifiedStateStore.selectModel(model);
  } catch (e) {
    logger.warn("Failed to sync model with unified state store", e);
  }

  // Remember this model for the current active provider
  try {
    const activeProviderId: string = yield* selectActiveProviderId.effect();
    yield* put(setProviderModel({ providerId: activeProviderId, model }));

    // Persist provider models
    const providerModelsJson: string = yield* call(() => {
      try {
        return localStorage.getItem(PROVIDER_MODELS_KEY) || "{}";
      } catch {
        return "{}";
      }
    });
    const providerModels = JSON.parse(providerModelsJson);
    providerModels[activeProviderId] = model;
    yield* call(
      [localStorage, localStorage.setItem],
      PROVIDER_MODELS_KEY,
      JSON.stringify(providerModels)
    );
    logger.debug("Saved model for provider:", { activeProviderId, model });
  } catch (e) {
    logger.warn("Failed to save model for provider", e);
  }
}

/**
 * Handle reset to defaults: select default model and clear workspace overrides.
 */
function* handleResetToDefaults() {
  logger.info("Resetting model selections to defaults");
  yield* put(selectModel(MODEL_DEFAULTS.UI_INITIAL_MODEL));

  // Clear per-workspace overrides
  yield* put(clearAllWorkspaceModels());
  try {
    yield* call([localStorage, localStorage.removeItem], WORKSPACE_MODELS_KEY);
  } catch (error) {
    logger.warn("Failed to clear workspace model storage", error);
  }
}

/**
 * Select model saga:
 * - Watches for selectModel actions to persist + sync
 * - Watches for resetToDefaults actions
 */
export function* selectModelSaga() {
  yield* takeLatest(selectModel, handleSelectModel);
  yield* takeLatest(resetToDefaults, handleResetToDefaults);
}

