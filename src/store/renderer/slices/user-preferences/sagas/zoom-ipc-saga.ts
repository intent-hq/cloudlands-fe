import type { Task } from 'redux-saga';
import { all, call, join, put, type SagaGenerator } from 'typed-redux-saga';

import { isElectron } from '$lib/electron-bridge';
import { WINDOW_CHANNELS } from '$shared/ipc/channels';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import { setZoomFactor } from '../user-preferences-slice';

type ZoomChangedEvent = {
  zoomFactor: number;
};

let running = false;

export function* zoomIpcSaga(): SagaGenerator<void> {
  if (!isElectron() || running) return;
  running = true;
  let receivedZoomChange = false;
  function* applyZoomChange(data: ZoomChangedEvent): SagaGenerator<void> {
    if (!Number.isFinite(data?.zoomFactor) || !(data.zoomFactor > 0)) return;
    receivedZoomChange = true;
    yield* put(setZoomFactor(data.zoomFactor));
  }
  try {
    const tasks: Task[] = [
      yield* takeEveryFromElectronChannel('window:zoom-changed', applyZoomChange, {
        bufferPolicy: {
          kind: 'sliding',
          limit: 1,
          rationale: 'Only the latest renderer zoom factor is actionable.',
        },
      }),
    ];
    // Subscribe first: a menu update while this query is in flight is newer than
    // its response. A remounted renderer must also hydrate a retained zoom level.
    try {
      const response = yield* call(
        [window.electronAPI, window.electronAPI.invoke],
        WINDOW_CHANNELS.GET_ZOOM_FACTOR,
        undefined,
      );
      if (!receivedZoomChange && response?.success === true) {
        yield* applyZoomChange({ zoomFactor: response.data });
      }
    } catch {
      // Keep listening if the window is reloading or the initial query fails.
    }
    yield* all(tasks.map((task) => join(task)));
  } finally {
    running = false;
  }
}
