import { createAction } from "../../utils/create-action";
import { createReducer } from "../../utils/create-reducer";
import {
  createCollection,
  type Collection,
} from "../../utils/collection-utils";
import type { AuggieModel } from "$features/auggie/auggie-models.client";
import {
  normalizeModelForProvider,
  normalizeProviderModels,
} from "./model-selection-utils";

// ============================================================================
// Types
// ============================================================================

export type ModelLoadingStatus = "success" | "loading" | "error";

export type ModelLoadingState = {
  status: ModelLoadingStatus;
  retryAttempt: number;
  error?: string;
};

export type ModelState = {
  availableModels: Collection<AuggieModel, "value">;
  loadingState: Record<string, ModelLoadingState>;
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

function buildLoadingState(
  previous: ModelLoadingState | undefined,
  updates: {
    status: ModelLoadingStatus;
    retryAttempt?: number;
    error?: string;
  }
): ModelLoadingState {
  const nextState: ModelLoadingState = {
    status: updates.status,
    retryAttempt: updates.retryAttempt ?? previous?.retryAttempt ?? 0,
  };

  const error = updates.error ?? previous?.error;
  if (error !== undefined) {
    nextState.error = error;
  }

  return nextState;
}

// ============================================================================
// Initial State
// ============================================================================

export const initialState: ModelState = {
  availableModels: createCollection<AuggieModel, "value">("value"),
  loadingState: {},
  workspaceModels: {},
  providerModels: {},
};

// ============================================================================
// Reducer Actions (pure state updates)
// ============================================================================

export const setSelectedModel = createAction<
  [payload: { providerId: string; model: string }]
>(
  "model/setSelectedModel"
);

export const setAvailableModels = createAction<[models: AuggieModel[]]>("model/setAvailableModels");

export const setLoadingStateForProvider = createAction<
  [
    payload: {
      providerId: string;
      status: ModelLoadingStatus;
      retryAttempt?: number;
      error?: string;
    },
  ]
>(
  "model/setLoadingStateForProvider"
);

export const clearLoadingStateForProvider = createAction<[providerId: string]>(
  "model/clearLoadingStateForProvider"
);

export const setRetryAttempt = createAction<
  [payload: { providerId: string; attempt: number }]
>(
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

export const loadWorkspaceModelsFromStorage = createAction<
  [models: Record<string, string>]
>("model/loadWorkspaceModelsFromStorage");

export const loadProviderModelsFromStorage = createAction<
  [models: Record<string, string>]
>("model/loadProviderModelsFromStorage");

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
  .with(setSelectedModel, (state, { payload: [{ providerId, model }] }) => ({
    ...state,
    providerModels: {
      ...state.providerModels,
      [providerId]: normalizeModelForProvider(providerId, model),
    },
  }))
  .with(setAvailableModels, (state, { payload: [models] }) => ({
    ...state,
    availableModels: createCollection<AuggieModel, "value">("value", models),
  }))
  .with(
    setLoadingStateForProvider,
    (state, { payload: [{ providerId, status, retryAttempt, error }] }) => ({
      ...state,
      loadingState: {
        ...state.loadingState,
        [providerId]: buildLoadingState(state.loadingState[providerId], {
          status,
          retryAttempt,
          error,
        }),
      },
    })
  )
  .with(clearLoadingStateForProvider, (state, { payload: [providerId] }) => {
     
    const { [providerId]: _removed, ...loadingState } = state.loadingState;

    return {
      ...state,
      loadingState,
    };
  })
  .with(setRetryAttempt, (state, { payload: [{ providerId, attempt }] }) => {
    const previous = state.loadingState[providerId];

    return {
      ...state,
      loadingState: {
        ...state.loadingState,
        [providerId]: buildLoadingState(previous, {
          status: previous?.status ?? "loading",
          retryAttempt: attempt,
        }),
      },
    };
  })
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
      providerModels: normalizeProviderModels(models),
    })
  );
