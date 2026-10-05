import { takeLatestFromSelector, type SelectorChannelPayload } from '@themislib/themis/saga';
import { buffers, eventChannel } from 'redux-saga';
import { call, take } from 'typed-redux-saga';
import {
  getConsoleOwnerBridge,
  installConsoleOwnerListener,
  queryConsoleOwnerStatus,
} from '$features/hardware-console/console-owner-status';
import { getHardwareConsoleManager } from '$features/hardware-console/instance';
import { HardwareInputDecoder } from '$features/hardware-console/input/input-decoder';
import { cycleOpenWindows } from '$features/hardware-console/actions/window-cycle';
import {
  parseWindowCyclePreference,
  WINDOW_CYCLE_STORAGE_KEY,
  type WindowCyclePreference,
} from '$features/hardware-console/actions/window-cycle-preference';
import { createLogger } from '$lib/utils/client-logger';
import { getLocalStorageJSON, setLocalStorageItem } from '../../../utils/safe-local-storage-saga';
import {
  selectSharedWindowCycleActive,
  selectWindowCyclePreference,
} from '../hardware-console-selectors';

const logger = createLogger('SharedWindowCycle');

/** Publish only after owner settings hydrate and this window owns the physical console. */
export function* publishWindowCyclePreferenceSaga() {
  yield* takeLatestFromSelector(
    selectWindowCyclePreference,
    function* ({ payload }: SelectorChannelPayload<string | null>) {
      if (payload !== null) yield* setLocalStorageItem(WINDOW_CYCLE_STORAGE_KEY, payload);
    },
  );
}

/** No host RPCs, settings writers, LEDs, voice, or workspace actions in this lifetime. */
function* sharedWindowCycle() {
  const ipc = getConsoleOwnerBridge();
  if (!ipc) return;
  const manager = getHardwareConsoleManager();
  let isOwner = false;
  let receivedOwnerPush = false;
  let preference: WindowCyclePreference | null = null;
  let refreshPreference: (() => void) | undefined;
  const offOwner = installConsoleOwnerListener(ipc, (next) => {
    receivedOwnerPush = true;
    isOwner = next;
    if (next) refreshPreference?.();
  });
  const changes = eventChannel<boolean>((emit) => {
    refreshPreference = () => emit(true);
    const onStorage = (event: StorageEvent) => {
      if (event.key === WINDOW_CYCLE_STORAGE_KEY || event.key === null) emit(true);
    };
    window.addEventListener('storage', onStorage);
    emit(true);
    return () => window.removeEventListener('storage', onStorage);
  }, buffers.sliding(1));
  const decoder = new HardwareInputDecoder();
  const offKey = decoder.on('keydown', ({ key }) => {
    const model = manager.connectedDevice?.model;
    if (
      !isOwner ||
      !preference?.enabled ||
      !model ||
      !preference.keysByModel[model].some((mappedKey) => mappedKey === key)
    )
      return;
    void cycleOpenWindows().catch((error: unknown) =>
      logger.warn('Window cycling failed', { error }),
    );
  });
  const offRaw = manager.onRawMessage((message) => decoder.handleMessage(message));
  try {
    const initialOwner = yield* call(queryConsoleOwnerStatus, ipc);
    // A push received during the query is newer than the query snapshot.
    if (!receivedOwnerPush) isOwner = initialOwner === true;
    while (true) {
      yield* take(changes);
      preference = parseWindowCyclePreference(yield* getLocalStorageJSON(WINDOW_CYCLE_STORAGE_KEY));
      if (preference?.enabled) yield* call([manager, manager.start]);
      else yield* call([manager, manager.stop]);
    }
  } catch (error) {
    logger.warn('Shared-window hardware cycling unavailable', { error });
  } finally {
    offRaw();
    offKey();
    offOwner();
    changes.close();
    yield* call([manager, manager.stop]);
  }
}

export function* sharedWindowCycleSaga() {
  yield* takeLatestFromSelector(
    selectSharedWindowCycleActive,
    function* ({ payload }: SelectorChannelPayload<boolean>) {
      if (payload) yield* call(sharedWindowCycle);
    },
  );
}
