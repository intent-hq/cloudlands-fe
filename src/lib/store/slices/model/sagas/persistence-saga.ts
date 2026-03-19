import { call, put, takeLatest } from "typed-redux-saga";
import { unifiedStateStore } from "$features/agent/services/unified-state-store";
import { createLogger } from "$lib/utils/client-logger";
import { getItems } from "$lib/store/utils/collection-utils";
import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "$lib/store/utils/safe-local-storage-saga";
import { MODEL_DEFAULTS } from "$shared/constants/agent-services";
import { selectActiveProviderId } from "../../provider-settings/provider-settings-selectors";
import {
  selectAvailableModelsCollection,
  selectProviderModels,
  selectWorkspaceModels,
} from "../model-selectors";
import {
  normalizeModelForProvider,
  normalizeProviderModels,
} from "../model-selection-utils";
import {
  loadModels,
  reloadModelsForProvider,
  setSelectedModel,
  clearAllWorkspaceModels,
  clearLoadingStateForProvider,
  setWorkspaceModel,
  setAvailableModels,
  clearWorkspaceModel,
  loadWorkspaceModelsFromStorage,
  loadProviderModelsFromStorage,
  GLOBAL_MODEL_KEY,
  WORKSPACE_MODELS_KEY,
  PROVIDER_MODELS_KEY,
} from "../model-slice";

const logger = createLogger("PersistenceSaga");

function parseStoredModels(stored: string | null): Record<string, string> {
  if (!stored) {
    return {};
  }

  return JSON.parse(stored) as Record<string, string>;
}

/**
 * Init saga: load from localStorage and trigger initial model load.
 */
export function* initPersistenceSaga() {
  if (typeof window === "undefined") return;

  let activeProviderId: string;
  try {
    activeProviderId = yield* selectActiveProviderId.effect();
  } catch (e) {
    logger.warn(
      "Failed to read activeProviderId during initPersistenceSaga",
      e
    );
    return;
  }

  let legacySelectedModel: string | null = null;
  try {
    legacySelectedModel = yield* call(getLocalStorageItem, GLOBAL_MODEL_KEY);
  } catch {
    // Ignore
  }

  // Load per-workspace model preferences
  try {
    const stored: string | null = yield* call(getLocalStorageItem, WORKSPACE_MODELS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      yield* put(loadWorkspaceModelsFromStorage(parsed));
      logger.debug("Loaded workspace models");
    }
  } catch (error) {
    logger.error("Failed to load workspace models:", error);
  }

  // Load per-provider model preferences
  try {
    const stored: string | null = yield* call(getLocalStorageItem, PROVIDER_MODELS_KEY);
    const providerModels = normalizeProviderModels(parseStoredModels(stored));
    const migratedLegacyModel = legacySelectedModel
      ? normalizeModelForProvider(activeProviderId, legacySelectedModel)
      : null;

    if (migratedLegacyModel && !providerModels[activeProviderId]) {
      providerModels[activeProviderId] = migratedLegacyModel;
      yield* call(setLocalStorageItem, PROVIDER_MODELS_KEY, JSON.stringify(providerModels));
      logger.debug("Migrated legacy global model into provider model storage", {
        activeProviderId,
        migratedLegacyModel,
      });
    }

    yield* put(loadProviderModelsFromStorage(providerModels));
    logger.debug("Loaded provider models", {
      count: Object.keys(providerModels).length,
    });

    const selectedModel = providerModels[activeProviderId];
    if (selectedModel) {
      try {
        unifiedStateStore.selectModel(selectedModel);
      } catch (e) {
        logger.warn("Failed to sync stored selected model with unified store", e);
      }
    }
  } catch (error) {
    logger.error("Failed to load provider models:", error);
  }

  try {
    const availableModelsCollection =
      yield* selectAvailableModelsCollection.effect();
    unifiedStateStore.setAvailableModels(getItems(availableModelsCollection));
  } catch (e) {
    logger.warn("Failed to sync stored available models with unified store", e);
  }

  // Trigger initial model load
  yield* put(loadModels());
}

/**
 * Handle reloading models when the active provider changes.
 */
export function* handleReloadModelsForProvider() {
  let newProviderId: string;
  try {
    newProviderId = yield* selectActiveProviderId.effect();
  } catch (e) {
    logger.warn(
      "Failed to read activeProviderId during reloadModelsForProvider",
      e
    );
    return;
  }

  logger.info("Reloading models for provider change", {
    newProvider: newProviderId,
  });

  // Clear per-workspace overrides
  yield* put(clearAllWorkspaceModels());
  try {
    yield* call(removeLocalStorageItem, WORKSPACE_MODELS_KEY);
  } catch (error) {
    logger.warn("Failed to clear workspace model storage", error);
  }

  // Restore the user's last-selected model for this provider (if any)
  const providerModels: Record<string, string> = yield* selectProviderModels.effect();
  const savedModel = providerModels[newProviderId];
  const nextModel =
    savedModel ??
    normalizeModelForProvider(newProviderId, MODEL_DEFAULTS.UI_INITIAL_MODEL);

  if (savedModel) {
    logger.info("Restoring saved model for provider", {
      providerId: newProviderId,
      savedModel,
    });
  } else {
    logger.info("No saved model for provider, resetting to provider default", {
      providerId: newProviderId,
      fallbackModel: nextModel,
    });
  }

  yield* put(
    setSelectedModel({ providerId: newProviderId, model: nextModel })
  );
  try {
    yield* call(setLocalStorageItem, GLOBAL_MODEL_KEY, nextModel);
  } catch (e) {
    logger.warn("Failed to persist saved model to localStorage", e);
  }
  try {
    unifiedStateStore.selectModel(nextModel);
  } catch (e) {
    logger.warn("Failed to sync saved model with unified store", e);
  }

  yield* put(clearLoadingStateForProvider(newProviderId));
  yield* put(setAvailableModels([]));

  try {
    unifiedStateStore.setAvailableModels([]);
  } catch (e) {
    logger.warn("Failed to clear available models in unified store", e);
  }

  yield* put(loadModels());
}



/**
 * Persist workspace models to localStorage when they change.
 */
function* handleWorkspaceModelChange() {
  try {
    const workspaceModels: Record<string, string> = yield* selectWorkspaceModels.effect();
    yield* call(setLocalStorageItem, WORKSPACE_MODELS_KEY, JSON.stringify(workspaceModels));
  } catch (error) {
    logger.error("Failed to save workspace models:", error);
  }
}

/**
 * Persistence saga:
 * - Initializes state from localStorage on startup
 * - Watches for provider reload requests
 * - Watches for workspace model changes to persist
 */
export function* persistenceSaga() {
  yield* call(initPersistenceSaga);
  yield* takeLatest(reloadModelsForProvider, handleReloadModelsForProvider);
  yield* takeLatest(setWorkspaceModel, handleWorkspaceModelChange);
  yield* takeLatest(clearWorkspaceModel, handleWorkspaceModelChange);
}