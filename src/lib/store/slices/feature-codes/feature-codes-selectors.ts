import { createSelector } from "../../utils/create-selector";

/** Select all active feature IDs */
export const selectActiveFeatures = createSelector(
  (state): string[] => {
    return state.featureCodes.activeFeatures;
  }
);

/** Select whether a specific feature is enabled */
export const selectIsFeatureEnabled = createSelector(
  (state, featureId: string): boolean => {
    return state.featureCodes.activeFeatures.includes(featureId);
  }
);

/** Select whether there are any active features */
export const selectHasActiveFeatures = createSelector(
  (state): boolean => {
    return state.featureCodes.activeFeatures.length > 0;
  }
);

