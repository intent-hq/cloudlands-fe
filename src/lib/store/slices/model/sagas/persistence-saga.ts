import {
  call,
  put,
  takeEvery,
  takeLatest,
} from "typed-redux-saga";
import {
  getLocalStorageItem,
  getLocalStorageJSON,
  removeLocalStorageItem,
  setLocalStorageJSON,
  setLocalStorageItem,
} from "$lib/store/utils/safe-local-storage-saga";
import { MODEL_DEFAULTS } from "$shared/constants/agent-services";
import { selectActiveProviderId } from "../../provider-settings/provider-settings-selectors";
import {
  selectModelPickerCollapsedGroups,
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
  hydrateModelPickerCollapsedGroups,
  setModelPickerGroupCollapsed,
  requestHydrateModelFallbackInfo,
  hydrateModelFallbackInfo,
  setModelFallbackInfo,
  clearModelFallbackInfo,
} from "../model-slice";
import type { ModelFallbackInfo } from "../model-types";

export const MODEL_PICKER_COLLAPSED_GROUPS_KEY = "model-picker-collapsed-groups";
export const MODEL_FALLBACK_KEY_PREFIX = "workspaces-model-fallback:";

function isFallbackInfo(value: unknown): value is ModelFallbackInfo {
    const info = value as ModelFallbackInfo;
    return !!info
        && typeof info === "object"
        && typeof info.fromModel === "string"
        && typeof info.toModel === "string";
}

function parseCollapsedGroups(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((group): group is string => typeof group === "string") : [];
}
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
    const collapsedGroups = yield* call(getLocalStorageJSON<unknown>, MODEL_PICKER_COLLAPSED_GROUPS_KEY);
    yield* put(hydrateModelPickerCollapsedGroups(parseCollapsedGroups(collapsedGroups)));
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
    yield* put(setSelectedModel({ providerId: newProviderId, model: nextModel }));
    yield* call(setLocalStorageItem, GLOBAL_MODEL_KEY, nextModel);
    yield* put(clearLoadingStateForProvider(newProviderId));
    yield* put(setAvailableModels([]));
    yield* put(loadModels());
}
/**
 * Persist workspace models to localStorage when they change.
 */
export function* handleWorkspaceModelChange() {
    const workspaceModels: Record<string, string> = yield* selectWorkspaceModels.effect();
    yield* call(setLocalStorageJSON, WORKSPACE_MODELS_KEY, workspaceModels);
}
export function* handleCollapsedGroupsChange() {
    const collapsedGroups = yield* selectModelPickerCollapsedGroups.effect();
    yield* call(setLocalStorageJSON, MODEL_PICKER_COLLAPSED_GROUPS_KEY, collapsedGroups);
}
export function* handleHydrateModelFallbackInfo(action: ReturnType<typeof requestHydrateModelFallbackInfo>) {
    const [agentId] = action.payload;
    const stored = yield* call(getLocalStorageJSON<unknown>, `${MODEL_FALLBACK_KEY_PREFIX}${agentId}`);
    yield* put(hydrateModelFallbackInfo(agentId, isFallbackInfo(stored) ? stored : null));
}
export function* handleSetModelFallbackInfo(action: ReturnType<typeof setModelFallbackInfo>) {
    const [agentId, info] = action.payload;
    yield* call(setLocalStorageJSON, `${MODEL_FALLBACK_KEY_PREFIX}${agentId}`, info);
}
export function* handleClearModelFallbackInfo(action: ReturnType<typeof clearModelFallbackInfo>) {
    const [agentId] = action.payload;
    yield* call(removeLocalStorageItem, `${MODEL_FALLBACK_KEY_PREFIX}${agentId}`);
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
    yield* takeLatest(setModelPickerGroupCollapsed, handleCollapsedGroupsChange);
    yield* takeEvery(requestHydrateModelFallbackInfo, handleHydrateModelFallbackInfo);
    yield* takeEvery(setModelFallbackInfo, handleSetModelFallbackInfo);
    yield* takeEvery(clearModelFallbackInfo, handleClearModelFallbackInfo);
}
