import { createAction } from "svelte-redux-toolkit/utils/store/create-action";
import { createReducer } from "svelte-redux-toolkit/utils/store/create-reducer";

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

/** Trigger fetch of active features (saga handles IPC) */
export const fetchFeatures = createAction("featureCodes/fetchFeatures");

/** Set active features on successful fetch */
export const fetchFeaturesSuccess = createAction<[features: string[]]>(
  "featureCodes/fetchFeaturesSuccess"
);

/** Request to deactivate a feature (triggers saga) */
export const deactivateFeature = createAction<[featureId: string]>(
  "featureCodes/deactivateFeature"
);

/** Toggle the feature code dialog open state */
export const toggleFeatureCodeDialog = createAction("featureCodes/toggleFeatureCodeDialog");

// ============================================================================
// Reducer
// ============================================================================

export const featureCodesReducer = createReducer<FeatureCodesState>(initialState)
  .with(fetchFeaturesSuccess, (state, { payload: [features] }) => ({
    ...state,
    activeFeatures: features,
    initialized: true,
  }))
  .with(toggleFeatureCodeDialog, (state) => ({
    ...state,
    dialogOpen: !state.dialogOpen,
  }));

