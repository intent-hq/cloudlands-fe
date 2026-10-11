import { store } from '../index';
import * as projections from '../../../../../src/store/renderer/slices/provider-catalog/provider-catalog-projections';

export const selectProviderCatalogLoaded = store.createSelector(
  projections.getProviderCatalogLoaded,
);
export const selectProviderCatalogEntries = store.createSelector(
  projections.getProviderCatalogEntries,
);
export const selectAllCatalogProviderIds = store.createSelector(
  projections.getAllCatalogProviderIds,
);
export const selectEffectiveDefaultProviderId = store.createSelector(
  projections.getEffectiveDefaultProviderId,
);
export const selectProviderCatalogEntry = store.createSelector(projections.getProviderCatalogEntry);
export const selectResolvedProviderCatalogEntry = store.createSelector(
  projections.getResolvedProviderCatalogEntry,
);
export const selectProviderCatalogEntryOrDefault = store.createSelector(
  projections.getProviderCatalogEntryOrDefault,
);
export const selectProviderEnabledFromCatalog = store.createSelector(
  projections.getProviderEnabledFromCatalog,
);
export const selectNormalizedProviderId = store.createSelector(projections.getNormalizedProviderId);
export const selectProviderDisplayName = store.createSelector(projections.getProviderDisplayName);
export const selectIsModelValidForProvider = store.createSelector(
  projections.getIsModelValidForProvider,
);
export const selectIsProviderAuthenticationError = store.createSelector(
  projections.getIsProviderAuthenticationError,
);
export const selectProviderAuthFailureGuidance = store.createSelector(
  projections.getProviderAuthFailureGuidance,
);
export type { ProviderAuthFailureGuidance } from '../../../../../src/store/renderer/slices/provider-catalog/provider-catalog-types';
