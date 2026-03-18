import { call, put, takeLatest, delay } from "typed-redux-saga";
import { unifiedStateStore } from "$features/agent/services/unified-state-store";
import type { AuggieModel } from "$features/auggie/auggie-models.client";
import { createLogger } from "$lib/utils/client-logger";
import { MODEL_DEFAULTS } from "$shared/constants/agent-services";
import {
  getDefaultProviderId,
  parseCompoundModelId,
  resolvePreferredModel,
} from "$shared/config/provider-config";
import { selectActiveProviderId } from "../../active-provider/active-provider-selectors";
import { fetchModelsForProvider } from "../model-utils";
import {
  loadModels,
  retryLoadModels,
  setAvailableModels,
  setIsLoadingModels,
  setModelsLoaded,
  setLoadError,
  setActiveProviderId,
  setRetryAttempt,
  selectModel,
  MAX_AUTO_RETRIES,
  RETRY_DELAYS_MS,
} from "../model-slice";
import {
  selectAvailableModelsForProvider,
  selectModelsLoadedForProvider,
  selectIsLoadingModelsForProvider,
  selectSelectedModel,
  selectRetryAttempt,
  selectModelsLoaded,
} from "../model-selectors";

const logger = createLogger("LoadModelsSaga");

/**
 * Handle loading models for the active provider.
 */
function* handleLoadModels() {
  let activeProviderId: string;
  try {
    activeProviderId = yield* selectActiveProviderId.effect();
  } catch (e) {
    logger.warn(
      "Failed to read activeProviderId during loadModels — chunk may not be loaded yet",
      e
    );
    return;
  }

  yield* put(setActiveProviderId(activeProviderId));

  // Skip if already loaded for this provider or currently loading
  const modelsLoaded: boolean =
    yield* selectModelsLoadedForProvider.effect(activeProviderId);
  const isLoading: boolean =
    yield* selectIsLoadingModelsForProvider.effect(activeProviderId);
  const cachedModels: AuggieModel[] =
    yield* selectAvailableModelsForProvider.effect(activeProviderId);

  if (modelsLoaded || isLoading) {
    logger.debug(
      "Models already loaded for active provider or loading, skipping",
      { activeProviderId, modelsLoaded, isLoading }
    );

    if (modelsLoaded && cachedModels.length > 0) {
      try {
        unifiedStateStore.setAvailableModels(cachedModels);
      } catch (e) {
        logger.warn("Failed to sync cached models with unified store", e);
      }
    }

    return;
  }

  yield* put(setIsLoadingModels({ providerId: activeProviderId, loading: true }));
  yield* put(setLoadError(null));
  logger.debug("Loading models for active provider:", { activeProviderId });

  // Sync loading state with unified store
  try {
    unifiedStateStore.setModelsLoading(true);
  } catch (e) {
    logger.warn("Failed to sync loading state with unified store", e);
  }

  try {
    const models = yield* call(fetchModelsForProvider, activeProviderId);

    if (models.length > 0) {
      // Prefix model values with provider ID for non-default providers
      const defaultProviderId = getDefaultProviderId();
      const prefixedModels = models.map((model) => {
        if (activeProviderId !== defaultProviderId) {
          return { ...model, value: `${activeProviderId}:${model.value}` };
        }
        return model;
      }) as AuggieModel[];

      yield* put(
        setAvailableModels({ providerId: activeProviderId, models: prefixedModels })
      );
      yield* put(
        setModelsLoaded({ providerId: activeProviderId, loaded: true })
      );
      yield* put(setActiveProviderId(activeProviderId));
      yield* put(setLoadError(null));
      yield* put(setRetryAttempt(0));

      // Sync models with unified state store
      try {
        unifiedStateStore.setAvailableModels(prefixedModels);
      } catch (e) {
        logger.warn("Failed to sync available models with unified store", e);
      }

      // Validate selected model is in the available list
      const selectedModel: string = yield* selectSelectedModel.effect();
      const availableModelValues = prefixedModels.map((m) => m.value);
      const { providerId: selectedProviderId, modelId } =
        parseCompoundModelId(selectedModel);
      const isModelAvailable =
        availableModelValues.includes(selectedModel) ||
        (selectedProviderId === activeProviderId &&
          availableModelValues.some((v) => v.endsWith(modelId)));

      if (!isModelAvailable && prefixedModels.length > 0) {
        const toModel =
          resolvePreferredModel(
            MODEL_DEFAULTS.UI_MODEL_PREFERENCE,
            availableModelValues
          ) ?? prefixedModels[0].value;
        logger.warn(
          "Selected model not available for active provider, using preferred default",
          { selectedModel, activeProviderId, fallbackModel: toModel }
        );
        yield* put(selectModel(toModel));
      }
    } else {
      yield* put(
        setLoadError(
          `No models available for ${activeProviderId}. Please try again.`
        )
      );
      logger.warn("Model list was empty for provider:", {
        providerId: activeProviderId,
      });
      yield* call(autoRetrySaga, activeProviderId);
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Failed to load models";
    yield* put(setLoadError(errorMessage));
    logger.error("Failed to load models:", error);
    yield* call(autoRetrySaga, activeProviderId);
  } finally {
    yield* put(
      setIsLoadingModels({ providerId: activeProviderId, loading: false })
    );
    try {
      unifiedStateStore.setModelsLoading(false);
    } catch (e) {
      logger.warn("Failed to sync loading state with unified store", e);
    }
  }
}

/**
 * Auto-retry with exponential backoff using saga delay().
 */
function* autoRetrySaga(forProviderId: string) {
  const retryAttempt: number = yield* selectRetryAttempt.effect();

  if (retryAttempt >= MAX_AUTO_RETRIES) {
    logger.warn("Max auto-retries reached for model loading", {
      attempts: retryAttempt,
      providerId: forProviderId,
    });
    return;
  }

  const delayMs = RETRY_DELAYS_MS[retryAttempt] ?? 30_000;
  yield* put(setRetryAttempt(retryAttempt + 1));

  logger.info(
    `Scheduling model load retry ${retryAttempt + 1}/${MAX_AUTO_RETRIES} in ${delayMs / 1000}s`
  );

  yield* delay(delayMs);

  // Only retry if still for the same provider and not yet loaded
  try {
    const currentModelsLoaded: boolean = yield* selectModelsLoaded.effect();
    const currentProviderId: string = yield* selectActiveProviderId.effect();
    if (!currentModelsLoaded && currentProviderId === forProviderId) {
      logger.info(
        `Auto-retrying model load (attempt ${retryAttempt + 1}/${MAX_AUTO_RETRIES})`
      );
      yield* put(loadModels());
    }
  } catch (e) {
    logger.warn("Failed to check activeProviderId during auto-retry", e);
  }
}

/**
 * Handle manual retry: reset retry state and trigger load.
 */
function* handleRetryLoadModels() {
  logger.debug("Retrying model load...");
  const activeProviderId: string = yield* selectActiveProviderId.effect();

  yield* put(setActiveProviderId(activeProviderId));
  yield* put(
    setModelsLoaded({ providerId: activeProviderId, loaded: false })
  );
  yield* put(setLoadError(null));
  yield* put(setRetryAttempt(0));
  yield* put(loadModels());
}

/**
 * Load models saga:
 * - Watches for loadModels actions and handles fetching + validation
 * - Watches for retryLoadModels actions for manual retry
 */
export function* loadModelsSaga() {
  yield* takeLatest(loadModels, handleLoadModels);
  yield* takeLatest(retryLoadModels, handleRetryLoadModels);
}

