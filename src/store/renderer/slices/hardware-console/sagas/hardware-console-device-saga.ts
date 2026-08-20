import { takeLatestFromSelector, type SelectorChannelPayload } from '@augmentcode/themis/saga';
import { buffers, eventChannel, type EventChannel } from 'redux-saga';
import { call, cancelled, delay, fork, join, put, take, takeLatest } from 'typed-redux-saga';

import { installHardwareConsoleKeySwitching } from '$features/hardware-console/assignment/key-switch-service';
import {
  getConsoleOwnerBridge,
  installConsoleOwnerListener,
  queryConsoleOwnerStatus,
} from '$features/hardware-console/console-owner-status';
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
  consoleOwnerChanged,
  encoderHudHidden,
  encoderHudShown,
  hydrateHardwareConsoleEnabled,
  setHardwareConsoleEnabled,
} from '../hardware-console-slice';
import {
  selectHardwareConsoleEnabled,
  selectHardwareLedSnapshot,
  selectIsConsoleOwner,
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

/**
 * Console-owner hydration (#1928): flip to non-owner, subscribe to main's
 * per-window `owner-changed` pushes, then hydrate from the initial
 * owner-status query. Runs to completion before the device saga installs
 * its handlers and starts the manager, so ownership is settled before the
 * device stream opens (a connect toast or LED write can't race the query).
 * A failed query keeps the pessimistic non-owner flip — the safe failure
 * mode is no input in one window, not duplicate input in two. Without a
 * preload bridge (web build / tests) the optimistic slice default (`true`)
 * stands — the single page is always the owner — and no channel is
 * returned. Otherwise returns the push channel for `watchConsoleOwnerPushes`.
 */
function* hydrateConsoleOwnerStatus() {
  const ipc = yield* call(getConsoleOwnerBridge);
  if (ipc === null) return null;
  yield* put(consoleOwnerChanged(false));
  // Subscribe before querying so no ownership change slips between the two;
  // the sliding buffer holds the latest push that lands mid-query.
  const pushes = yield* call(() =>
    eventChannel<boolean>((emit) => installConsoleOwnerListener(ipc, emit), buffers.sliding(1)),
  );
  try {
    const isOwner = yield* call(queryConsoleOwnerStatus, ipc);
    if (isOwner !== null) yield* put(consoleOwnerChanged(isOwner));
    return pushes;
  } finally {
    // Cancelled mid-query: the push watcher was never forked, so close here.
    if (yield* cancelled()) pushes.close();
  }
}

/** Applies main's per-window `owner-changed` pushes to the slice (#1928). */
function* watchConsoleOwnerPushes(pushes: EventChannel<boolean>) {
  try {
    while (true) {
      yield* put(consoleOwnerChanged(yield* take(pushes)));
    }
  } finally {
    pushes.close();
  }
}

/** Mutable owner flag shared with the device services' `isOwner` callbacks. */
interface ConsoleOwnerRef {
  current: boolean;
}

/**
 * Single-LED-writer gate (#1928): keeps `ownerRef` in sync with the slice
 * and flips the engine's transport on ownership changes. Gaining ownership
 * re-attaches the engine, which replays the current snapshot as a full
 * repaint; losing it detaches so only the owner window writes frames. The
 * initial emission (channel subscription) is skipped — boot attachment is
 * owned by `installHardwareConsoleLedStatus`.
 */
function* watchConsoleOwnerLedGate(
  manager: HardwareConsoleManager,
  engine: HardwareLedEngine,
  ownerRef: ConsoleOwnerRef,
) {
  yield* takeLatestFromSelector(
    selectIsConsoleOwner,
    function* ({ payload, prevPayload }: SelectorChannelPayload<boolean>) {
      ownerRef.current = payload;
      if (prevPayload === null || prevPayload === undefined) return;
      if (payload) {
        if (manager.status === 'connected' && manager.client) {
          yield* call([engine, engine.attach], manager.client);
        }
      } else {
        yield* call([engine, engine.detach]);
      }
    },
  );
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

function* watchHardwareConsoleLedSnapshot(engine: HardwareLedEngine) {
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
    // Settle console ownership (#1928) before installing device handlers or
    // starting the manager, so no window acts on an unhydrated owner flag.
    const ownerPushes = yield* call(hydrateConsoleOwnerStatus);
    if (ownerPushes !== null) yield* fork(watchConsoleOwnerPushes, ownerPushes);

    disposers.push(yield* call(installHardwareConsoleKeySwitching, manager));
    disposers.push(yield* call(installHardwareConsoleEncoder, manager));
    const ledEngine = new HardwareLedEngine();
    const ownerRef: ConsoleOwnerRef = { current: yield* selectIsConsoleOwner.effect() };
    const isOwner = () => ownerRef.current;
    const disposeLedWiring = yield* call(installHardwareConsoleLedStatus, manager, {
      engine: ledEngine,
      isOwner,
    });
    disposers.push(disposeLedWiring);
    disposers.push(
      yield* call(installHardwareConsoleClearLightingListener, manager, { disposeLedWiring }),
    );
    disposers.push(yield* call(installHardwareConsoleConnectionToasts, manager, { isOwner }));

    const lifecycle: IntegrationLifecycleState = {
      hydrationSettled: false,
      persistQueued: false,
    };
    const toggleTask = yield* fork(watchIntegrationToggle, manager, lifecycle);
    yield* fork(watchConsoleOwnerLedGate, manager, ledEngine, ownerRef);
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
