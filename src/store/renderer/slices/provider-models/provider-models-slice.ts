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
import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  upsertItem,
  createCollection,
  getItem,
  removeItem,
} from '@augmentcode/themis/utils/collections/collection-utils';
import type {
  ProviderModelsCacheEntry,
  ProviderModelsFetchResult,
  ProviderModelsRequest,
  ProviderModelsRequestMode,
  ProviderModelsObserver,
  ProviderModelsState,
} from './provider-models-types';

export const initialState: ProviderModelsState = {
  byProviderId: {},
  byWorkspaceId: {},
  requestsByWorkspaceId: {},
  clearEpoch: 0,
  requests: createCollection<ProviderModelsRequest, 'providerId'>('providerId'),
  observers: createCollection<ProviderModelsObserver, 'id'>('id'),
};

export const providerModelsObserved =
  createAction<[id: string, providerIds: string[], workspaceId?: string]>(
    'providerModels/observed',
  );
export const providerModelsReleased = createAction<[id: string]>('providerModels/released');
export const providerModelsRequested = createAction<
  [providerId: string, mode: ProviderModelsRequestMode, workspaceId?: string]
>('providerModels/requested');
export const providerModelsRequestStarted = createAction<[request: ProviderModelsRequest]>(
  'providerModels/requestStarted',
);
export const providerModelsRequestSettled = createAction<[request: ProviderModelsRequest]>(
  'providerModels/requestSettled',
);

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
  [providerId: string, result: ProviderModelsFetchResult, epoch: number, workspaceId?: string],
  [providerId: string, entry: ProviderModelsCacheEntry, epoch: number, workspaceId?: string]
>('providerModels/providerModelsLoaded', (providerId, result, epoch, workspaceId) => [
  providerId,
  { ...result, fetchedAt: new Date().toISOString() },
  epoch,
  workspaceId,
]);

/**
 * Drop every cached entry and bump `clearEpoch`. Dispatched on backend
 * reconnect: the new daemon may serve different adapters/catalogs, so cached
 * rows are no longer trustworthy and providers fall back to honest loading
 * states. The epoch bump invalidates in-flight writes issued before the clear.
 */
export const providerModelsCacheCleared = createAction('providerModels/providerModelsCacheCleared');

export const providerModelsReducer = createReducer<ProviderModelsState>(initialState);

providerModelsReducer.with(
  providerModelsLoaded,
  (state, { payload: [providerId, entry, epoch, workspaceId] }) => {
    if (epoch !== state.clearEpoch) return state;
    const requests = workspaceId ? state.requestsByWorkspaceId?.[workspaceId] : state.requests;
    const request = requests && getItem(requests, providerId);
    const recovered = request?.error
      ? upsertItem(requests!, { ...request, error: undefined })
      : requests;
    if (workspaceId)
      return {
        ...state,
        byWorkspaceId: {
          ...state.byWorkspaceId,
          [workspaceId]: { ...state.byWorkspaceId?.[workspaceId], [providerId]: entry },
        },
        ...(recovered && {
          requestsByWorkspaceId: { ...state.requestsByWorkspaceId, [workspaceId]: recovered },
        }),
      };
    return {
      ...state,
      byProviderId: {
        ...state.byProviderId,
        [providerId]: entry,
      },
      requests: recovered ?? state.requests,
    };
  },
);
providerModelsReducer.with(providerModelsCacheCleared, (state) => ({
  ...state,
  byProviderId: {},
  byWorkspaceId: {},
  requestsByWorkspaceId: {},
  requests: createCollection<ProviderModelsRequest, 'providerId'>('providerId'),
  clearEpoch: state.clearEpoch + 1,
}));

providerModelsReducer.with(
  providerModelsObserved,
  (state, { payload: [id, providerIds, workspaceId] }) => {
    const previous = getItem(state.observers, id);
    if (
      previous?.workspaceId === workspaceId &&
      previous?.providerIds.join('\0') === providerIds.join('\0')
    )
      return state;
    return { ...state, observers: upsertItem(state.observers, { id, providerIds, workspaceId }) };
  },
);
providerModelsReducer.with(providerModelsReleased, (state, { payload: [id] }) => {
  if (!getItem(state.observers, id)) return state;
  return { ...state, observers: removeItem(state.observers, id) };
});
providerModelsReducer.with(providerModelsRequestStarted, (state, { payload: [request] }) => {
  if (request.epoch !== state.clearEpoch) return state;
  const { workspaceId } = request;
  const requests = workspaceId
    ? (state.requestsByWorkspaceId?.[workspaceId] ??
      createCollection<ProviderModelsRequest, 'providerId'>('providerId'))
    : state.requests;
  const previous = getItem(requests, request.providerId);
  const next = upsertItem(requests, {
    ...request,
    error: request.mode === 'silentRetry' ? previous?.error : undefined,
  });
  return {
    ...state,
    ...(workspaceId
      ? { requestsByWorkspaceId: { ...state.requestsByWorkspaceId, [workspaceId]: next } }
      : { requests: next }),
  };
});
providerModelsReducer.with(providerModelsRequestSettled, (state, { payload: [request] }) => {
  const { workspaceId } = request;
  const requests = workspaceId ? state.requestsByWorkspaceId?.[workspaceId] : state.requests;
  const current = requests && getItem(requests, request.providerId);
  if (request.epoch !== state.clearEpoch || current?.requestId !== request.requestId) return state;
  const next = upsertItem(requests!, {
    ...request,
    // Silent failures/empty results only toast. Keep the prior actionable
    // failure until providerModelsLoaded supplies an actual catalog.
    error: request.mode === 'silentRetry' ? current.error : request.error,
  });
  return {
    ...state,
    ...(workspaceId
      ? { requestsByWorkspaceId: { ...state.requestsByWorkspaceId, [workspaceId]: next } }
      : { requests: next }),
  };
});
