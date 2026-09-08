import { END, buffers, eventChannel, type EventChannel } from 'redux-saga';
import { call, put, take } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { selectActiveProviderId } from '../../provider-settings/provider-settings-selectors';
import { setAvailableModels, setLoadingStateForProvider } from '../model-slice';

const logger = createLogger('ModelBootSaga');

/**
 * Boot-time model catalog load for the active provider (the v2.19.0
 * misc-ui-events-seeder "Models" block, dropped in #584 without a saga
 * replacement). Without it `state.model.availableModels` stays empty until
 * the first provider switch dispatches `reloadModelsForProvider`, starving
 * catalog consumers such as `selectModelEffortLevels` / ModelPicker reasoning controls.
 *
 * The active provider is read from the slice when settings hydration has
 * already landed, otherwise from the daemon (`settings.getProviderSettings`)
 * so the load does not race the hydration saga. Seeder semantics are kept:
 * dispatch only on a non-empty catalog and stay silent on failure — the
 * reload saga owns loading/error transitions for explicit provider switches.
 *
 * Returns whether the catalog load is settled: `true` when models were
 * dispatched (or an explicit provider switch took ownership mid-flight),
 * `false` when nothing landed and a retry on the next backend connect could
 * still help.
 */
export function* loadModelsOnBootWorker() {
  try {
    let providerId = yield* selectActiveProviderId.effect();
    if (!providerId) {
      const providerSettings: Awaited<ReturnType<typeof appClient.settings.getProviderSettings>> =
        yield* call([appClient.settings, appClient.settings.getProviderSettings]);
      providerId = providerSettings?.activeProviderId ?? '';
    }
    if (!providerId) return false;

    const models: Awaited<ReturnType<typeof appClient.models.list>> = yield* call([
      appClient.models,
      appClient.models.list,
    ]);

    // Provider mismatch guard: if the active provider changed while the list
    // was in flight, the reload saga owns that provider's load — drop ours.
    const activeProviderId = yield* selectActiveProviderId.effect();
    if (activeProviderId && activeProviderId !== providerId) return true;
    if (models.length === 0) return false;

    yield* put(setAvailableModels(models, providerId));
    yield* put(setLoadingStateForProvider({ providerId, status: 'success', retryAttempt: 0 }));
    return true;
  } catch (error) {
    logger.warn('boot model catalog load failed; pickers will retry on demand', { error });
    return false;
  }
}

/** `backend:status` payload shape relevant to this saga (see backend.ipc.ts). */
interface BackendStatusPayload {
  status?: string;
  reconnected?: boolean;
}

/**
 * Backend `connected` events as a saga channel. Emits `{ reconnected }` for
 * every `backend:status` broadcast with `status: 'connected'` — the plain
 * event fires on the first successful connect (and on a backend switch), and
 * a distinct `reconnected: true` marker follows it on every true reconnect
 * (RESUB-1, see backend.ipc.ts). Filtering happens before buffering so other
 * status events can never displace a pending connect; the sliding(1) buffer
 * keeps only the latest signal, so a burst arriving while a load is in flight
 * coalesces into a single trailing re-run (and the reconnect marker, emitted
 * after the plain event it accompanies, wins the buffer slot).
 */
function createBackendConnectedChannel(): EventChannel<{ reconnected: boolean }> {
  return eventChannel<{ reconnected: boolean }>((emit) => {
    if (typeof window === 'undefined' || !window.electronAPI) {
      emit(END as never);
      return () => {};
    }
    const api = window.electronAPI;
    const listenerId = api.on(
      IPC_CHANNELS.BACKEND.STATUS,
      (payload: BackendStatusPayload | undefined) => {
        if (payload?.status !== 'connected') return;
        emit({ reconnected: payload.reconnected === true });
      },
    );
    return () => api.offById(IPC_CHANNELS.BACKEND.STATUS, listenerId);
  }, buffers.sliding(1));
}

/**
 * Boot-time load of the active provider's model catalog, kept converged with
 * the daemon connection (intent-hq/monorepo#1830):
 *
 * - On a plain `connected` (first successful connect, backend switch) the
 *   load is re-run only if the previous attempt did not land — a boot-time
 *   `models.list` that timed out while the daemon was still coming up would
 *   otherwise leave `availableModels` empty until the first explicit provider
 *   switch. A boot load that already succeeded is not redundantly re-fetched.
 * - On a `reconnected: true` marker the load always re-runs (RESUB-1): the
 *   reconnect may be to a different daemon with a different catalog.
 *
 * Loads are single-flight — the sequential take/call loop never overlaps two
 * fetches — with signals during a fetch coalesced by the sliding buffer.
 */
export function* modelBootSaga() {
  const connectedChannel = yield* call(createBackendConnectedChannel);
  try {
    let loaded = yield* call(loadModelsOnBootWorker);
    while (true) {
      const signal = yield* take(connectedChannel);
      if (signal === (END as unknown as { reconnected: boolean })) return;
      if (signal.reconnected || !loaded) {
        loaded = yield* call(loadModelsOnBootWorker);
      }
    }
  } finally {
    connectedChannel.close();
  }
}
