// Svelte binding of the shared read owner; remove this facade when the Svelte renderer retires.
import { store } from '../../store';
import * as projections from './provider-models-projections';

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
