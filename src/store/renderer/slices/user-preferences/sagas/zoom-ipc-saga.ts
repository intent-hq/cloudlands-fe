import type { Task } from 'redux-saga';
import { all, join, put, type SagaGenerator } from 'typed-redux-saga';

import { isElectron } from '$lib/electron-bridge';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import { setZoomFactor } from '../user-preferences-slice';

type ZoomChangedEvent = {
  zoomFactor: number;
};

let running = false;

function* applyZoomChange(data: ZoomChangedEvent): SagaGenerator<void> {
  if (typeof data?.zoomFactor !== 'number' || !(data.zoomFactor > 0)) return;
  yield* put(setZoomFactor(data.zoomFactor));
}

export function* zoomIpcSaga(): SagaGenerator<void> {
  if (!isElectron() || running) return;
  running = true;
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
    yield* all(tasks.map((task) => join(task)));
  } finally {
    running = false;
  }
}
