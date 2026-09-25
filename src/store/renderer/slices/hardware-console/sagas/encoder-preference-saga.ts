import { buffers } from 'redux-saga';
import { actionChannel, call, delay, flush, put, take, type SagaGenerator } from 'typed-redux-saga';
import {
  loadHardwareConsoleEncoderBehavior,
  persistHardwareConsoleEncoderBehavior,
} from '$features/hardware-console/encoder/encoder-preference-service';
import { createLogger } from '$lib/utils/client-logger';
import {
  hardwareConsoleEncoderBehaviorSaveFailed,
  hydrateHardwareConsoleEncoderBehavior,
  setHardwareConsoleEncoderBehavior,
} from '../hardware-console-slice';
import type { HardwareConsoleEncoderBehavior } from '../hardware-console-types';

const logger = createLogger('HardwareConsoleEncoderPreference');
const HYDRATION_RETRY_DELAYS_MS = [1_000, 5_000, 15_000] as const;

/** One shared preference, with the latest user choice winning over slow reads and saves. */
export function* encoderPreferenceSaga(): SagaGenerator<void> {
  const changes = yield* actionChannel(setHardwareConsoleEncoderBehavior, buffers.sliding(1));
  let saved: HardwareConsoleEncoderBehavior;
  try {
    let attempt = 0;
    while (true) {
      try {
        saved = yield* call(loadHardwareConsoleEncoderBehavior);
        break;
      } catch (error) {
        logger.error('Encoder preference hydration failed; retrying', { error });
      }
      // A failed read does not establish an absent preference. Keep input gated
      // until the saved opt-out is known, retaining explicit choices in the channel.
      yield* delay(
        HYDRATION_RETRY_DELAYS_MS[Math.min(attempt, HYDRATION_RETRY_DELAYS_MS.length - 1)],
      );
      attempt += 1;
    }

    let pending: ReturnType<typeof setHardwareConsoleEncoderBehavior> | undefined = (yield* flush(
      changes,
    ))[0];
    // A choice made during hydration wins, even when it equals the boot default.
    yield* put(hydrateHardwareConsoleEncoderBehavior(pending?.payload[0] ?? saved));

    while (true) {
      const action = pending ?? (yield* take(changes));
      pending = undefined;
      const behavior = action.payload[0];
      try {
        yield* call(persistHardwareConsoleEncoderBehavior, behavior);
        saved = behavior;
      } catch (error) {
        logger.error('Failed to persist hardwareConsole.state encoderBehavior', { error });
        [pending] = yield* flush(changes);
        // An older failed save must not roll back a newer user choice.
        if (!pending) yield* put(hardwareConsoleEncoderBehaviorSaveFailed(saved));
      }
    }
  } finally {
    changes.close();
  }
}
