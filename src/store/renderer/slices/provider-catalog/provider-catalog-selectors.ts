/**
 * Provider Catalog Selectors
 *
 * The read surface over the daemon-served registry (`providers.catalog`,
 * PROTOCOL §5.38) — the renderer's single source of provider metadata
 * (display names, commands, auth hints, tier tables, default provider).
 * Consumers must check `selectProviderCatalogLoaded` (or tolerate
 * `undefined` / identity fallbacks) before the first hydration lands.
 */
import { getItem, getItems } from '$lib/store-shim/utils/collections/collection-utils';
import {
  isProviderAuthenticationErrorForEntry,
  type ProviderModelTiersTable,
} from '$shared/provider-catalog';
import { isModelValidForProvider, parseCompoundModelId } from '$shared/utils/compound-model-id';
import { store } from '../../store';
import type { ProviderCatalogEntry, ProviderModelTier } from './provider-catalog-types';

/** True once the first `providers.catalog` hydration landed. */
export const selectProviderCatalogLoaded = store.createSelector(
  (state): boolean => state.providerCatalog?.loaded ?? false,
);

/** All rows in the daemon's registry order (gated-off rows included). */
export const selectProviderCatalogEntries = store.createSelector(
  (state): ProviderCatalogEntry[] =>
    state.providerCatalog ? getItems(state.providerCatalog.providers) : [],
);

/** All provider ids in registry order. */
export const selectAllCatalogProviderIds = store.createSelector(
  (state): string[] => state.providerCatalog?.providers.ids ?? [],
);

/** The registry's default provider id ('' until the catalog is hydrated). */
export const selectCatalogDefaultProviderId = store.createSelector(
  (state): string => state.providerCatalog?.defaultProviderId ?? '',
);

/** One registry row by id; `undefined` when unknown or not yet hydrated. */
export const selectProviderCatalogEntry = store.createSelector(
  (state, providerId: string): ProviderCatalogEntry | undefined =>
    state.providerCatalog ? getItem(state.providerCatalog.providers, providerId) : undefined,
);

/**
 * `getProviderConfig`-equivalent: the row for `providerId`, falling back to
 * the default provider's row when the id is unknown. `undefined` only before
 * the first hydration.
 */
export const selectProviderCatalogEntryOrDefault = store.createSelector(
  (state, providerId: string): ProviderCatalogEntry | undefined =>
    selectProviderCatalogEntry.select(state, providerId) ??
    selectProviderCatalogEntry.select(state, selectCatalogDefaultProviderId.select(state)),
);

/**
 * The static `{ fast, balanced, smart }` tier table for a provider, or
 * `undefined` for dynamic-model providers (§5.38: `modelTiers` is present
 * only for static-tier providers) and unknown ids. No default-provider
 * fallback — callers must not receive another provider's model ids.
 */
export const selectProviderModelTiers = store.createSelector(
  (state, providerId: string): ProviderModelTiersTable | undefined =>
    selectProviderCatalogEntry.select(state, providerId)?.modelTiers,
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
 * The `canBeDisabled` check uses the EXACT row (no default fallback) so an
 * unknown id cannot inherit the default provider's canBeDisabled:false.
 */
export const selectProviderEnabledFromCatalog = store.createSelector(
  (state, providerId: string): boolean => {
    const entry = selectProviderCatalogEntry.select(state, providerId);
    if (entry?.canBeDisabled === false) return true;
    const enabled = state.providerSettings.enabledProviders[providerId];
    return enabled ?? providerId === selectCatalogDefaultProviderId.select(state);
  },
);

/**
 * Canonical provider id for a raw/aliased id: the row's own `id` when known,
 * the registry default for unknown ids (mirroring the old
 * `getProviderConfig(id).id` alias healing for `acp` / `default` /
 * `augment`), and the raw id verbatim before hydration.
 */
export const selectNormalizedProviderId = store.createSelector(
  (state, providerId: string): string =>
    selectProviderCatalogEntryOrDefault.select(state, providerId)?.id ?? providerId,
);

/**
 * Display name for a provider id, falling back to the raw id when the row
 * (or the catalog) is missing — safe for labels before hydration.
 */
export const selectProviderDisplayName = store.createSelector(
  (state, providerId: string): string =>
    selectProviderCatalogEntryOrDefault.select(state, providerId)?.displayName ?? providerId,
);

/**
 * `parseCompoundModelId`-equivalent: bare model ids resolve to the
 * registry's default provider ('' before hydration — callers seeded at
 * connect time never observe that in practice).
 */
export const selectParsedCompoundModelId = store.createSelector(
  (state, compoundModelId: string): { providerId: string; modelId: string } =>
    parseCompoundModelId(compoundModelId, selectCatalogDefaultProviderId.select(state)),
);

/**
 * `isModelValidForProvider`-equivalent against the catalog default: whether
 * a (compound or bare) model id belongs to `targetProviderId`.
 */
export const selectIsModelValidForProvider = store.createSelector(
  (state, model: string, targetProviderId: string): boolean =>
    isModelValidForProvider(model, targetProviderId, selectCatalogDefaultProviderId.select(state)),
);

/**
 * `isProviderAuthenticationError`-equivalent: match an error message against
 * the provider's catalog `authErrorPatterns`. Unknown ids fall back to the
 * default provider's row, mirroring the legacy lookup.
 */
export const selectIsProviderAuthenticationError = store.createSelector(
  (state, providerId: string, errorMessage: string): boolean =>
    isProviderAuthenticationErrorForEntry(
      selectProviderCatalogEntryOrDefault.select(state, providerId),
      errorMessage,
    ),
);
