import { createAction } from '$lib/store-shim/utils/store/create-action';
import { createReducer } from '$lib/store-shim/utils/store/create-reducer';
import { createCollection } from '$lib/store-shim/utils/collections/collection-utils';
import type { AuggieModel } from '$features/auggie/auggie-models.client';
import { providerCatalogLoaded } from '../provider-catalog/provider-catalog-slice';
import {
  hydrateActiveProvider,
  setActiveProvider,
} from '../provider-settings/provider-settings-slice';
import {
  normalizeModelForProvider,
  normalizeProviderModels,
} from './model-selection-utils';
import type {
  ModelFallbackInfo,
  ModelLoadingState,
  ModelLoadingStatus,
  ModelState,
} from './model-types';

export type {
  ModelFallbackInfo,
  ModelLoadingState,
  ModelLoadingStatus,
  ModelState,
} from './model-types';

// ============================================================================
// Constants
// ============================================================================

export const GLOBAL_MODEL_KEY = 'workspaces-selected-model';
export const PROVIDER_MODELS_KEY = 'workspaces-provider-models';

export const MAX_AUTO_RETRIES = 3;
export const RETRY_DELAYS_MS = [5_000, 15_000, 30_000];

function buildLoadingState(
  previous: ModelLoadingState | undefined,
  updates: {
    status: ModelLoadingStatus;
    retryAttempt?: number;
    error?: string;
    warning?: string;
  },
): ModelLoadingState {
  const nextState: ModelLoadingState = {
    status: updates.status,
    retryAttempt: updates.retryAttempt ?? previous?.retryAttempt ?? 0,
  };

  const error = updates.error ?? previous?.error;
  if (error !== undefined) {
    nextState.error = error;
  }

  const warning =
    updates.status === 'success'
      ? updates.warning
      : updates.status === 'error'
        ? undefined
        : (updates.warning ?? previous?.warning);
  if (warning !== undefined) {
    nextState.warning = warning;
  }

  return nextState;
}

// ============================================================================
// Initial State
// ============================================================================

export const initialState: ModelState = {
  availableModels: createCollection<AuggieModel, 'value'>('value'),
  availableModelsProviderId: '',
  loadingState: {},
  providerModels: {},
  modelPickerCollapsedGroups: [],
  fallbackInfoByAgentId: {},
  defaultProviderId: '',
};

// ============================================================================
// Reducer Actions (pure state updates)
// ============================================================================

export const setSelectedModel =
  createAction<[payload: { providerId: string; model: string }]>('model/setSelectedModel');

export const setAvailableModels = createAction<[models: AuggieModel[], providerId?: string]>(
  'model/setAvailableModels',
);

export const setLoadingStateForProvider = createAction<
  [
    payload: {
      providerId: string;
      status: ModelLoadingStatus;
      retryAttempt?: number;
      error?: string;
      warning?: string;
    },
  ]
>('model/setLoadingStateForProvider');

export const clearLoadingStateForProvider = createAction<[providerId: string]>(
  'model/clearLoadingStateForProvider',
);

export const setRetryAttempt =
  createAction<[payload: { providerId: string; attempt: number }]>('model/setRetryAttempt');

export const loadProviderModelsFromStorage = createAction<[models: Record<string, string>]>(
  'model/loadProviderModelsFromStorage',
);

export const hydrateModelPickerCollapsedGroups = createAction<[groupKeys: string[]]>(
  'model/hydrateModelPickerCollapsedGroups',
);

export const setModelPickerGroupCollapsed = createAction<[groupKey: string, collapsed: boolean]>(
  'model/setModelPickerGroupCollapsed',
);

export const requestHydrateModelFallbackInfo = createAction<[agentId: string]>(
  'model/requestHydrateModelFallbackInfo',
);

export const hydrateModelFallbackInfo = createAction<
  [agentId: string, info: ModelFallbackInfo | null]
>('model/hydrateModelFallbackInfo');

export const setModelFallbackInfo = createAction<[agentId: string, info: ModelFallbackInfo]>(
  'model/setModelFallbackInfo',
);

export const clearModelFallbackInfo = createAction<[agentId: string]>(
  'model/clearModelFallbackInfo',
);
// ============================================================================
// Saga Trigger Actions (dispatched by consumers, handled by sagas)
// ============================================================================

