import type { ProviderReadState } from '../provider-catalog/provider-read-types';
import {
  getHostExecutionContext,
  getIsHostMember,
} from '../host-execution/host-execution-projections';
/**
 * Provider Catalog Selectors
 *
 * The read surface over the daemon-served registry (`providers.catalog`,
 * PROTOCOL §5.38) — the renderer's single source of provider metadata
 * (display names, commands, auth hints). Consumers must check
 * `getProviderCatalogLoaded` (or tolerate `undefined` / identity
 * fallbacks) before the first hydration lands.
 *
 * The registry carries no default designation: the effective default
 * provider is derived from user settings via
 * `getEffectiveDefaultProviderId`.
 */
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { isProviderAuthenticationErrorForEntry } from '$shared/provider-catalog';
import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
import type { ProviderCatalogEntry, ProviderAuthFailureGuidance } from './provider-catalog-types';

/** True once the first `providers.catalog` hydration landed. */
export const getProviderCatalogLoaded = (state: ProviderReadState): boolean =>
  state.providerCatalog?.loaded ?? false;

/** All rows in the daemon's registry order (gated-off rows included). */
export const getProviderCatalogEntries = (
  state: ProviderReadState,
  workspaceId?: string,
): ProviderCatalogEntry[] =>
  workspaceId
    ? (state.providerCatalog?.byWorkspaceId?.[workspaceId]?.catalog.providers ?? [])
    : state.providerCatalog
      ? getItems(state.providerCatalog.providers)
      : [];

/** All provider ids in registry order. */
export const getAllCatalogProviderIds = (state: ProviderReadState): string[] =>
  state.providerCatalog?.providers.ids ?? [];

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
export const getEffectiveDefaultProviderId = (
  state: ProviderReadState,
  workspaceId?: string,
): string => {
  if (workspaceId) {
    const value = state.providerCatalog?.byWorkspaceId?.[workspaceId]?.settings.find(
      (s) => s.path === 'model.defaultProvider',
    )?.value;
    return typeof value === 'string' ? value : '';
  }
  return getIsHostMember(state)
    ? (getHostExecutionContext(state)?.defaultProviderId ?? '')
    : (state.model?.defaultProviderId ?? '');
};

/** One registry row by id; `undefined` when unknown or not yet hydrated. */
export const getProviderCatalogEntry = (
  state: ProviderReadState,
  providerId: string,
  workspaceId?: string,
): ProviderCatalogEntry | undefined =>
  workspaceId
    ? getProviderCatalogEntries(state, workspaceId).find((p) => p.id === providerId)
    : state.providerCatalog
      ? getItem(state.providerCatalog.providers, providerId)
      : undefined;

/** Canonical ID first, then only aliases explicitly advertised by the daemon. */
export const getResolvedProviderCatalogEntry = (
  state: ProviderReadState,
  providerId: string,
  workspaceId?: string,
): ProviderCatalogEntry | undefined => {
  const exact = getProviderCatalogEntry(state, providerId, workspaceId);
  if (exact || !providerId) return exact;
  return getProviderCatalogEntries(state, workspaceId).find((entry) =>
    entry.legacyAliases?.includes(providerId),
  );
};

/**
 * `getProviderConfig`-equivalent: the row for `providerId`, falling back to
 * the effective default provider's row when the id is unknown. `undefined`
 * before the first hydration, or for an unknown id while the effective
 * default is unresolved ('').
 */
export const getProviderCatalogEntryOrDefault = (
  state: ProviderReadState,
  providerId: string,
): ProviderCatalogEntry | undefined =>
  getProviderCatalogEntry(state, providerId) ??
  getProviderCatalogEntry(state, getEffectiveDefaultProviderId(state));

/**
 * `resolveProviderEnabled`-equivalent against the catalog: providers that
 * cannot be disabled are always enabled; every other provider defaults to
 * disabled when unset. Reads the persisted map from the providerSettings
 * slice. The `canBeDisabled` check uses the EXACT row (no default fallback)
 * so an unknown id cannot inherit another row's canBeDisabled:false.
 */
export const getProviderEnabledFromCatalog = (
  state: ProviderReadState,
  providerId: string,
): boolean => {
  const entry = getProviderCatalogEntry(state, providerId);
  if (entry?.canBeDisabled === false) return true;
  return state.providerSettings.enabledProviders[providerId] ?? false;
};

/**
 * Preserve unresolved identity on older daemons and before catalog hydration.
 * Settings defaults, row order and availability never determine alias identity.
 */
export const getNormalizedProviderId = (
  state: ProviderReadState,
  providerId: string,
  workspaceId?: string,
): string => getResolvedProviderCatalogEntry(state, providerId, workspaceId)?.id ?? providerId;

/**
 * Display name for a provider id, falling back to the raw id when the row
 * (or the catalog) is missing — safe for labels before hydration.
 */
export const getProviderDisplayName = (
  state: ProviderReadState,
  providerId: string,
  workspaceId?: string,
): string =>
  getResolvedProviderCatalogEntry(state, providerId, workspaceId)?.displayName ?? providerId;

/**
 * Whether a (legacy compound or bare) model id belongs to
 * `targetProviderId`; bare ids attribute to the effective default provider.
 */
export const getIsModelValidForProvider = (
  state: ProviderReadState,
  model: string,
  targetProviderId: string,
): boolean =>
  getNormalizedProviderId(
    state,
    splitLegacyCompoundId(model).providerId ?? getEffectiveDefaultProviderId(state),
  ) === getNormalizedProviderId(state, targetProviderId);

/**
 * `isProviderAuthenticationError`-equivalent: match an error message against
 * the provider's catalog `authErrorPatterns`. Unresolved explicit IDs do not
 * inherit authentication guidance from a different provider.
 */
export const getIsProviderAuthenticationError = (
  state: ProviderReadState,
  providerId: string,
  errorMessage: string,
): boolean =>
  isProviderAuthenticationErrorForEntry(
    getResolvedProviderCatalogEntry(state, providerId),
    errorMessage,
  );

/**
 * Login guidance for an agent failure: when `errorMessage` matches the
 * provider's catalog `authErrorPatterns`, return the actionable login
 * command (and the claude-code desktop-app caveat). The provider resolves
 * from the session's explicit provider id, else the compound model prefix,
 * else the effective default. Unresolved explicit identity stays unresolved. `null` when
 * there is no error or it is not an authentication failure.
 */
export const getProviderAuthFailureGuidance = (
  state: ProviderReadState,
  provider: string | null | undefined,
  model: string | null | undefined,
  errorMessage: string | null | undefined,
): ProviderAuthFailureGuidance | null => {
  if (!errorMessage || getIsHostMember(state)) return null;
  // Explicit identities, including historical aliases, resolve only through
  // the catalog. They must not borrow a different provider's login guidance.
  let rawId = provider || '';
  if (!rawId && model?.includes(':')) {
    rawId = splitLegacyCompoundId(model).providerId || '';
  }
  const entry = getResolvedProviderCatalogEntry(
    state,
    rawId || getEffectiveDefaultProviderId(state),
  );
  if (!isProviderAuthenticationErrorForEntry(entry, errorMessage)) return null;
  const providerId = entry?.id ?? rawId;
  return {
    providerId,
    loginCommandHint: entry?.loginCommandHint || `${entry?.command ?? providerId} login`,
    showClaudeDesktopNote: providerId === 'claude-code',
  };
};
