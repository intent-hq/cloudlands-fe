import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import type { AuggieModel } from "$features/auggie/auggie-models.client";
import { MODEL_DEFAULTS } from "$shared/constants/agent-services";

// ============================================================================
// Types
// ============================================================================

export type ModelState = {
  selectedModel: string;
  availableModelsByProvider: Record<string, AuggieModel[]>;
  isLoadingByProvider: Record<string, boolean>;
  modelsLoadedByProvider: Record<string, boolean>;
  loadError: string | null;
  activeProviderId: string | null;
  retryAttempt: number;
  workspaceModels: Record<string, string>;
  providerModels: Record<string, string>;
};

// ============================================================================
// Constants
// ============================================================================

export const GLOBAL_MODEL_KEY = "workspaces-selected-model";
export const WORKSPACE_MODELS_KEY = "workspaces-workspace-models";
export const PROVIDER_MODELS_KEY = "workspaces-provider-models";

export const MAX_AUTO_RETRIES = 3;
export const RETRY_DELAYS_MS = [5_000, 15_000, 30_000];

// ============================================================================
// Initial State
// ============================================================================

export const initialState: ModelState = {
  selectedModel: MODEL_DEFAULTS.UI_INITIAL_MODEL,
  availableModelsByProvider: {},
  isLoadingByProvider: {},
  modelsLoadedByProvider: {},
  loadError: null,
  activeProviderId: null,
  retryAttempt: 0,
  workspaceModels: {},
  providerModels: {},
};

// ============================================================================
// Reducer Actions (pure state updates)
// ============================================================================

export const setSelectedModel = createAction<[model: string]>(
  "model/setSelectedModel"
);

export const setAvailableModels = createAction<
  [payload: { providerId: string; models: AuggieModel[] }]
>(
  "model/setAvailableModels"
);

export const setIsLoadingModels = createAction<
  [payload: { providerId: string; loading: boolean }]
>(
  "model/setIsLoadingModels"
);

export const setModelsLoaded = createAction<
  [payload: { providerId: string; loaded: boolean }]
>(
  "model/setModelsLoaded"
);

export const setLoadError = createAction<[error: string | null]>(
  "model/setLoadError"
);

export const setActiveProviderId = createAction<[id: string | null]>(
  "model/setActiveProviderId"
);

export const setRetryAttempt = createAction<[attempt: number]>(
  "model/setRetryAttempt"
);

export const setWorkspaceModel = createAction<
  [payload: { workspaceId: string; model: string }]
>("model/setWorkspaceModel");

export const clearWorkspaceModel = createAction<[workspaceId: string]>(
  "model/clearWorkspaceModel"
);

export const clearAllWorkspaceModels = createAction(
  "model/clearAllWorkspaceModels"
);

export const setProviderModel = createAction<
  [payload: { providerId: string; model: string }]
>("model/setProviderModel");

export const loadWorkspaceModelsFromStorage = createAction<
  [models: Record<string, string>]
>("model/loadWorkspaceModelsFromStorage");

export const loadProviderModelsFromStorage = createAction<
  [models: Record<string, string>]
>("model/loadProviderModelsFromStorage");

export const resetModelState = createAction("model/resetModelState");

// ============================================================================
// Saga Trigger Actions (dispatched by consumers, handled by sagas)
// ============================================================================

export const loadModels = createAction("model/loadModels");
export const selectModel = createAction<[model: string]>("model/selectModel");
export const reloadModelsForProvider = createAction(
  "model/reloadModelsForProvider"
);
export const retryLoadModels = createAction("model/retryLoadModels");
export const resetToDefaults = createAction("model/resetToDefaults");

// ============================================================================
// Reducer
// ============================================================================

export const modelReducer = createReducer<ModelState>(initialState)
  .with(setSelectedModel, (state, { payload: [model] }) => ({
    ...state,
    selectedModel: model,
  }))
  .with(setAvailableModels, (state, { payload: [{ providerId, models }] }) => ({
    ...state,
    availableModelsByProvider: {
      ...state.availableModelsByProvider,
      [providerId]: models,
    },
  }))
  .with(setIsLoadingModels, (state, { payload: [{ providerId, loading }] }) => ({
    ...state,
    isLoadingByProvider: {
      ...state.isLoadingByProvider,
      [providerId]: loading,
    },
  }))
  .with(setModelsLoaded, (state, { payload: [{ providerId, loaded }] }) => ({
    ...state,
    modelsLoadedByProvider: {
      ...state.modelsLoadedByProvider,
      [providerId]: loaded,
    },
  }))
  .with(setLoadError, (state, { payload: [error] }) => ({
    ...state,
    loadError: error,
  }))
  .with(setActiveProviderId, (state, { payload: [id] }) => ({
    ...state,
    activeProviderId: id,
  }))
  .with(setRetryAttempt, (state, { payload: [attempt] }) => ({
    ...state,
    retryAttempt: attempt,
  }))
  .with(setWorkspaceModel, (state, { payload: [{ workspaceId, model }] }) => ({
    ...state,
    workspaceModels: { ...state.workspaceModels, [workspaceId]: model },
  }))
  .with(clearWorkspaceModel, (state, { payload: [workspaceId] }) => {
    const { [workspaceId]: _, ...rest } = state.workspaceModels;
    return { ...state, workspaceModels: rest };
  })
  .with(clearAllWorkspaceModels, (state) => ({
    ...state,
    workspaceModels: {},
  }))
  .with(
    setProviderModel,
    (state, { payload: [{ providerId, model }] }) => ({
      ...state,
      providerModels: { ...state.providerModels, [providerId]: model },
    })
  )
  .with(
    loadWorkspaceModelsFromStorage,
    (state, { payload: [models] }) => ({
      ...state,
      workspaceModels: models,
    })
  )
  .with(
    loadProviderModelsFromStorage,
    (state, { payload: [models] }) => ({
      ...state,
      providerModels: models,
    })
  )
  .with(resetModelState, () => initialState);

