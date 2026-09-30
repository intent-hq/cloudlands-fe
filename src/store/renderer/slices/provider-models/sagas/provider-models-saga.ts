import { takeLatestFromSelector } from '@themislib/themis/saga';
import { channel } from 'redux-saga';
import { call, cancelled, delay, join, put, takeEvery } from 'typed-redux-saga';
import { notify } from '$lib/components/patterns/notify';
import { m } from '$shared/paraglide/messages.js';
import { getModelsForProvider, getModelsForProviderForLoadingState } from '../../model/model-utils';
import { setLoadingStateForProvider } from '../../model/model-slice';
import {
  selectNormalizedProviderId,
  selectProviderDisplayName,
} from '../../provider-catalog/provider-catalog-selectors';
import {
  selectObservedModelProviders,
  selectObservedModelProviderKeys,
  selectProviderModelsCacheEntry,
  selectProviderModelsClearEpoch,
  selectProviderModelsRequests,
} from '../provider-models-selectors';
import {
  providerModelsCacheCleared,
  providerModelsLoaded,
  providerModelsRequested,
  providerModelsRequestStarted,
  providerModelsRequestSettled,
} from '../provider-models-slice';
import type { ProviderModelsRequest, ProviderModelsRequestMode } from '../provider-models-types';
import { takeLatestInContext } from '../../../utils/context-saga-effects';
import { providerModelsContextKey } from '../provider-models-utils';
import { hostExecutionInvalidated } from '../../host-execution/host-execution-slice';

type CatalogRead = {
  providerId: string;
  workspaceId?: string;
  mode: ProviderModelsRequestMode | null;
};

