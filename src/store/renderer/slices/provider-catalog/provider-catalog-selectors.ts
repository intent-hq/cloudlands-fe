/**
 * Provider Catalog Selectors
 *
 * The read surface over the daemon-served registry (`providers.catalog`,
 * PROTOCOL §5.38) — the renderer's single source of provider metadata
 * (display names, commands, auth hints). Consumers must check
 * `selectProviderCatalogLoaded` (or tolerate `undefined` / identity
 * fallbacks) before the first hydration lands.
 *
 * The registry carries no default designation: the effective default
 * provider is derived from user settings via
 * `selectEffectiveDefaultProviderId`.
 */
import { getItem, getItems } from '$lib/store-shim/utils/collections/collection-utils';
import { isProviderAuthenticationErrorForEntry } from '$shared/provider-catalog';
import {
  isModelValidForProvider,
  parseCompoundModelId,
  splitCompoundModelId,
} from '$shared/utils/compound-model-id';
import { store } from '../../store';
import type { ProviderCatalogEntry } from './provider-catalog-types';

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

/**
 * The effective default provider id, derived from user settings (the
 * registry carries no default designation): the provider prefix of the
 * global default model when it is a compound id, else the active provider
 * (`providers.active`), else the first catalog row. '' only before any of
 * those resolve (fresh state, catalog not hydrated).
 *
 * Once the catalog is hydrated, a prefix that is not a known catalog
 * provider id (malformed/legacy compound string) is ignored and resolution
 * falls through to the next precedence step, so an unknown id never
 * mis-attributes bare model ids downstream.
 */
export const selectEffectiveDefaultProviderId = store.createSelector((state): string => {
  const catalogLoaded = state.providerCatalog?.loaded ?? false;
  const catalogIds = state.providerCatalog?.providers.ids ?? [];
  const activeProviderId = state.providerSettings?.activeProviderId ?? '';
  const globalModel = activeProviderId
    ? state.model?.providerModels?.[activeProviderId]
    : undefined;
  if (globalModel?.includes(':')) {
    const { providerId } = splitCompoundModelId(globalModel);
    if (providerId && (!catalogLoaded || catalogIds.includes(providerId))) return providerId;
  }
  if (activeProviderId) return activeProviderId;
  return catalogIds[0] ?? '';
});

/** One registry row by id; `undefined` when unknown or not yet hydrated. */
export const selectProviderCatalogEntry = store.createSelector(
  (state, providerId: string): ProviderCatalogEntry | undefined =>
    state.providerCatalog ? getItem(state.providerCatalog.providers, providerId) : undefined,
);

/**
 * `getProviderConfig`-equivalent: the row for `providerId`, falling back to
 * the effective default provider's row when the id is unknown. `undefined`
 * only before the first hydration.
 */
export const selectProviderCatalogEntryOrDefault = store.createSelector(
  (state, providerId: string): ProviderCatalogEntry | undefined =>
    selectProviderCatalogEntry.select(state, providerId) ??
    selectProviderCatalogEntry.select(state, selectEffectiveDefaultProviderId.select(state)),
);

/**
 * `resolveProviderEnabled`-equivalent against the catalog: providers that
 * cannot be disabled are always enabled; every other provider defaults to
 * disabled when unset. Reads the persisted map from the providerSettings
 * slice. The `canBeDisabled` check uses the EXACT row (no default fallback)
 * so an unknown id cannot inherit another row's canBeDisabled:false.
 */
export const selectProviderEnabledFromCatalog = store.createSelector(
  (state, providerId: string): boolean => {
    const entry = selectProviderCatalogEntry.select(state, providerId);
    if (entry?.canBeDisabled === false) return true;
    return state.providerSettings.enabledProviders[providerId] ?? false;
  },
);

/**
 * Canonical provider id for a raw/aliased id: the row's own `id` when known,
 * the effective default for unknown ids (mirroring the old
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
 * effective default provider ('' before any settings/catalog hydration —
 * callers seeded at connect time never observe that in practice).
 */
export const selectParsedCompoundModelId = store.createSelector(
  (state, compoundModelId: string): { providerId: string; modelId: string } =>
    parseCompoundModelId(compoundModelId, selectEffectiveDefaultProviderId.select(state)),
);

/**
 * `isModelValidForProvider`-equivalent against the effective default:
 * whether a (compound or bare) model id belongs to `targetProviderId`.
 */
export const selectIsModelValidForProvider = store.createSelector(
  (state, model: string, targetProviderId: string): boolean =>
    isModelValidForProvider(
      model,
      targetProviderId,
      selectEffectiveDefaultProviderId.select(state),
    ),
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
