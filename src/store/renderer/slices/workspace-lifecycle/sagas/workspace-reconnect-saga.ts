import { buffers, eventChannel, type EventChannel } from 'redux-saga';
import { put, take, type SagaGenerator } from 'typed-redux-saga';

import { onBackendReconnected } from '$lib/client/live/backend-transport';
import { backendReconnected } from '../workspace-lifecycle-slice';

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
    }
  } finally {
    channel.close();
  }
}
