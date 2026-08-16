import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";

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

/** Request to deactivate a feature (triggers saga) */
export const deactivateFeature = createAction<[featureId: string]>(
  "featureCodes/deactivateFeature"
);

/** Toggle the feature code dialog open state */
export const toggleFeatureCodeDialog = createAction("featureCodes/toggleFeatureCodeDialog");

// ============================================================================
// Reducer
// ============================================================================

export const featureCodesReducer = createReducer<FeatureCodesState>(initialState);
featureCodesReducer.with(toggleFeatureCodeDialog, (state) => ({
  ...state,
  dialogOpen: !state.dialogOpen,
}));
