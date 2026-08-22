import { END, buffers, eventChannel, type EventChannel } from 'redux-saga';
import { call, put, take } from 'typed-redux-saga';

import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
import { bumpActiveStreamsVersion } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';

function createActiveStreamsChannel(): EventChannel<boolean> {
  return eventChannel<boolean>(
    (emit) => activeStreamsTracker.subscribe(() => emit(true)),
    buffers.sliding<boolean>(1),
  );
}

export function* activeStreamsSaga() {
  const channel = createActiveStreamsChannel();
  try {
    yield* call([activeStreamsTracker, activeStreamsTracker.startPolling]);
    while (true) {
      const changed: boolean = yield* take(channel);
      if (changed === (END as unknown as boolean)) break;
      yield* put(bumpActiveStreamsVersion());
    }
  } finally {
    channel.close();
    yield* call([activeStreamsTracker, activeStreamsTracker.stopPolling]);
  }
}