export const loadModels = createAction('model/loadModels');
export const selectModel = createAction<[model: string]>('model/selectModel');
export const reloadModelsForProvider = createAction('model/reloadModelsForProvider');
export const retryLoadModels = createAction('model/retryLoadModels');
export const resetToDefaults = createAction('model/resetToDefaults');

// ============================================================================
// Reducer
// ============================================================================

export const modelReducer = createReducer<ModelState>(initialState)
  .with(providerCatalogLoaded, (state, { payload: [catalog] }) => {
    // The registry carries no default designation — the active provider
    // (mirrored via setActiveProvider/hydrateActiveProvider) is the effective
    // default; the first catalog row is the last-resort fallback.
    const defaultProviderId = state.defaultProviderId || (catalog.providers[0]?.id ?? '');
    return {
      ...state,
      defaultProviderId,
      // Re-normalize persisted picks that landed before hydration: bare ids
      // for the default provider, prefixed otherwise (same rule as writes).
      providerModels: normalizeProviderModels(state.providerModels, defaultProviderId),
    };
  })
  .with(setActiveProvider, (state, { payload: [providerId] }) => ({
    ...state,
    defaultProviderId: providerId,
    providerModels: normalizeProviderModels(state.providerModels, providerId),
  }))
  .with(hydrateActiveProvider, (state, { payload: [providerId] }) => ({
    ...state,
    defaultProviderId: providerId,
    providerModels: normalizeProviderModels(state.providerModels, providerId),
  }))
  .with(setSelectedModel, (state, { payload: [{ providerId, model }] }) => ({
    ...state,
    providerModels: {
      ...state.providerModels,
      [providerId]: normalizeModelForProvider(providerId, model, state.defaultProviderId),
    },
  }))
  .with(setAvailableModels, (state, { payload: [models, providerId] }) => ({
    ...state,
    availableModels: createCollection<AuggieModel, 'value'>('value', models),
    // Both writers (model-reload-service, boot seeder) load for the active
    // provider, which `defaultProviderId` mirrors — so it is the correct
    // attribution when the dispatch does not carry one explicitly.
    availableModelsProviderId: providerId ?? state.defaultProviderId,
  }))
  .with(
    setLoadingStateForProvider,
    (state, { payload: [{ providerId, status, retryAttempt, error, warning }] }) => ({
      ...state,
      loadingState: {
        ...state.loadingState,
        [providerId]: buildLoadingState(state.loadingState[providerId], {
          status,
          retryAttempt,
          error,
          warning,
        }),
      },
    }),
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
          status: previous?.status ?? 'loading',
          retryAttempt: attempt,
        }),
      },
    };
  })
  .with(loadProviderModelsFromStorage, (state, { payload: [models] }) => ({
    ...state,
    providerModels: normalizeProviderModels(models, state.defaultProviderId),
  }))
  .with(hydrateModelPickerCollapsedGroups, (state, { payload: [groupKeys] }) => ({
    ...state,
    modelPickerCollapsedGroups: [...new Set(groupKeys)],
  }))
  .with(setModelPickerGroupCollapsed, (state, { payload: [groupKey, collapsed] }) => {
    const groups = new Set(state.modelPickerCollapsedGroups);
    if (collapsed) {
      groups.add(groupKey);
    } else {
      groups.delete(groupKey);
    }
    return { ...state, modelPickerCollapsedGroups: [...groups] };
  })
  .with(hydrateModelFallbackInfo, (state, { payload: [agentId, info] }) => {
    const fallbackInfoByAgentId = { ...state.fallbackInfoByAgentId };
    if (info) {
      fallbackInfoByAgentId[agentId] = info;
    } else {
      delete fallbackInfoByAgentId[agentId];
    }
    return { ...state, fallbackInfoByAgentId };
  })
  .with(setModelFallbackInfo, (state, { payload: [agentId, info] }) => ({
    ...state,
    fallbackInfoByAgentId: { ...state.fallbackInfoByAgentId, [agentId]: info },
  }))
  .with(clearModelFallbackInfo, (state, { payload: [agentId] }) => {
    const fallbackInfoByAgentId = { ...state.fallbackInfoByAgentId };
    delete fallbackInfoByAgentId[agentId];
    return { ...state, fallbackInfoByAgentId };
  });
