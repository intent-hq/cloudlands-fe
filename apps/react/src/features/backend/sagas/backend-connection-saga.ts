import { buffers, eventChannel } from 'redux-saga';
import { call, put, take } from 'typed-redux-saga';
import { connectionStatusChanged } from '../../../../../../src/store/renderer/slices/daemon-health/daemon-health-slice';
import { onBackendConnectionStatus, type BackendConnectionStatus } from '../backend-connection';

/** Root starts once after Store.init; cancellation removes the real status listener. */
export function* backendConnectionSaga() {
  const channel = yield* call(() =>
    eventChannel<BackendConnectionStatus>(onBackendConnectionStatus, buffers.expanding()),
  );
  try {
    while (true) {
      const status = yield* take(channel);
      yield* put(connectionStatusChanged(status.status, status.transport, status));
    }
  } finally {
    channel.close();
    // Retire request contexts before the root disposes its Store.
    yield* put(connectionStatusChanged('disconnected'));
  }
}
