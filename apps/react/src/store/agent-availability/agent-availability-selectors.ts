import { store } from '../index';
import * as projections from '../../../../../src/store/renderer/slices/agent-availability/agent-availability-projections';

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
