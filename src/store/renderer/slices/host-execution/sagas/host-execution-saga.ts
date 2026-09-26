import { buffers } from 'redux-saga';
import { actionChannel, all, call, delay, put, race, take } from 'typed-redux-saga';
import { takeLatestFromSelector, type SelectorChannelPayload } from '@augmentcode/themis/saga';
import { backendRequest } from '$lib/client/live/backend-transport';
import { isDaemonErrorResponse } from '$lib/client/live/backend-transport-types';
import { hostExecutionContextSchema } from '$shared/types/host-execution';
import { invalidateProviderAuthStatus } from '$features/providers/provider-auth-status.client';
import { resetSettingsConnectionCache } from '$lib/client/live/live-settings-client';
import { selectPrincipalConnectionContext } from '../../principal/principal-selectors';
import {
  selectHostExecutionReadContext,
  selectHostExecutionGeneration,
} from '../host-execution-selectors';
import {
  hostExecutionConnectionChanged,
  hostExecutionInvalidated,
  hostExecutionReceived,
} from '../host-execution-slice';
import { hydrateProviderCatalog } from '../../provider-catalog/sagas/provider-catalog-saga';
import { checkAllProvidersRequested } from '../../agent-availability/agent-availability-slice';

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
      const generation = yield* selectHostExecutionGeneration.effect();
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

export function* hostExecutionSaga() {
  yield* all([
    call(takeLatestFromSelector, selectPrincipalConnectionContext, bindConnection),
    call(takeLatestFromSelector, selectHostExecutionReadContext, hydrate),
  ]);
}
