import { call } from 'typed-redux-saga';

import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';

export function* activeStreamsSaga() {
  try {
    yield* call([activeStreamsTracker, activeStreamsTracker.startPolling]);
    yield* call(() => new Promise<never>(() => {}));
  } finally {
    yield* call([activeStreamsTracker, activeStreamsTracker.stopPolling]);
  }
}
