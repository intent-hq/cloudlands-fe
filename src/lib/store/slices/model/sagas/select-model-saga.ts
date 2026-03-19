import { call, put, takeLatest } from "typed-redux-saga";
import { unifiedStateStore } from "$features/agent/services/unified-state-store";
import { createLogger } from "$lib/utils/client-logger";
import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "$lib/store/utils/safe-local-storage-saga";
import { selectActiveProviderId } from "../../provider-settings/provider-settings-selectors";
import {
  normalizeModelForProvider,
  normalizeProviderModels,
} from "../model-selection-utils";
import {
  selectModel,
  setSelectedModel,
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
  const activeProviderId: string = yield* selectActiveProviderId.effect();
  const normalizedModel = normalizeModelForProvider(activeProviderId, model);

  logger.debug("Selecting model:", {
    activeProviderId,
    model: normalizedModel,
  });

  // Update Redux state
  yield* put(
    setSelectedModel({ providerId: activeProviderId, model: normalizedModel })
  );

  // Persist to localStorage
  try {
    yield* call(setLocalStorageItem, GLOBAL_MODEL_KEY, normalizedModel);
  } catch (e) {
    logger.warn("Failed to persist model to localStorage", e);
  }

  // Sync with unified state store
  try {
    unifiedStateStore.selectModel(normalizedModel);
  } catch (e) {
    logger.warn("Failed to sync model with unified state store", e);
  }

  // Remember this model for the current active provider
  try {
    const providerModelsJson = (yield* call(getLocalStorageItem, PROVIDER_MODELS_KEY)) ?? "{}";
    const providerModels = normalizeProviderModels(
      JSON.parse(providerModelsJson) as Record<string, string>
    );
    providerModels[activeProviderId] = normalizedModel;
    yield* call(setLocalStorageItem, PROVIDER_MODELS_KEY, JSON.stringify(providerModels));
    logger.debug("Saved model for provider:", {
      activeProviderId,
      model: normalizedModel,
    });
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
    yield* call(removeLocalStorageItem, WORKSPACE_MODELS_KEY);
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

