// Svelte binding of the shared read owner; remove this facade when the Svelte renderer retires.
import { store } from '../../store';
import * as projections from './agent-availability-projections';

export const selectProviderStatusMap = store.createSelector(projections.getProviderStatusMap);
export const selectProviderLoadingMap = store.createSelector(projections.getProviderLoadingMap);
export const selectProviderCheckEpochMap = store.createSelector(
  projections.getProviderCheckEpochMap,
);
export const selectHasCheckedOnce = store.createSelector(projections.getHasCheckedOnce);
export const selectIsAnyProviderLoading = store.createSelector(projections.getIsAnyProviderLoading);
export const selectNpxStatus = store.createSelector(projections.getNpxStatus);
export const selectProviderHiddenIds = store.createSelector(projections.getProviderHiddenIds);
export const selectProviderDiscoveryError = store.createSelector(
  projections.getProviderDiscoveryError,
);
export const selectProviderDiscoveryRevision = store.createSelector(
  projections.getProviderDiscoveryRevision,
);
export const selectProviderModelsRefreshPending = store.createSelector(
  projections.getProviderModelsRefreshPending,
);
export const selectProviderModelsRefreshRevision = store.createSelector(
  projections.getProviderModelsRefreshRevision,
);
export const selectOnboardingAdapterPreparationContext = store.createSelector(
  projections.getOnboardingAdapterPreparationContext,
);
