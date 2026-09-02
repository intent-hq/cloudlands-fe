import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import type { AuggieModel } from '$features/auggie/auggie-models.client';
import { providerCatalogLoaded } from '../provider-catalog/provider-catalog-slice';
import {
  activeProviderReconciled,
  setAtomicDefaultModel,
  setActiveProvider,
} from '../provider-settings/provider-settings-slice';
import { normalizeModelForProvider, normalizeProviderModels } from './model-selection-utils';
import type {
  ModelFallbackInfo,
  ModelLoadingState,
  ModelLoadingStatus,
  ModelState,
} from './model-types';

export type { ModelFallbackInfo, ModelLoadingStatus, ModelState } from './model-types';

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

  const stale =
    updates.status === 'success'
      ? updates.stale
      : updates.status === 'error'
        ? undefined
        : (updates.stale ?? previous?.stale);
  if (stale) {
    nextState.stale = true;
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
  pendingProviderModels: {},
  modelPickerCollapsedGroups: [],
  fallbackInfoByAgentId: {},
  defaultReasoningEffort: '',
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

export const loadProviderModelsFromStorage = createAction<[models: Record<string, string>]>(
  'model/loadProviderModelsFromStorage',
);

export const providerModelsPersistRejected = createAction<[models: Record<string, string>]>(
  'model/providerModelsPersistRejected',
);

/**
 * User pick of the default reasoning-effort level ('' clears it). Persisted to
 * `model.defaultReasoningEffort` by the model-selection saga's persistence
 * watcher.
 */
export const setDefaultReasoningEffort = createAction<[effort: string]>(
  'model/setDefaultReasoningEffort',
);

/**
 * Hydration echo of `model.defaultReasoningEffort` from the daemon settings
 * catalog — deliberately NOT persisted, so there is no write loop.
 */
export const loadDefaultReasoningEffortFromStorage = createAction<[effort: string]>(
  'model/loadDefaultReasoningEffortFromStorage',
);

export const setModelPickerGroupCollapsed = createAction<[groupKey: string, collapsed: boolean]>(
  'model/setModelPickerGroupCollapsed',
);

export const setModelFallbackInfo = createAction<[agentId: string, info: ModelFallbackInfo]>(
  'model/setModelFallbackInfo',
);

export const clearModelFallbackInfo = createAction<[agentId: string]>(
  'model/clearModelFallbackInfo',
);
export const selectModel = createAction<[model: string]>('model/selectModel');
export const reloadModelsForProvider = createAction('model/reloadModelsForProvider');

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

export const modelReducer = createReducer<ModelState>(initialState);
modelReducer.with(providerCatalogLoaded, (state, { payload: [catalog] }) => {
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
    providerModels: normalizeProviderModels(state.providerModels, defaultProviderId),
  };
});
modelReducer.with(setActiveProvider, (state, { payload: [providerId] }) => {
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
});
modelReducer.with(activeProviderReconciled, (state, { payload: [providerId] }) => {
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
});
modelReducer.with(setSelectedModel, (state, { payload: [{ providerId, model }] }) => ({
  ...state,
  providerModels: {
    ...state.providerModels,
    [providerId]: normalizeModelForProvider(providerId, model, state.defaultProviderId),
  },
  pendingProviderModels: {
    ...state.pendingProviderModels,
    [providerId]: normalizeModelForProvider(providerId, model, state.defaultProviderId),
  },
}));
modelReducer.with(setAtomicDefaultModel, (state, { payload: [{ providerId, model }] }) => {
  const normalizedModel = normalizeModelForProvider(providerId, model, providerId);
  return {
    ...state,
    defaultProviderId: providerId,
    providerModels: {
      ...normalizeProviderModels(state.providerModels, providerId),
      [providerId]: normalizedModel,
    },
    pendingProviderModels: {
      ...normalizeProviderModels(state.pendingProviderModels, providerId),
      [providerId]: normalizedModel,
    },
  };
});
modelReducer.with(setAvailableModels, (state, { payload: [models, providerId] }) => ({
  ...state,
  availableModels: createCollection<AuggieModel, 'value'>('value', models),
  availableModelsProviderId: providerId,
}));
modelReducer.with(
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
);
modelReducer.with(loadProviderModelsFromStorage, (state, { payload: [models] }) => {
  const normalized = normalizeProviderModels(models, state.defaultProviderId);
  const pending: Record<string, string> = {};
  for (const [providerId, model] of Object.entries(state.pendingProviderModels)) {
    if (normalized[providerId] !== model) pending[providerId] = model;
  }
  return {
    ...state,
    providerModels: { ...normalized, ...pending },
    pendingProviderModels: pending,
  };
});
modelReducer.with(providerModelsPersistRejected, (state, { payload: [models] }) => {
  const pending = { ...state.pendingProviderModels };
  for (const [providerId, model] of Object.entries(models)) {
    if (
      pending[providerId] === normalizeModelForProvider(providerId, model, state.defaultProviderId)
    ) {
      delete pending[providerId];
    }
  }
  return { ...state, pendingProviderModels: pending };
});
modelReducer.with(setDefaultReasoningEffort, (state, { payload: [effort] }) => ({
  ...state,
  defaultReasoningEffort: effort,
}));
modelReducer.with(loadDefaultReasoningEffortFromStorage, (state, { payload: [effort] }) => ({
  ...state,
  defaultReasoningEffort: effort,
}));
modelReducer.with(setModelPickerGroupCollapsed, (state, { payload: [groupKey, collapsed] }) => {
  const groups = new Set(state.modelPickerCollapsedGroups);
  if (collapsed) {
    groups.add(groupKey);
  } else {
    groups.delete(groupKey);
  }
  return { ...state, modelPickerCollapsedGroups: [...groups] };
});
modelReducer.with(setModelFallbackInfo, (state, { payload: [agentId, info] }) => ({
  ...state,
  fallbackInfoByAgentId: { ...state.fallbackInfoByAgentId, [agentId]: info },
}));
modelReducer.with(clearModelFallbackInfo, (state, { payload: [agentId] }) => {
  const fallbackInfoByAgentId = { ...state.fallbackInfoByAgentId };
  delete fallbackInfoByAgentId[agentId];
  return { ...state, fallbackInfoByAgentId };
});
