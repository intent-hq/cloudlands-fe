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
import type { LearnedModelNames } from './model-name-cache';
import type { AuggieModel } from '$features/auggie/auggie-models.client';
import type { ModelReplyLabels } from '../model/model-types';
import type { Collection } from '@themislib/themis/utils/collections/collection-utils';

export type ProviderModelsRequestMode = 'background' | 'refresh' | 'retry' | 'silentRetry';

export interface ProviderModelsRequest {
  providerId: string;
  workspaceId?: string;
  requestId: string;
  epoch: number;
  mode: ProviderModelsRequestMode;
  status: 'loading' | 'success' | 'error' | 'cancelled';
  /** Last actionable load failure; silent retries retain it until a catalog is cached. */
  error?: string;
}

export interface ProviderModelsObserver {
  id: string;
  providerIds: string[];
  workspaceId?: string;
}

/**
 * Successful `getModelsForProviderForLoadingState`-shaped fetch result: the
 * reply's labels (`ModelReplyLabels`) plus the dropdown-ready rows.
 */
export type ProviderModelsFetchResult = ModelReplyLabels & {
  models: AuggieModel[];
};

/** One cached catalog: the fetch result plus its write timestamp. */
export interface ProviderModelsCacheEntry extends ProviderModelsFetchResult {
  /** ISO timestamp stamped by the action creator when the entry was cached. */
  fetchedAt: string;
}

export interface ProviderModelsState {
  /** Persistent display-only labels, retained across catalog invalidation. */
  learnedNames: LearnedModelNames;
  /** Cached entries keyed by normalized provider id. */
  byProviderId: Record<string, ProviderModelsCacheEntry>;
  byWorkspaceId?: Record<string, Record<string, ProviderModelsCacheEntry>>;
  requests: Collection<ProviderModelsRequest, 'providerId'>;
  requestsByWorkspaceId?: Record<string, Collection<ProviderModelsRequest, 'providerId'>>;
  observers: Collection<ProviderModelsObserver, 'id'>;
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
