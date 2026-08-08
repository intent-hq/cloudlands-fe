/**
 * Provider Models Cache Slice
 *
 * Session-lifetime, renderer-global cache of per-provider model catalogs so
 * the model picker can render cached providers synchronously on remount
 * (stale-while-revalidate) instead of re-running N daemon round trips on
 * every workspace switch. Written through by the picker's fetch paths on
 * successful `getModelsForProviderForLoadingState` results; cleared on
 * backend reconnect by the provider-models seeder (RESUB-1 idiom — a daemon
 * restart may have changed adapters/catalogs).
 */
import { createAction } from '$lib/store-shim/utils/store/create-action';
import { createReducer } from '$lib/store-shim/utils/store/create-reducer';
import type {
  ProviderModelsCacheEntry,
  ProviderModelsFetchResult,
  ProviderModelsState,
} from './provider-models-types';

export const initialState: ProviderModelsState = {
  byProviderId: {},
  clearEpoch: 0,
};

/**
 * A provider's catalog fetch succeeded — cache the dropdown-ready result
 * under its NORMALIZED provider id (callers normalize via
 * `selectNormalizedProviderId`). The payload modifier stamps `fetchedAt`
 * at dispatch time so the reducer stays deterministic.
 *
 * `epoch` is the `clearEpoch` the caller read when its fetch STARTED
 * (`selectProviderModelsClearEpoch`); the reducer drops the write when it no
 * longer matches — a reconnect clear happened while the response was in
 * flight, so the rows came from the pre-restart daemon.
 */
export const providerModelsLoaded = createAction<
  [providerId: string, result: ProviderModelsFetchResult, epoch: number],
  [providerId: string, entry: ProviderModelsCacheEntry, epoch: number]
>('providerModels/providerModelsLoaded', (providerId, result, epoch) => [
  providerId,
  { ...result, fetchedAt: new Date().toISOString() },
  epoch,
]);

/**
 * Drop every cached entry and bump `clearEpoch`. Dispatched on backend
 * reconnect: the new daemon may serve different adapters/catalogs, so cached
 * rows are no longer trustworthy and providers fall back to honest loading
 * states. The epoch bump invalidates in-flight writes issued before the clear.
 */
export const providerModelsCacheCleared = createAction('providerModels/providerModelsCacheCleared');

export const providerModelsReducer = createReducer<ProviderModelsState>(initialState)
  .with(providerModelsLoaded, (state, { payload: [providerId, entry, epoch] }) =>
    epoch !== state.clearEpoch
      ? state
      : {
          ...state,
          byProviderId: {
            ...state.byProviderId,
            [providerId]: entry,
          },
        },
  )
  .with(providerModelsCacheCleared, (state) => ({
    byProviderId: {},
    clearEpoch: state.clearEpoch + 1,
  }));
