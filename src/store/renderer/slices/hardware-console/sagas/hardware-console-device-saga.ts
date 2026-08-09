import { takeLatestFromSelector, type SelectorChannelPayload } from '@augmentcode/themis/saga';
import { call, delay, fork, join, put, take, takeLatest } from 'typed-redux-saga';

import { installHardwareConsoleKeySwitching } from '$features/hardware-console/assignment/key-switch-service';
import type { HardwareConsoleManager } from '$features/hardware-console/device/device-manager';
import {
  ENCODER_HUD_HIDE_MS,
  installHardwareConsoleEncoder,
} from '$features/hardware-console/encoder/encoder-service';
import {
  parseEnabled,
  persistHardwareConsoleEnabled,
  readHardwareConsoleSettingsBag,
} from '$features/hardware-console/integration-toggle-service';
import { getHardwareConsoleManager } from '$features/hardware-console/instance';
import { installHardwareConsoleConnectionToasts } from '$features/hardware-console/connection-toast-service';
import { installHardwareConsoleClearLightingListener } from '$features/hardware-console/led/clear-lighting';
import { HardwareLedEngine } from '$features/hardware-console/led/engine';
import type { HardwareLedSnapshot } from '$features/hardware-console/led/frames';
import { installHardwareConsoleLedStatus } from '$features/hardware-console/led/led-status-service';
import { createLogger } from '$lib/utils/client-logger';
import {
  encoderHudHidden,
  encoderHudShown,
  hydrateHardwareConsoleEnabled,
  setHardwareConsoleEnabled,
} from '../hardware-console-slice';
import {
  selectHardwareConsoleEnabled,
  selectHardwareLedSnapshot,
} from '../hardware-console-selectors';

const logger = createLogger('HardwareConsoleDeviceSaga');

interface IntegrationLifecycleState {
  hydrationSettled: boolean;
  persistQueued: boolean;
}

function* setManagerEnabled(manager: HardwareConsoleManager, enabled: boolean) {
  try {
    if (enabled) yield* call([manager, manager.start]);
    else yield* call([manager, manager.stop]);
  } catch (error) {
    logger.error(`Failed to ${enabled ? 'start' : 'stop'} hardware-console manager`, { error });
  }
}

function* persistEnabled(enabled: boolean) {
  try {
    yield* call(persistHardwareConsoleEnabled, enabled);
  } catch (error) {
    logger.error('Failed to persist hardwareConsole.state enabled', { error });
  }
}

function* hydrateEnabled(manager: HardwareConsoleManager, lifecycle: IntegrationLifecycleState) {
  let hydrated = false;
  try {
    const bag = yield* call(readHardwareConsoleSettingsBag);
    if (bag === null) throw new Error('hardwareConsole.state read failed');
    yield* put(hydrateHardwareConsoleEnabled(parseEnabled(bag.enabled)));
    hydrated = true;
  } catch (error) {
    logger.error('Enabled-flag hydration failed; dispatching default (enabled)', { error });
    yield* put(hydrateHardwareConsoleEnabled(true));
  }

  lifecycle.hydrationSettled = true;
  const shouldPersist = lifecycle.persistQueued && hydrated;
  lifecycle.persistQueued = false;
  const enabled = yield* selectHardwareConsoleEnabled.effect();
  if (shouldPersist) yield* fork(persistEnabled, enabled);
  yield* fork(setManagerEnabled, manager, enabled);
}

function* watchIntegrationToggle(
  manager: HardwareConsoleManager,
  lifecycle: IntegrationLifecycleState,
) {
  while (true) {
    const action = yield* take(setHardwareConsoleEnabled);
    const enabled = action.payload[0];
    yield* fork(setManagerEnabled, manager, enabled);
    if (lifecycle.hydrationSettled) yield* fork(persistEnabled, enabled);
    else lifecycle.persistQueued = true;
  }
}

function* hideEncoderHudAfterDelay(
  action: ReturnType<typeof encoderHudShown | typeof encoderHudHidden>,
) {
  if (action.type !== encoderHudShown.type) return;
  yield* delay(ENCODER_HUD_HIDE_MS);
  yield* put(encoderHudHidden());
}

export function* watchHardwareConsoleEncoderHud() {
  yield* takeLatest([encoderHudShown, encoderHudHidden], hideEncoderHudAfterDelay);
}

export function* watchHardwareConsoleLedSnapshot(engine: HardwareLedEngine) {
  yield* takeLatestFromSelector(
    selectHardwareLedSnapshot,
    function* ({ payload }: SelectorChannelPayload<HardwareLedSnapshot>) {
      yield* call([engine, engine.update], payload);
    },
  );
}

function* disposeSafely(dispose: () => void) {
  try {
    yield* call(dispose);
  } catch (error) {
    logger.error('Failed to dispose hardware-console device wiring', { error });
  }
}

/** Device/lifecycle half of the hardware-console root saga. */
export function* hardwareConsoleDeviceSaga() {
  const manager = getHardwareConsoleManager();
  const disposers: (() => void)[] = [];

  try {
    disposers.push(yield* call(installHardwareConsoleKeySwitching, manager));
    disposers.push(yield* call(installHardwareConsoleEncoder, manager));
    const ledEngine = new HardwareLedEngine();
    const disposeLedWiring = yield* call(installHardwareConsoleLedStatus, manager, {
      engine: ledEngine,
    });
    disposers.push(disposeLedWiring);
    disposers.push(
      yield* call(installHardwareConsoleClearLightingListener, manager, { disposeLedWiring }),
    );
    disposers.push(yield* call(installHardwareConsoleConnectionToasts, manager));

    const lifecycle: IntegrationLifecycleState = {
      hydrationSettled: false,
      persistQueued: false,
    };
    const toggleTask = yield* fork(watchIntegrationToggle, manager, lifecycle);
    yield* fork(watchHardwareConsoleEncoderHud);
    yield* call([ledEngine, ledEngine.update], yield* selectHardwareLedSnapshot.effect());
    yield* fork(watchHardwareConsoleLedSnapshot, ledEngine);
    yield* call(hydrateEnabled, manager, lifecycle);
    yield* join(toggleTask);
  } finally {
    for (const dispose of disposers.reverse()) yield* call(disposeSafely, dispose);
    yield* call(setManagerEnabled, manager, false);
  }
}
