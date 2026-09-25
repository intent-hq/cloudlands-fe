import { channel } from 'redux-saga';
import { call, cancelled, delay, join, put, takeEvery, takeLatest } from 'typed-redux-saga';
import { notify } from '$lib/components/patterns/notify';
import { m } from '$shared/paraglide/messages.js';
import { getModelsForProvider, getModelsForProviderForLoadingState } from '../../model/model-utils';
import { setLoadingStateForProvider } from '../../model/model-slice';
import {
  selectNormalizedProviderId,
  selectProviderDisplayName,
} from '../../provider-catalog/provider-catalog-selectors';
import {
  selectObservedModelProviderIds,
  selectProviderModelsClearEpoch,
} from '../provider-models-selectors';
import {
  providerModelsCacheCleared,
  providerModelsLoaded,
  providerModelsObserved,
  providerModelsReleased,
  providerModelsRequested,
  providerModelsRequestStarted,
  providerModelsRequestSettled,
} from '../provider-models-slice';
import type { ProviderModelsRequest, ProviderModelsRequestMode } from '../provider-models-types';
import { takeLatestInContext } from '../../../utils/context-saga-effects';

type CatalogRead = { providerId: string; mode: ProviderModelsRequestMode | null };

/** One catalog coordinator, composed by the registered modelReloadSaga. */
export function* providerModelsSaga() {
  // Coalescing metadata only; the shared keyed watcher owns task lifetime.
  const flights = new Map<string, { mode: ProviderModelsRequestMode; invalidated: boolean }>();
  const reads = channel<CatalogRead>();

  function* load({ providerId, mode }: CatalogRead) {
    if (mode === null) return;
    const flight = { mode, invalidated: false };
    flights.set(providerId, flight);
    try {
      do {
        flight.invalidated = false;
        const request: ProviderModelsRequest = {
          providerId,
          requestId: crypto.randomUUID(),
          epoch: yield* selectProviderModelsClearEpoch.effect(),
          mode: flight.mode,
          status: 'loading',
        };
        yield* put(providerModelsRequestStarted(request));
        try {
          const result =
            request.mode === 'silentRetry'
              ? { models: yield* call(getModelsForProvider, providerId) }
              : request.mode === 'refresh'
                ? yield* call(getModelsForProviderForLoadingState, providerId, {
                    forceRefresh: true,
                  })
                : yield* call(getModelsForProviderForLoadingState, providerId);
          if ((yield* selectProviderModelsClearEpoch.effect()) !== request.epoch) continue;
          if (request.mode !== 'silentRetry' || result.models.length > 0) {
            yield* put(providerModelsLoaded(providerId, result, request.epoch));
          }
          if (request.mode !== 'silentRetry') {
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
            yield* call(warnNoModels, providerId);
        } catch (error) {
          if ((yield* selectProviderModelsClearEpoch.effect()) !== request.epoch) continue;
          const message = error instanceof Error ? error.message : String(error);
          yield* put(providerModelsRequestSettled({ ...request, status: 'error', error: message }));
          if (request.mode === 'silentRetry') {
            yield* call(warnNoModels, providerId);
          } else {
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
      if (flights.get(providerId) === flight) flights.delete(providerId);
    }
  }

  function* warnNoModels(providerId: string) {
    const provider = yield* selectProviderDisplayName.effect(providerId);
    yield* call(notify.warning, m.chat_modelPicker_noModelsForProvider_toast({ provider }), {
      description: m.chat_modelPicker_tryRefreshing_description(),
    });
  }

  function* request(providerId: string, mode: ProviderModelsRequestMode) {
    providerId = yield* selectNormalizedProviderId.effect(providerId);
    const previous = flights.get(providerId);
    if (previous) {
      // Background membership changes join a forced probe; they cannot replace
      // it with stale cached data. Repeated refresh clicks also join that probe.
      if (mode === 'background' || previous.mode === 'refresh') return;
    }
    yield* put(reads, { providerId, mode });
  }

  function* prune() {
    const observed = yield* selectObservedModelProviderIds.effect();
    for (const providerId of flights.keys()) {
      if (!observed.includes(providerId)) yield* put(reads, { providerId, mode: null });
    }
  }

  try {
    const watcher = yield* takeLatestInContext(reads, ({ providerId }) => providerId, load);
    yield* takeEvery(providerModelsRequested, function* ({ payload: [providerId, mode] }) {
      yield* call(request, providerId, mode);
    });
    yield* takeLatest([providerModelsObserved, providerModelsReleased], function* () {
      yield* call(prune);
      // Keep the existing 50ms membership debounce, owned by the saga lifetime.
      yield* delay(50);
      for (const providerId of yield* selectObservedModelProviderIds.effect())
        yield* put(providerModelsRequested(providerId, 'background'));
    });
    yield* takeEvery(providerModelsCacheCleared, function* () {
      for (const providerId of yield* selectObservedModelProviderIds.effect()) {
        const flight = flights.get(providerId);
        // A burst of backend/config invalidations never overlaps model RPCs:
        // discard the old epoch and run one trailing request after it settles.
        if (flight) flight.invalidated = true;
        else yield* put(providerModelsRequested(providerId, 'background'));
      }
    });
    yield* join(watcher);
  } finally {
    reads.close();
    flights.clear();
  }
}
