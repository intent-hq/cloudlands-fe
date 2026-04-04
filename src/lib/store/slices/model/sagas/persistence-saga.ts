import { call, put, takeLatest } from "typed-redux-saga";
import { getLocalStorageItem, getLocalStorageJSON, removeLocalStorageItem, setLocalStorageJSON, setLocalStorageItem, } from "$lib/store/utils/safe-local-storage-saga";
import { MODEL_DEFAULTS } from "$shared/constants/agent-services";
import { selectActiveProviderId } from "../../provider-settings/provider-settings-selectors";
import { selectProviderModels, selectWorkspaceModels, } from "../model-selectors";
import { normalizeModelForProvider, normalizeProviderModels, } from "../model-selection-utils";
import { loadModels, reloadModelsForProvider, setSelectedModel, clearAllWorkspaceModels, clearLoadingStateForProvider, setWorkspaceModel, setAvailableModels, clearWorkspaceModel, loadWorkspaceModelsFromStorage, loadProviderModelsFromStorage, GLOBAL_MODEL_KEY, WORKSPACE_MODELS_KEY, PROVIDER_MODELS_KEY, } from "../model-slice";
function parseStoredModels(stored: Record<string, string> | undefined): Record<string, string> {
    return stored ?? {};
}
/**
 * Init saga: load from localStorage and trigger initial model load.
 */
export function* initPersistenceSaga() {
    if (typeof window === "undefined")
        return;
    let activeProviderId: string;
    try {
        activeProviderId = yield* selectActiveProviderId.effect();
    }
    catch {
        return;
    }
    let legacySelectedModel: string | null = null;
    legacySelectedModel = yield* call(getLocalStorageItem, GLOBAL_MODEL_KEY);
    // Load per-workspace model preferences
    const parsed = yield* call(getLocalStorageJSON<Record<string, string>>, WORKSPACE_MODELS_KEY);
    if (parsed) {
        yield* put(loadWorkspaceModelsFromStorage(parsed));
    }
    // Load per-provider model preferences
    const stored = yield* call(getLocalStorageJSON<Record<string, string>>, PROVIDER_MODELS_KEY);
    const providerModels = normalizeProviderModels(parseStoredModels(stored));
    const migratedLegacyModel = legacySelectedModel
        ? normalizeModelForProvider(activeProviderId, legacySelectedModel)
        : null;
    if (migratedLegacyModel && !providerModels[activeProviderId]) {
        providerModels[activeProviderId] = migratedLegacyModel;
        yield* call(setLocalStorageJSON, PROVIDER_MODELS_KEY, providerModels);
    }
    yield* put(loadProviderModelsFromStorage(providerModels));
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
    }
    catch {
        return;
    }
    // Clear per-workspace overrides
    yield* put(clearAllWorkspaceModels());
    yield* call(removeLocalStorageItem, WORKSPACE_MODELS_KEY);
    // Restore the user's last-selected model for this provider (if any)
    const providerModels: Record<string, string> = yield* selectProviderModels.effect();
    const savedModel = providerModels[newProviderId];
    const nextModel = savedModel ??
        normalizeModelForProvider(newProviderId, MODEL_DEFAULTS.UI_INITIAL_MODEL);
    if (savedModel) {
    }
    else {
    }
    yield* put(setSelectedModel({ providerId: newProviderId, model: nextModel }));
    yield* call(setLocalStorageItem, GLOBAL_MODEL_KEY, nextModel);
    yield* put(clearLoadingStateForProvider(newProviderId));
    yield* put(setAvailableModels([]));
    yield* put(loadModels());
}
/**
 * Persist workspace models to localStorage when they change.
 */
function* handleWorkspaceModelChange() {
    const workspaceModels: Record<string, string> = yield* selectWorkspaceModels.effect();
    yield* call(setLocalStorageJSON, WORKSPACE_MODELS_KEY, workspaceModels);
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
