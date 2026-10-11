import { store } from '../index';
import * as projections from '../../../../../src/store/renderer/slices/provider-settings/provider-settings-projections';

export const selectProviderSettingsSessionRequests = store.createSelector(
  projections.getProviderSettingsSessionRequests,
);
export const selectProviderSettingsSessionActive = store.createSelector(
  projections.getProviderSettingsSessionActive,
);
export const selectProviderWriteRevision = store.createSelector(
  projections.getProviderWriteRevision,
);
export const selectProviderPaths = store.createSelector(projections.getProviderPaths);
export const selectProviderPathsRevision = store.createSelector(
  projections.getProviderPathsRevision,
);
export const selectPiAdapter = store.createSelector(projections.getPiAdapter);
export const selectActiveProviderId = store.createSelector(projections.getActiveProviderId);
export const selectIsProviderActive = store.createSelector(projections.getIsProviderActive);
export const selectEnabledProviders = store.createSelector(projections.getEnabledProviders);
export const selectIsProviderEnabled = store.createSelector(projections.getIsProviderEnabled);
export const selectEnabledProviderIds = store.createSelector(projections.getEnabledProviderIds);
export const selectIsProviderModelAccessAllowed = store.createSelector(
  projections.getIsProviderModelAccessAllowed,
);
export const selectAvailableEnabledProviderIds = store.createSelector(
  projections.getAvailableEnabledProviderIds,
);
export const selectQuotaRetryProviderIds = store.createSelector(
  projections.getQuotaRetryProviderIds,
);
export const selectModelFetchProviderIds = store.createSelector(
  projections.getModelFetchProviderIds,
);
export const selectIsActiveProviderAvailable = store.createSelector(
  projections.getIsActiveProviderAvailable,
);
export const selectProviderFastModeState = store.createSelector(
  projections.getProviderFastModeState,
);
export const selectProviderFastModeValues = store.createSelector(
  projections.getProviderFastModeValues,
);
export const selectFastModeSupportedProviders = store.createSelector(
  projections.getFastModeSupportedProviders,
);
