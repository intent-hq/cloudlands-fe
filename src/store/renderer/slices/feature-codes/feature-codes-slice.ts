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
};

// ============================================================================
// Initial State
// ============================================================================

export const initialState: FeatureCodesState = {
  activeFeatures: [],
  dialogOpen: false,
  initialized: false,
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
