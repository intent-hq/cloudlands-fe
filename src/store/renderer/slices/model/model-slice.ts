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
  ModelReplyLabels,
  ModelState,
} from './model-types';

export type { ModelFallbackInfo, ModelState } from './model-types';

/**
 * One `setLoadingStateForProvider` update: the load status plus whatever reply
 * labels (`ModelReplyLabels`) accompany it.
 */
type ModelLoadingStateUpdate = ModelReplyLabels & {
  status: ModelLoadingStatus;
  retryAttempt?: number;
  error?: string;
};

/**
 * Default carry rule for every reply label: a fresh result replaces it, a
 * failed load clears it, and a loading update keeps it unless it brings its own.
 */
function carryLabel(status: ModelLoadingStatus, next: unknown, previous: unknown): unknown {
  if (status === 'success') return next;
  if (status === 'error') return undefined;
  return next ?? previous;
}

function buildLoadingState(
  previous: ModelLoadingState | undefined,
  updates: ModelLoadingStateUpdate,
): ModelLoadingState {
  const { status, retryAttempt, error: nextError, ...nextLabels } = updates;
  const {
    status: _previousStatus,
    retryAttempt: previousRetryAttempt,
    error: previousError,
    ...previousLabels
  }: Partial<ModelLoadingState> = previous ?? {};
  const next: Record<string, unknown> = nextLabels;
  const prior: Record<string, unknown> = previousLabels;

  // Labels are merged by key, not copied one by one, so a new reply label
  // follows the default rule without an edit here; only labels with their own
  // rule are special-cased below.
  const labels: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(prior), ...Object.keys(next)])) {
    const value = carryLabel(status, next[key], prior[key]);
    if (value !== undefined) labels[key] = value;
  }

  // `stale` is recorded only when true.
  if (labels.stale !== true) delete labels.stale;

  // The kind follows its warning's lifecycle and never outlives it: a new
  // warning brings its own kind (or none), never the previous one's.
  const warningKind =
    status === 'success' || nextLabels.warning !== undefined
      ? nextLabels.warningKind
      : status === 'error'
        ? undefined
        : previousLabels.warningKind;
  delete labels.warningKind;
  if (labels.warning !== undefined && warningKind !== undefined) {
    labels.warningKind = warningKind;
  }

  const nextState: ModelLoadingState = {
    ...(labels as ModelReplyLabels),
    status,
    retryAttempt: retryAttempt ?? previousRetryAttempt ?? 0,
  };
  const error = nextError ?? previousError;
  if (error !== undefined) {
    nextState.error = error;
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
  [payload: ModelLoadingStateUpdate & { providerId: string }]
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
  (state, { payload: [{ providerId, ...updates }] }) => ({
    ...state,
    loadingState: {
      ...state.loadingState,
      [providerId]: buildLoadingState(state.loadingState[providerId], updates),
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