/** One catalog coordinator, composed by the registered modelReloadSaga. */
export function* providerModelsSaga() {
  // Coalescing metadata only; the shared keyed watcher owns task lifetime.
  const flights = new Map<
    string,
    {
      providerId: string;
      workspaceId?: string;
      mode: ProviderModelsRequestMode;
      invalidated: boolean;
    }
  >();
  const reads = channel<CatalogRead>();
  // Pending debounce admissions, not catalog state. Retain additions across
  // membership bursts, and remember which request existed when each arrived.
  const pendingObservations = new Map<
    string,
    { providerId: string; workspaceId?: string; requestId?: string }
  >();

  function* load({ providerId, workspaceId, mode }: CatalogRead) {
    if (mode === null) return;
    const key = providerModelsContextKey(providerId, workspaceId);
    const flight = { providerId, workspaceId, mode, invalidated: false };
    flights.set(key, flight);
    try {
      do {
        flight.invalidated = false;
        const request: ProviderModelsRequest = {
          providerId,
          workspaceId,
          requestId: crypto.randomUUID(),
          epoch: yield* selectProviderModelsClearEpoch.effect(),
          mode: flight.mode,
          status: 'loading',
        };
        yield* put(providerModelsRequestStarted(request));
        try {
          const result =
            request.mode === 'silentRetry'
              ? {
                  models: yield* call(
                    getModelsForProvider,
                    providerId,
                    ...(workspaceId ? [workspaceId] : []),
                  ),
                }
              : request.mode === 'refresh'
                ? yield* call(getModelsForProviderForLoadingState, providerId, {
                    forceRefresh: true,
                    ...(workspaceId ? { workspaceId } : {}),
                  })
                : yield* call(
                    getModelsForProviderForLoadingState,
                    providerId,
                    ...(workspaceId ? [{ workspaceId }] : []),
                  );
          if ((yield* selectProviderModelsClearEpoch.effect()) !== request.epoch) continue;
          if (request.mode !== 'silentRetry' || result.models.length > 0) {
            yield* put(providerModelsLoaded(providerId, result, request.epoch, workspaceId));
          }
          if (!workspaceId && (request.mode !== 'silentRetry' || result.models.length > 0)) {
            yield* put(
              setLoadingStateForProvider({
                providerId,
                status: 'success',
                warning: result.warning,
                stale: result.stale,
              }),
            );
          }
          yield* put(providerModelsRequestSettled({ ...request, status: 'success' }));
          if (request.mode === 'silentRetry' && result.models.length === 0)
            yield* call(warnNoModels, providerId, workspaceId);
        } catch (error) {
          if ((yield* selectProviderModelsClearEpoch.effect()) !== request.epoch) continue;
          const message = error instanceof Error ? error.message : String(error);
          yield* put(providerModelsRequestSettled({ ...request, status: 'error', error: message }));
          if (request.mode === 'silentRetry') {
            yield* call(warnNoModels, providerId, workspaceId);
          } else if (!workspaceId) {
            yield* put(setLoadingStateForProvider({ providerId, status: 'error', error: message }));
          }
        } finally {
          if (yield* cancelled())
            yield* put(providerModelsRequestSettled({ ...request, status: 'cancelled' }));
          if (flight.invalidated) flight.mode = 'background';
        }
        flight.mode = 'background';
      } while (flight.invalidated);
    } finally {
      if (flights.get(key) === flight) flights.delete(key);
    }
  }

  function* warnNoModels(providerId: string, workspaceId?: string) {
    const provider = yield* selectProviderDisplayName.effect(providerId, workspaceId);
    yield* call(notify.warning, m.chat_modelPicker_noModelsForProvider_toast({ provider }), {
      description: m.chat_modelPicker_tryRefreshing_description(),
    });
  }

  function* request(providerId: string, mode: ProviderModelsRequestMode, workspaceId?: string) {
    providerId = yield* selectNormalizedProviderId.effect(providerId, workspaceId);
    const previous = flights.get(providerModelsContextKey(providerId, workspaceId));
    if (previous) {
      // Background membership changes join a forced probe; they cannot replace
      // it with stale cached data. Repeated refresh clicks also join that probe.
      if (mode === 'background' || previous.mode === 'refresh') return;
    }
    yield* put(reads, { providerId, workspaceId, mode });
  }

  function* prune() {
    const observed = yield* selectObservedModelProviders.effect();
    for (const [key, { providerId, workspaceId }] of flights) {
      if (!observed[key]) yield* put(reads, { providerId, workspaceId, mode: null });
    }
  }

  try {
    const watcher = yield* takeLatestInContext(
      reads,
      ({ providerId, workspaceId }) => providerModelsContextKey(providerId, workspaceId),
      load,
    );
    yield* takeEvery(
      providerModelsRequested,
      function* ({ payload: [providerId, mode, workspaceId] }) {
        yield* call(request, providerId, mode, workspaceId);
      },
    );
    yield* takeLatestFromSelector(selectObservedModelProviderKeys, function* ({ prevPayload }) {
      yield* call(prune);
      const observed = yield* selectObservedModelProviders.effect();
      for (const key of pendingObservations.keys()) {
        if (!observed[key]) pendingObservations.delete(key);
      }
      for (const [key, { providerId, workspaceId }] of Object.entries(observed)) {
        const requests = yield* selectProviderModelsRequests.effect(workspaceId);
        if (!prevPayload?.includes(key) && requests[providerId]?.status !== 'loading') {
          pendingObservations.set(key, {
            providerId,
            workspaceId,
            requestId: requests[providerId]?.requestId,
          });
        }
      }
      // Keep the existing 50ms membership debounce, owned by the saga lifetime.
      yield* delay(50);
      for (const [
        key,
        { providerId, workspaceId, requestId: previousRequestId },
      ] of pendingObservations) {
        pendingObservations.delete(key);
        const cached = yield* selectProviderModelsCacheEntry.effect(providerId, workspaceId);
        const current = (yield* selectProviderModelsRequests.effect(workspaceId))[providerId];
        // A cached (even empty) catalog needs no membership-driven fetch.
        // Explicit retries/invalidations during the debounce already handled
        // this admission, including failures that must remain actionable.
        if (!cached && current?.requestId === previousRequestId) {
          yield* put(providerModelsRequested(providerId, 'background', workspaceId));
        }
      }
    });
    yield* takeEvery([providerModelsCacheCleared, hostExecutionInvalidated], function* () {
      for (const [key, { providerId, workspaceId }] of Object.entries(
        yield* selectObservedModelProviders.effect(),
      )) {
        const flight = flights.get(key);
        // A burst of backend/config invalidations never overlaps model RPCs:
        // discard the old epoch and run one trailing request after it settles.
        if (flight) flight.invalidated = true;
        else yield* put(providerModelsRequested(providerId, 'background', workspaceId));
      }
    });
    yield* join(watcher);
  } finally {
    reads.close();
    flights.clear();
    pendingObservations.clear();
  }
}
