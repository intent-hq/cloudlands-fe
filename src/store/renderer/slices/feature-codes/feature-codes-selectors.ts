import { store } from "../../store";

/** Select all active feature IDs */
export const selectActiveFeatures = store.createSelector(
  (state): string[] => {
    return state.featureCodes.activeFeatures;
  }
);

/** Select whether a specific feature is enabled */
export const selectIsFeatureEnabled = store.createSelector(
  (state, featureId: string): boolean => {
    return state.featureCodes.activeFeatures.includes(featureId);
  }
);

/** Select whether there are any active features */
export const selectHasActiveFeatures = store.createSelector(
  (state): boolean => {
    return state.featureCodes.activeFeatures.length > 0;
  }
);

/** Select whether the feature code dialog is open */
export const selectFeatureCodeDialogOpen = store.createSelector(
  (state): boolean => {
    return state.featureCodes.dialogOpen;
  }
);

