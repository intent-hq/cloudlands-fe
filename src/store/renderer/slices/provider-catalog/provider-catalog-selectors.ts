/**
 * Provider Catalog Selectors
 *
 * The read surface over the daemon-served registry, mirroring the lookup
 * API `$shared/config/provider-config.ts` exposes over its hardcoded table
 * (getProviderConfig / getDefaultProviderId / getAllProviderIds / tier
 * lookups / resolveProviderEnabled) so consumers can migrate 1:1 in a
 * follow-up task. Consumers must check `selectProviderCatalogLoaded` (or
 * tolerate `undefined`) before the first hydration lands.
 */
import { getItem, getItems } from '$lib/store-shim/utils/collections/collection-utils';
import { store } from '../../store';
import type { ProviderCatalogEntry, ProviderModelTier } from './provider-catalog-types';

/** True once the first `providers.catalog` hydration landed. */
export const selectProviderCatalogLoaded = store.createSelector(
  (state): boolean => state.providerCatalog.loaded,
);

/** All rows in the daemon's registry order (gated-off rows included). */
export const selectProviderCatalogEntries = store.createSelector(
  (state): ProviderCatalogEntry[] => getItems(state.providerCatalog.providers),
);

/** All provider ids in registry order. */
export const selectAllCatalogProviderIds = store.createSelector(
  (state): string[] => state.providerCatalog.providers.ids,
);

/** The registry's default provider id ('' until the catalog is hydrated). */
export const selectCatalogDefaultProviderId = store.createSelector(
  (state): string => state.providerCatalog.defaultProviderId,
);

/** One registry row by id; `undefined` when unknown or not yet hydrated. */
export const selectProviderCatalogEntry = store.createSelector(
  (state, providerId: string): ProviderCatalogEntry | undefined =>
    getItem(state.providerCatalog.providers, providerId),
);

/**
 * `getProviderConfig`-equivalent: the row for `providerId`, falling back to
 * the default provider's row when the id is unknown. `undefined` only before
 * the first hydration.
 */
export const selectProviderCatalogEntryOrDefault = store.createSelector(
  (state, providerId: string): ProviderCatalogEntry | undefined =>
    getItem(state.providerCatalog.providers, providerId) ??
    getItem(state.providerCatalog.providers, state.providerCatalog.defaultProviderId),
);

/**
 * The static `{ fast, balanced, smart }` tier table for a provider, or
 * `undefined` for dynamic-model providers (§5.38: `modelTiers` is present
 * only for static-tier providers) and unknown ids. No default-provider
 * fallback — callers must not receive another provider's model ids.
 */
export const selectProviderModelTiers = store.createSelector(
  (state, providerId: string): Record<string, string> | undefined =>
    getItem(state.providerCatalog.providers, providerId)?.modelTiers,
);

/**
 * `getDefaultModelForProvider`-equivalent: the model id at one capability
 * tier. `undefined` when the provider has no static tier table (callers
 * fall back to the parent agent's model, as today).
 */
export const selectDefaultModelForProviderTier = store.createSelector(
  (state, providerId: string, tier: ProviderModelTier): string | undefined =>
    selectProviderModelTiers.select(state, providerId)?.[tier],
);

/**
 * `resolveProviderEnabled`-equivalent against the catalog: providers that
 * cannot be disabled are always enabled; the default provider is enabled
 * when it has no persisted entry; every other provider defaults to disabled
 * when unset. Reads the persisted map from the providerSettings slice.
 */
export const selectProviderEnabledFromCatalog = store.createSelector(
  (state, providerId: string): boolean => {
    const entry = selectProviderCatalogEntryOrDefault.select(state, providerId);
    if (entry?.canBeDisabled === false) return true;
    const enabled = state.providerSettings.enabledProviders[providerId];
    return enabled ?? providerId === state.providerCatalog.defaultProviderId;
  },
);
