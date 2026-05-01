import { call, put, takeLatest, delay } from "typed-redux-saga";
import type { AuggieModel } from "$features/auggie/auggie-models.client";
import { selectActiveProviderId } from "../../provider-settings/provider-settings-selectors";
import { fetchModelsForProvider } from "../model-utils";
import { findAvailableModelMatch, normalizeModelForProvider, resolvePreferredModelForProvider, } from "../model-selection-utils";
import { loadModels, retryLoadModels, setAvailableModels, setLoadingStateForProvider, clearLoadingStateForProvider, setRetryAttempt, selectModel, MAX_AUTO_RETRIES, RETRY_DELAYS_MS, } from "../model-slice";
import { selectIsLoadingModelsForProvider, selectModelsLoadedForProvider, selectRetryAttempt, selectSelectedModel } from "../model-selectors";

function getModelLoadErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    if (typeof error === "string" && error) {
        return error;
    }
    return "Failed to load models";
}

/**
 * Handle loading models for the active provider.
 */
export function* handleLoadModels() {
    let activeProviderId: string;
    try {
        activeProviderId = yield* selectActiveProviderId.effect();
    }
    catch {
        return;
    }
    // Skip if already loaded for this provider or currently loading
    const modelsLoaded: boolean = yield* selectModelsLoadedForProvider.effect(activeProviderId);
    const isLoading: boolean = yield* selectIsLoadingModelsForProvider.effect(activeProviderId);
    if (modelsLoaded || isLoading) {
        return;
    }
    yield* put(setLoadingStateForProvider({
        providerId: activeProviderId,
        status: "loading",
    }));
    try {
        const models = yield* call(fetchModelsForProvider, activeProviderId);
        if (models.length > 0) {
            const prefixedModels = models.map((model) => ({
                ...model,
                value: normalizeModelForProvider(activeProviderId, model.value),
            })) as AuggieModel[];
            yield* put(setAvailableModels(prefixedModels));
            yield* put(setLoadingStateForProvider({
                providerId: activeProviderId,
                status: "success",
                retryAttempt: 0,
            }));
            // Validate selected model is in the available list
            const selectedModel: string = yield* selectSelectedModel.effect(activeProviderId);
            const availableModelValues = prefixedModels.map((m) => m.value);
            const matchedModel = findAvailableModelMatch(availableModelValues, activeProviderId, selectedModel);
            if (matchedModel && matchedModel !== selectedModel) {
                yield* put(selectModel(matchedModel));
            }
            else if (!matchedModel && prefixedModels.length > 0) {
                const toModel = resolvePreferredModelForProvider(availableModelValues);
                if (toModel) {
                    yield* put(selectModel(toModel));
                }
            }
        }
        else {
            const errorMessage = `No models available for ${activeProviderId}. Please try again.`;
            yield* put(setLoadingStateForProvider({
                providerId: activeProviderId,
                status: "error",
                error: errorMessage,
            }));
            yield* call(autoRetrySaga, activeProviderId);
        }
    }
    catch (error) {
        const errorMessage = getModelLoadErrorMessage(error);
        yield* put(setLoadingStateForProvider({
            providerId: activeProviderId,
            status: "error",
            error: errorMessage,
        }));
        yield* call(autoRetrySaga, activeProviderId);
    }
    finally {
        // Loading state is tracked in Redux via setLoadingStateForProvider
    }
}
/**
 * Auto-retry with exponential backoff using saga delay().
 */
function* autoRetrySaga(forProviderId: string) {
    const retryAttempt: number = yield* selectRetryAttempt.effect(forProviderId);
    if (retryAttempt >= MAX_AUTO_RETRIES) {
        return;
    }
    const delayMs = RETRY_DELAYS_MS[retryAttempt] ?? 30000;
    yield* put(setRetryAttempt({ providerId: forProviderId, attempt: retryAttempt + 1 }));
    yield* delay(delayMs);
    // Only retry if still for the same provider and not yet loaded
    try {
        const currentProviderId: string = yield* selectActiveProviderId.effect();
        const currentModelsLoaded: boolean = yield* selectModelsLoadedForProvider.effect(forProviderId);
        if (!currentModelsLoaded && currentProviderId === forProviderId) {
            yield* put(loadModels());
        }
    }
    catch {
    }
}
/**
 * Handle manual retry: reset retry state and trigger load.
 */
function* handleRetryLoadModels() {
    const activeProviderId: string = yield* selectActiveProviderId.effect();
    yield* put(clearLoadingStateForProvider(activeProviderId));
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
