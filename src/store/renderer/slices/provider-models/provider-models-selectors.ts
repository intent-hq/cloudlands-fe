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
import type { ProviderModelsCacheEntry } from './provider-models-types';

/**
 * The full cache map keyed by normalized provider id. `{}` before any fetch
 * lands (fresh session / after a reconnect clear).
 */
export const selectProviderModelsCacheMap = store.createSelector(
  (state): Record<string, ProviderModelsCacheEntry> => state.providerModels?.byProviderId ?? {},
);

/**
 * One provider's cached catalog; `undefined` on a cache miss (never fetched
 * this session, or the cache was cleared on reconnect).
 */
export const selectProviderModelsCacheEntry = store.createSelector(
  (state, providerId: string): ProviderModelsCacheEntry | undefined =>
    state.providerModels?.byProviderId[providerId],
);
