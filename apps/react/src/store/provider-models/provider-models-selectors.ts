import { store } from '../index';
import * as projections from '../../../../../src/store/renderer/slices/provider-models/provider-models-projections';

export const selectProviderModelsCacheMap = store.createSelector(
  projections.getProviderModelsCacheMap,
);
export const selectProviderModelsCacheEntry = store.createSelector(
  projections.getProviderModelsCacheEntry,
);
export const selectProviderModelsClearEpoch = store.createSelector(
  projections.getProviderModelsClearEpoch,
);
export const selectProviderModelsRequests = store.createSelector(
  projections.getProviderModelsRequests,
);
export const selectObservedModelProviders = store.createSelector(
  projections.getObservedModelProviders,
);
export const selectObservedModelProviderKeys = store.createSelector(
  projections.getObservedModelProviderKeys,
);
export const selectLearnedModelDisplayName = store.createSelector(
  projections.getLearnedModelDisplayName,
);
export const selectLearnedModelNames = store.createSelector(projections.getLearnedModelNames);
