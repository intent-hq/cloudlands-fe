import { call, join, takeEvery } from 'typed-redux-saga';

import { eventReceived } from '../../workspace-events/workspace-events-slice';

import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';

export function* activeStreamsSaga() {
  try {
    yield* call([activeStreamsTracker, activeStreamsTracker.startPolling]);
    const watcher = yield* takeEvery(
      eventReceived,
      function* (action: ReturnType<typeof eventReceived>) {
        yield* call([activeStreamsTracker, activeStreamsTracker.applyEvent], action.payload[1]);
      },
    );
    yield* join(watcher);
  } finally {
    yield* call([activeStreamsTracker, activeStreamsTracker.stopPolling]);
  }
}
