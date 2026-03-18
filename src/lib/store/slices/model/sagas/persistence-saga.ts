import { call, put, takeLatest } from "typed-redux-saga";
import { unifiedStateStore } from "$features/agent/services/unified-state-store";
import { createLogger } from "$lib/utils/client-logger";
import { selectActiveProviderId } from "../../active-provider/active-provider-selectors";
import { selectProviderModels, selectWorkspaceModels } from "../model-selectors";
import {
  loadModels,
  reloadModelsForProvider,
  setSelectedModel,
  setActiveProviderId,
  setLoadError,
  setModelsLoaded,
  setRetryAttempt,
  clearAllWorkspaceModels,
  setWorkspaceModel,
  clearWorkspaceModel,
  loadWorkspaceModelsFromStorage,
  loadProviderModelsFromStorage,
  GLOBAL_MODEL_KEY,
  WORKSPACE_MODELS_KEY,
  PROVIDER_MODELS_KEY,
} from "../model-slice";

const logger = createLogger("PersistenceSaga");

/**
 * Init saga: load from localStorage and trigger initial model load.
 */
export function* initPersistenceSaga() {
  if (typeof window === "undefined") return;

  // Load global selected model
  try {
    const stored: string | null = yield* call(
      [localStorage, localStorage.getItem],
      GLOBAL_MODEL_KEY
    );
    if (stored) {
      yield* put(setSelectedModel(stored));
      logger.debug("Loaded global model from localStorage:", stored);
    }
  } catch {
    // Ignore
  }

  // Load per-workspace model preferences
  try {
    const stored: string | null = yield* call(
      [localStorage, localStorage.getItem],
      WORKSPACE_MODELS_KEY
    );
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
    const stored: string | null = yield* call(
      [localStorage, localStorage.getItem],
      PROVIDER_MODELS_KEY
    );
    if (stored) {
      const parsed = JSON.parse(stored);
      yield* put(loadProviderModelsFromStorage(parsed));
      logger.debug("Loaded provider models");
    }
  } catch (error) {
    logger.error("Failed to load provider models:", error);
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
    yield* call([localStorage, localStorage.removeItem], WORKSPACE_MODELS_KEY);
  } catch (error) {
    logger.warn("Failed to clear workspace model storage", error);
  }

  // Restore the user's last-selected model for this provider (if any)
  const providerModels: Record<string, string> = yield* selectProviderModels.effect();
  const savedModel = providerModels[newProviderId];
  if (savedModel) {
    logger.info("Restoring saved model for provider", {
      providerId: newProviderId,
      savedModel,
    });
    yield* put(setSelectedModel(savedModel));
    try {
      yield* call(
        [localStorage, localStorage.setItem],
        GLOBAL_MODEL_KEY,
        savedModel
      );
    } catch (e) {
      logger.warn("Failed to persist saved model to localStorage", e);
    }
    try {
      unifiedStateStore.selectModel(savedModel);
    } catch (e) {
      logger.warn("Failed to sync saved model with unified store", e);
    }
  }

  // Update active provider context and let loadModels use cached models when available.
  yield* put(setActiveProviderId(newProviderId));
  yield* put(setModelsLoaded({ providerId: newProviderId, loaded: false }));
  yield* put(setLoadError(null));
  yield* put(setRetryAttempt(0));

  yield* put(loadModels());
}



/**
 * Persist workspace models to localStorage when they change.
 */
function* handleWorkspaceModelChange() {
  try {
    const workspaceModels: Record<string, string> = yield* selectWorkspaceModels.effect();
    yield* call(
      [localStorage, localStorage.setItem],
      WORKSPACE_MODELS_KEY,
      JSON.stringify(workspaceModels)
    );
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