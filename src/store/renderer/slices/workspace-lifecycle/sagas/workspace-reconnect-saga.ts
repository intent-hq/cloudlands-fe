import { buffers, eventChannel, type EventChannel } from 'redux-saga';
import { put, select, take, type SagaGenerator } from 'typed-redux-saga';

import { onBackendReconnected } from '$lib/client/live/backend-transport';
import { selectCurrentWorkspaceTabId } from '../../tab-state/tab-state-selectors';
import { selectWorkspaceLoadState } from '../workspace-lifecycle-selectors';
import { backendReconnected, workspaceLoadRequested } from '../workspace-lifecycle-slice';

function createReconnectChannel(): EventChannel<true> {
  return eventChannel<true>((emit) => onBackendReconnected(() => emit(true)), buffers.sliding(1));
}

/**
 * Bridges transport-level backend reconnects (daemon restart or connection
 * recovery) into `backendReconnected`, which clears every warm session phase
 * so revisits take the cold path instead of the warm skip (monorepo#3788).
 */
export function* workspaceReconnectSaga(): SagaGenerator<void> {
  const channel = createReconnectChannel();
  try {
    while (true) {
      yield* take(channel);
      yield* put(backendReconnected());
      const workspaceId = yield* select(selectCurrentWorkspaceTabId.select);
      if (!workspaceId) continue;
      const load = yield* select(selectWorkspaceLoadState.select, workspaceId);
      // A failed initial open has no live session to invalidate. Retry the
      // selected tab, including a cached view whose open failed, through the
      // existing load owner so concurrent loads remain single-flight.
      if (load.status === 'error' || load.status === 'cached-ready') {
        yield* put(workspaceLoadRequested(workspaceId));
      }
    }
  } finally {
    channel.close();
  }
}
