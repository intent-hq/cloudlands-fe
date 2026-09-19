import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';

// ============================================================================
// Types
// ============================================================================

export type FeatureCodesState = {
  /** Currently active feature IDs */
  activeFeatures: string[];
  /** Whether the feature code dialog is open */
  dialogOpen: boolean;
  /** Whether the store has been initialized */
  initialized: boolean;
  operation: FeatureCodeOperationState;
};

export type FeatureCodeOperationState = {
  version: number;
  status: 'idle' | 'loading' | 'success' | 'error';
  kind: 'load' | 'activate' | 'deactivate' | null;
  result: 'activated' | 'already_active' | 'invalid' | 'deactivated' | null;
  error: string | null;
};

// ============================================================================
// Initial State
// ============================================================================

export const initialState: FeatureCodesState = {
  activeFeatures: [],
  dialogOpen: false,
  initialized: false,
  operation: { version: 0, status: 'idle', kind: null, result: null, error: null },
};

// ============================================================================
// Actions
// ============================================================================

/** Store the active feature IDs fetched from the main process */
export const setActiveFeatures = createAction<[features: string[]]>(
  'featureCodes/setActiveFeatures',
);

/** Toggle the feature code dialog open state */
export const toggleFeatureCodeDialog = createAction('featureCodes/toggleFeatureCodeDialog');
export const loadActiveFeaturesRequested = createAction('featureCodes/loadActiveFeaturesRequested');
export const activateFeatureCodeRequested = createAction<[code: string]>(
  'featureCodes/activateFeatureCodeRequested',
);
export const deactivateFeatureRequested = createAction<[featureId: string]>(
  'featureCodes/deactivateFeatureRequested',
);
export const restartForFeatureCodesRequested = createAction(
  'featureCodes/restartForFeatureCodesRequested',
);
export const featureCodeOperationSucceeded = createAction<
  [
    kind: Exclude<FeatureCodeOperationState['kind'], null>,
    result: FeatureCodeOperationState['result'],
  ]
>('featureCodes/featureCodeOperationSucceeded');
export const featureCodeOperationFailed = createAction<
  [kind: Exclude<FeatureCodeOperationState['kind'], null>, error: string]
>('featureCodes/featureCodeOperationFailed');

// ============================================================================
// Reducer
// ============================================================================

export const featureCodesReducer = createReducer<FeatureCodesState>(initialState);
featureCodesReducer.with(setActiveFeatures, (state, { payload: [features] }) => ({
  ...state,
  activeFeatures: features,
  initialized: true,
}));
featureCodesReducer.with(toggleFeatureCodeDialog, (state) => ({
  ...state,
  dialogOpen: !state.dialogOpen,
}));

function requestOperation(
  state: FeatureCodesState,
  kind: Exclude<FeatureCodeOperationState['kind'], null>,
): FeatureCodesState {
  return {
    ...state,
    operation: {
      version: state.operation.version + 1,
      status: 'loading',
      kind,
      result: null,
      error: null,
    },
  };
}

featureCodesReducer.with(loadActiveFeaturesRequested, (state) => requestOperation(state, 'load'));
featureCodesReducer.with(activateFeatureCodeRequested, (state) =>
  requestOperation(state, 'activate'),
);
featureCodesReducer.with(deactivateFeatureRequested, (state) =>
  requestOperation(state, 'deactivate'),
);
featureCodesReducer.with(featureCodeOperationSucceeded, (state, { payload: [kind, result] }) => {
  if (state.operation.kind !== kind) return state;
  return { ...state, operation: { ...state.operation, status: 'success', result } };
});
featureCodesReducer.with(featureCodeOperationFailed, (state, { payload: [kind, error] }) => {
  if (state.operation.kind !== kind) return state;
  return { ...state, operation: { ...state.operation, status: 'error', error } };
});
