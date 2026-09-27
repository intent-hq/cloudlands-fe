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
import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { isProviderAuthenticationErrorForEntry } from '$shared/provider-catalog';
import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
import { store } from '../../store';
import type { ProviderCatalogEntry } from './provider-catalog-types';

/** True once the first `providers.catalog` hydration landed. */
export const selectProviderCatalogLoaded = store.createSelector(
  (state): boolean => state.providerCatalog?.loaded ?? false,
);

/** All rows in the daemon's registry order (gated-off rows included). */
export const selectProviderCatalogEntries = store.createSelector((state): ProviderCatalogEntry[] =>
  state.providerCatalog ? getItems(state.providerCatalog.providers) : [],
);

/** All provider ids in registry order. */
export const selectAllCatalogProviderIds = store.createSelector(
  (state): string[] => state.providerCatalog?.providers.ids ?? [],
);

/**
 * The effective default provider id, derived from user settings (the
 * registry carries no default designation): the default provider mirrored
 * by the model slice (`model.defaultProvider`). '' when unresolved — an
 * honest state (fresh state, settings not hydrated, or
 * `model.defaultProvider` unset).
 * The FE never fabricates a default from the catalog: falling through to
 * the first catalog row would functionally reinstate the removed hardcoded
 * auggie default. Mirrors the daemon's `derived_default_provider`, which
 * resolves unset settings to None (§5.31 gate closed), not a registry row.
 * Provider provenance lives in the triple's provider leg — model ids in the
 * store are always bare and never consulted here.
 */
export const selectEffectiveDefaultProviderId = store.createSelector((state): string => {
  return state.model?.defaultProviderId ?? '';
});

/** One registry row by id; `undefined` when unknown or not yet hydrated. */
export const selectProviderCatalogEntry = store.createSelector(
  (state, providerId: string): ProviderCatalogEntry | undefined =>
    state.providerCatalog ? getItem(state.providerCatalog.providers, providerId) : undefined,
);

/** Canonical ID first, then only aliases explicitly advertised by the daemon. */
export const selectResolvedProviderCatalogEntry = store.createSelector(
  (state, providerId: string): ProviderCatalogEntry | undefined => {
    const exact = selectProviderCatalogEntry.select(state, providerId);
    if (exact || !providerId) return exact;
    return selectProviderCatalogEntries
      .select(state)
      .find((entry) => entry.legacyAliases?.includes(providerId));
  },
);

/**
 * `getProviderConfig`-equivalent: the row for `providerId`, falling back to
 * the effective default provider's row when the id is unknown. `undefined`
 * before the first hydration, or for an unknown id while the effective
 * default is unresolved ('').
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
 * Preserve unresolved identity on older daemons and before catalog hydration.
 * Settings defaults, row order and availability never determine alias identity.
 */
export const selectNormalizedProviderId = store.createSelector(
  (state, providerId: string): string =>
    selectResolvedProviderCatalogEntry.select(state, providerId)?.id ?? providerId,
);

/**
 * Display name for a provider id, falling back to the raw id when the row
 * (or the catalog) is missing — safe for labels before hydration.
 */
export const selectProviderDisplayName = store.createSelector(
  (state, providerId: string): string =>
    selectResolvedProviderCatalogEntry.select(state, providerId)?.displayName ?? providerId,
);

/**
 * Whether a (legacy compound or bare) model id belongs to
 * `targetProviderId`; bare ids attribute to the effective default provider.
 */
export const selectIsModelValidForProvider = store.createSelector(
  (state, model: string, targetProviderId: string): boolean =>
    selectNormalizedProviderId.select(
      state,
      splitLegacyCompoundId(model).providerId ?? selectEffectiveDefaultProviderId.select(state),
    ) === selectNormalizedProviderId.select(state, targetProviderId),
);

/**
 * `isProviderAuthenticationError`-equivalent: match an error message against
 * the provider's catalog `authErrorPatterns`. Unresolved explicit IDs do not
 * inherit authentication guidance from a different provider.
 */
export const selectIsProviderAuthenticationError = store.createSelector(
  (state, providerId: string, errorMessage: string): boolean =>
    isProviderAuthenticationErrorForEntry(
      selectResolvedProviderCatalogEntry.select(state, providerId),
      errorMessage,
    ),
);

/** Login guidance for a provider authentication failure. */
export interface ProviderAuthFailureGuidance {
  /** Canonical id of the provider whose auth failed (refresh target). */
  providerId: string;
  /** Login command to surface (catalog hint, else `<command> login`). */
  loginCommandHint: string;
  /** claude-code only: desktop-app sign-in does not carry over to the CLI. */
  showClaudeDesktopNote: boolean;
}

/**
 * Login guidance for an agent failure: when `errorMessage` matches the
 * provider's catalog `authErrorPatterns`, return the actionable login
 * command (and the claude-code desktop-app caveat). The provider resolves
 * from the session's explicit provider id, else the compound model prefix,
 * else the effective default. Unresolved explicit identity stays unresolved. `null` when
 * there is no error or it is not an authentication failure.
 */
export const selectProviderAuthFailureGuidance = store.createSelector(
  (
    state,
    provider: string | null | undefined,
    model: string | null | undefined,
    errorMessage: string | null | undefined,
  ): ProviderAuthFailureGuidance | null => {
    if (!errorMessage) return null;
    let rawId = provider || '';
    if (!rawId && model?.includes(':')) {
      rawId = splitLegacyCompoundId(model).providerId || '';
    }
    const entry = selectResolvedProviderCatalogEntry.select(
      state,
      rawId || selectEffectiveDefaultProviderId.select(state),
    );
    if (!isProviderAuthenticationErrorForEntry(entry, errorMessage)) return null;
    const providerId = entry?.id ?? rawId;
    return {
      providerId,
      loginCommandHint: entry?.loginCommandHint || `${entry?.command ?? providerId} login`,
      showClaudeDesktopNote: providerId === 'claude-code',
    };
  },
);
