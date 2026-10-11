import { store } from '../index';
import * as projections from '../../../../../src/store/renderer/slices/provider-catalog/workspace-catalog-projections';

export const selectSettledProviderReadiness = store.createSelector(
  projections.getSettledProviderReadiness,
);
export const selectWorkspaceCatalogEpoch = store.createSelector(
  projections.getWorkspaceCatalogEpoch,
);
export const selectWorkspaceCatalogFresh = store.createSelector(
  projections.getWorkspaceCatalogFresh,
);
export const selectContextProviderEntries = store.createSelector(
  projections.getContextProviderEntries,
);
export const selectContextDefaultProvider = store.createSelector(
  projections.getContextDefaultProvider,
);
export const selectContextEnabledProviders = store.createSelector(
  projections.getContextEnabledProviders,
);
export const selectContextModelProviderIds = store.createSelector(
  projections.getContextModelProviderIds,
);
export const selectContextAvailableProviderIds = store.createSelector(
  projections.getContextAvailableProviderIds,
);
export const selectContextReadinessLoaded = store.createSelector(
  projections.getContextReadinessLoaded,
);
export const selectContextSelectedModel = store.createSelector(projections.getContextSelectedModel);
export const selectContextProviderWarnings = store.createSelector(
  projections.getContextProviderWarnings,
);
export const selectContextProviderStaleFlags = store.createSelector(
  projections.getContextProviderStaleFlags,
);
export const selectContextQuotaRetryProviderIds = store.createSelector(
  projections.getContextQuotaRetryProviderIds,
);
export const selectContextReadiness = store.createSelector(projections.getContextReadiness);
