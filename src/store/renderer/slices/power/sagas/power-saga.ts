import { takeLatestFromSelector, type SelectorChannelPayload } from '@augmentcode/themis/saga';
import { END, buffers, eventChannel, type EventChannel } from 'redux-saga';
import { call, put, take } from 'typed-redux-saga';

import { createLogger } from '$lib/utils/client-logger';
import {
  createBatterySource,
  type BatterySource,
} from '$store/renderer/seeders/power-bridge-seeder';
import { selectReduceMotionActive } from '../power-selectors';
import { setOnBattery } from '../power-slice';

const logger = createLogger('PowerSaga');

/** Root attribute read by the reduced-motion helper; set iff on battery AND the preference is on. */
export const REDUCE_MOTION_ROOT_ATTRIBUTE = 'data-reduce-motion';

function createBatteryChannel(source: BatterySource): EventChannel<boolean> {
  return eventChannel<boolean>(
    (emit) => source.subscribe((onBattery) => emit(onBattery)),
    buffers.sliding<boolean>(1),
  );
}

function applyReduceMotionRootAttribute(active: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.toggleAttribute(REDUCE_MOTION_ROOT_ATTRIBUTE, active);
}

function* reduceMotionRootAttributeWorker({ payload }: SelectorChannelPayload<boolean>) {
  yield* call(applyReduceMotionRootAttribute, payload);
}

/** Seeds `power.onBattery` from the build's battery source and mirrors the reduce-motion flag onto the root element. */
export function* powerSaga() {
  yield* takeLatestFromSelector(selectReduceMotionActive, reduceMotionRootAttributeWorker);

  const source: BatterySource = yield* call(createBatterySource);
  const channel = createBatteryChannel(source);
  try {
    try {
      const onBattery = yield* call([source, source.read]);
      yield* put(setOnBattery(onBattery));
    } catch (error) {
      logger.warn('battery state read failed', error);
    }
    while (true) {
      const onBattery: boolean = yield* take(channel);
      if (onBattery === (END as unknown as boolean)) break;
      yield* put(setOnBattery(onBattery));
    }
  } finally {
    channel.close();
    yield* call(applyReduceMotionRootAttribute, false);
  }
}
