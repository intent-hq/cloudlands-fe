/**
 * Provider Models Cache Selectors
 *
 * Read surface over the session-lifetime per-provider model-catalog cache.
 * Lookups are EXACT key reads by normalized provider id — no default-provider
 * fallback healing (an unknown id must read as a cache miss, never another
 * provider's rows). Callers normalize ids via `selectNormalizedProviderId`
 * before reading, mirroring how entries are written.
 */
import { store } from '../../store';
import type { ProviderModelsCacheEntry, ProviderModelsRequest } from './provider-models-types';

/**
 * The full cache map keyed by normalized provider id. `{}` before any fetch
 * lands (fresh session / after a reconnect clear).
 */
export const selectProviderModelsCacheMap = store.createSelector(
  (state, workspaceId?: string): Record<string, ProviderModelsCacheEntry> =>
    (workspaceId
      ? state.providerModels?.byWorkspaceId?.[workspaceId]
      : state.providerModels?.byProviderId) ?? {},
);

/**
 * One provider's cached catalog; `undefined` on a cache miss (never fetched
 * this session, or the cache was cleared on reconnect).
 *
 * Workspace pickers also read warning/stale fields from their own entries.
 * Direct pickers retain the global loading-state slice. The fields are
 * stored verbatim per the fetch-result contract.
 */
export const selectProviderModelsCacheEntry = store.createSelector(
  (state, providerId: string, workspaceId?: string): ProviderModelsCacheEntry | undefined =>
    selectProviderModelsCacheMap.select(state, workspaceId)[providerId],
);

/**
 * The current clear epoch. Writers read this when their fetch STARTS and
 * stamp it into `providerModelsLoaded`; the reducer drops writes stamped
 * with a pre-clear epoch (a reconnect happened while the response was in
 * flight).
 */
export const selectProviderModelsClearEpoch = store.createSelector(
  (state): number => state.providerModels?.clearEpoch ?? 0,
);

export const selectProviderModelsRequests = store.createSelector(
  (state): Record<string, ProviderModelsRequest> => state.providerModels?.requests?.map ?? {},
);

export const selectObservedModelProviderIds = store.createSelector((state): string[] => [
  ...new Set(
    Object.values(state.providerModels?.observers?.map ?? {}).flatMap(
      (observer) => observer.providerIds,
    ),
  ),
]);
