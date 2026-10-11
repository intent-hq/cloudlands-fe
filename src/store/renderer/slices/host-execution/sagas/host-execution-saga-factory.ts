import { buffers } from 'redux-saga';
import { actionChannel, all, call, delay, put, race, take } from 'typed-redux-saga';
import { takeLatestFromSelector, type SelectorChannelPayload } from '@themislib/themis/saga';
import { isDaemonErrorResponse } from '$lib/client/live/backend-transport-types';
import { hostExecutionContextSchema } from '$shared/types/host-execution';
import type { HostRole } from '$shared/types/principal';
import {
  hostExecutionConnectionChanged,
  hostExecutionInvalidated,
  hostExecutionReceived,
} from '../host-execution-slice';
import { checkAllProvidersRequested } from '../../agent-availability/agent-availability-slice';

import type { BackendTransport } from '$lib/client/live/backend-transport-types';
import type { SelectorChannelSelector } from '@themislib/themis/saga';
import type { SagaGenerator } from 'typed-redux-saga';

export function createHostExecutionSaga<State>({
  backendRequest,
  selectHostRole,
  selectPrincipalConnectionContext,
  selectHostExecutionReadContext,
  hostExecutionGenerationEffect,
  resetSettingsConnectionCache,
  invalidateProviderAuthStatus,
  hydrateProviderCatalog,
}: {
  backendRequest: BackendTransport['request'];
  selectHostRole: SelectorChannelSelector<HostRole | null, [], State>;
  selectPrincipalConnectionContext: SelectorChannelSelector<string | null, [], State>;
  selectHostExecutionReadContext: SelectorChannelSelector<string | null, [], State>;
  hostExecutionGenerationEffect: () => SagaGenerator<number>;
  resetSettingsConnectionCache: () => void;
  invalidateProviderAuthStatus: () => void;
  hydrateProviderCatalog: () => SagaGenerator<void>;
}) {
  function* bindConnection({ payload: connection }: SelectorChannelPayload<string | null>) {
    yield* call(resetSettingsConnectionCache);
    yield* put(hostExecutionConnectionChanged(connection));
    yield* call(invalidateProviderAuthStatus);
    if (connection) {
      yield* call(hydrateProviderCatalog);
      yield* put(checkAllProvidersRequested());
    }
  }

  /** Cancelling on authority/connection changes fences replies, including same-host reconnects. */
  function* hydrate({ payload: connection }: SelectorChannelPayload<string | null>) {
    if (!connection) return;
    const triggers = yield* actionChannel(hostExecutionInvalidated, buffers.sliding(1));
    try {
      while (true) {
        const generation = yield* hostExecutionGenerationEffect();
        try {
          const result = yield* call(backendRequest<unknown>, 'host.executionContext', {});
          const parsed = hostExecutionContextSchema.parse(result);
          yield* put(hostExecutionReceived(connection, generation, parsed));
        } catch (error) {
          if (!isDaemonErrorResponse(error)) {
            yield* race({ retry: delay(5_000), invalidated: take(triggers) });
            continue;
          }
        }
        yield* take(triggers);
        yield* call(invalidateProviderAuthStatus);
        yield* call(hydrateProviderCatalog);
        yield* put(checkAllProvidersRequested());
      }
    } finally {
      triggers.close();
    }
  }

  return function* hostExecutionSaga() {
    yield* all([
      call(takeLatestFromSelector, selectPrincipalConnectionContext, bindConnection),
      call(takeLatestFromSelector, selectHostExecutionReadContext, hydrate),
      call(
        takeLatestFromSelector,
        selectHostRole,
        function* ({ payload }: SelectorChannelPayload<HostRole | null>) {
          // Connection binding can precede admission; retry discovery once the role is known.
          if (payload === 'owner' || payload === 'member') yield* put(checkAllProvidersRequested());
        },
      ),
    ]);
  };
}
