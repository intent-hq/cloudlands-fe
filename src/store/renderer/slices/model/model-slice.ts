import { hostExecutionConnectionChanged } from '../host-execution/host-execution-slice';
import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import type { AuggieModel } from '$features/auggie/auggie-models.client';
import { toBareProviderModels } from './model-selection-utils';
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
  selectionConnection: null,
  modelPickerCollapsedGroups: [],
  fallbackInfoByAgentId: {},
  defaultReasoningEffort: '',
  defaultProviderId: '',
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

/**
 * Hydration echo of `model.defaultProvider` (boot snapshot or
 * `settings:changed`). User intents and RPC acknowledgements never update it.
 */
export const hydrateDefaultProvider = createAction<[providerId: string]>(
  'model/hydrateDefaultProvider',
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
/**
 * User pick of the global default model. `providerId` names the provider the
 * pick belongs to; when omitted (legacy callers, persisted `model.default`
 * echoes) the saga attributes a lenient legacy compound prefix, else the
 * current default provider.
 */
export const selectModel = createAction<[model: string, providerId?: string]>('model/selectModel');
export const reloadModelsForProvider = createAction('model/reloadModelsForProvider');

// ============================================================================
// Reducer
// ============================================================================

export const modelReducer = createReducer<ModelState>(initialState);
modelReducer.with(hydrateDefaultProvider, (state, { payload: [defaultProviderId] }) =>
  state.defaultProviderId === defaultProviderId ? state : { ...state, defaultProviderId },
);
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
modelReducer.with(loadProviderModelsFromStorage, (state, { payload: [models] }) => ({
  ...state,
  providerModels: toBareProviderModels(models),
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

modelReducer.with(hostExecutionConnectionChanged, (_state, { payload: [connection] }) => ({
  ...initialState,
  selectionConnection: connection,
}));
