/**
 * Provider Models Cache Types
 *
 * Session-lifetime cache of per-provider model catalogs (`models.list`,
 * PROTOCOL §6.7) as already shaped for the picker by
 * `getModelsForProviderForLoadingState` (dropdown-ready `AuggieModel` rows,
 * compound-prefixed for non-default providers). Keyed by NORMALIZED provider
 * id — dispatchers normalize via `selectNormalizedProviderId` before writing;
 * the reducer stores keys verbatim.
 *
 * This is a read-through view of daemon responses (never an alternative
 * source of truth): entries are written on successful fetches and the whole
 * map is dropped on backend reconnect, when a restarted daemon may serve
 * different adapters/catalogs.
 */
import type { AuggieModel } from '$features/auggie/auggie-models.client';

/** Successful `getModelsForProviderForLoadingState`-shaped fetch result. */
export interface ProviderModelsFetchResult {
  /** Dropdown-ready rows (compound-prefixed for non-default providers). */
  models: AuggieModel[];
  /** Daemon-provided reason for fallback/stale/empty data (PROTOCOL §6.7). */
  warning?: string;
  /** True when the daemon served last-good data after a failed probe. */
  stale?: boolean;
}

/** One cached catalog: the fetch result plus its write timestamp. */
export interface ProviderModelsCacheEntry extends ProviderModelsFetchResult {
  /** ISO timestamp stamped by the action creator when the entry was cached. */
  fetchedAt: string;
}

export interface ProviderModelsState {
  /** Cached entries keyed by normalized provider id. */
  byProviderId: Record<string, ProviderModelsCacheEntry>;
  /**
   * Monotonic clear counter, bumped by `providerModelsCacheCleared`. Writers
   * capture it (via `selectProviderModelsClearEpoch`) when their fetch STARTS
   * and stamp it into `providerModelsLoaded`; the reducer drops writes whose
   * epoch predates the latest clear, so a response issued against a
   * pre-reconnect daemon that settles after the clear cannot re-pollute the
   * just-cleared cache.
   */
  clearEpoch: number;
}
