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
    stale?: boolean;
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

  // `stale` qualifies `warning`, so it follows the same lifecycle.
  const stale =
    updates.status === 'success'
      ? updates.stale
      : updates.status === 'error'
        ? undefined
        : (updates.stale ?? previous?.stale);
  if (stale !== undefined) {
    nextState.stale = stale;
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
  catalogProviderIds: [],
};

// ============================================================================
// Reducer Actions (pure state updates)
// ============================================================================

export const setSelectedModel =
  createAction<[payload: { providerId: string; model: string }]>('model/setSelectedModel');

export const setAvailableModels = createAction<[models: AuggieModel[], providerId: string]>(
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
      stale?: boolean;
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

/**
 * Adopt a mirrored default provider id only when it is a known catalog row
 * (or when the catalog has not hydrated yet — pre-hydration ids are
 * re-validated at `providerCatalogLoaded`). Unknown/stale ids keep the
 * fallback so model-id normalization never treats an unknown provider as
 * the default.
 */
function validatedDefaultProviderId(
  candidate: string,
  catalogProviderIds: string[],
  fallback: string,
): string {
  if (!candidate) return fallback;
  if (catalogProviderIds.length === 0 || catalogProviderIds.includes(candidate)) {
    return candidate;
  }
  return fallback;
}

export const modelReducer = createReducer<ModelState>(initialState)
  .with(providerCatalogLoaded, (state, { payload: [catalog] }) => {
    // The registry carries no default designation — the active provider
    // (mirrored via setActiveProvider/hydrateActiveProvider) is the effective
    // default; the first catalog row is the last-resort fallback. A mirrored
    // id that no longer exists in the newly hydrated catalog is stale — reset
    // it to the first row instead of letting it drive normalization.
    const catalogProviderIds = catalog.providers.map((provider) => provider.id);
    const firstRowId = catalogProviderIds[0] ?? '';
    const defaultProviderId = validatedDefaultProviderId(
      state.defaultProviderId,
      catalogProviderIds,
      firstRowId,
    );
    return {
      ...state,
      catalogProviderIds,
      defaultProviderId,
      // Re-normalize persisted picks that landed before hydration: bare ids
      // for the default provider, prefixed otherwise (same rule as writes).
      providerModels: normalizeProviderModels(state.providerModels, defaultProviderId),
    };
  })
  .with(setActiveProvider, (state, { payload: [providerId] }) => {
    const defaultProviderId = validatedDefaultProviderId(
      providerId,
      state.catalogProviderIds,
      state.defaultProviderId,
    );
    return {
      ...state,
      defaultProviderId,
      providerModels: normalizeProviderModels(state.providerModels, defaultProviderId),
    };
  })
  .with(hydrateActiveProvider, (state, { payload: [providerId] }) => {
    const defaultProviderId = validatedDefaultProviderId(
      providerId,
      state.catalogProviderIds,
      state.defaultProviderId,
    );
    return {
      ...state,
      defaultProviderId,
      providerModels: normalizeProviderModels(state.providerModels, defaultProviderId),
    };
  })
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
    // Explicit provenance is required: silently attributing to the current
    // default provider would stamp the wrong provenance whenever the active
    // provider changed between trigger and dispatch.
    availableModelsProviderId: providerId,
  }))
  .with(
    setLoadingStateForProvider,
    (state, { payload: [{ providerId, status, retryAttempt, error, warning, stale }] }) => ({
      ...state,
      loadingState: {
        ...state.loadingState,
        [providerId]: buildLoadingState(state.loadingState[providerId], {
          status,
          retryAttempt,
          error,
          warning,
          stale,
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
