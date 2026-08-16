import { all, call, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import {
  HARDWARE_CONSOLE_SETTINGS_PATH,
  loadHardwareConsoleKeyPins,
  persistHardwareConsoleKeyPins,
} from '$features/hardware-console/assignment/key-pin-persistence-service';
import {
  isKeyAssignableWorkspace,
  keyPinsEqual,
  normalizeKeyPins,
  reconcileKeyPins,
} from '$features/hardware-console/assignment/key-assignment';
import { createLogger } from '$lib/utils/client-logger';
import { hydrateHardwareConsoleKeyPins, keyPinsReconciled, markKeySlotUnassigned, pinWorkspaceToKey } from '../hardware-console-slice';
import {
  selectHardwareConsoleExcludedWorkspaceIds,
  selectHardwareConsoleKeyPins,
} from '../hardware-console-selectors';
import {
  selectWorkspaceHasLoaded,
  selectWorkspaceItems,
} from '../../workspace/workspace-selectors';
import {
  bulkUpdateWorkspaceEntities,
  removeWorkspaceEntity,
  replaceWorkspaceList,
  resetWorkspaceState,
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
  updateWorkspaceEntity,
} from '../../workspace/workspace-slice';

const logger = createLogger('HardwareConsoleKeyPinPersistence');

interface HydrationGate {
  settled: boolean;
  succeeded: boolean;
  persistQueued: boolean;
}

function* persistKeyPins(gate: HydrationGate): SagaGenerator<void> {
  if (!gate.settled) {
    gate.persistQueued = true;
    return;
  }
  const keyPins = yield* selectHardwareConsoleKeyPins.effect();
  const excludedWorkspaceIds = yield* selectHardwareConsoleExcludedWorkspaceIds.effect();
  try {
    yield* call(persistHardwareConsoleKeyPins, keyPins, excludedWorkspaceIds);
  } catch (error) {
    logger.error(`Failed to persist ${HARDWARE_CONSOLE_SETTINGS_PATH} keyPins`, { error });
  }
}

function* reconcileCurrentKeyPins(gate: HydrationGate): SagaGenerator<boolean> {
  if (!gate.settled || !gate.succeeded || !(yield* selectWorkspaceHasLoaded.effect())) return false;
  const keyPins = yield* selectHardwareConsoleKeyPins.effect();
  const excludedWorkspaceIds = yield* selectHardwareConsoleExcludedWorkspaceIds.effect();
  const workspaces = (yield* selectWorkspaceItems.effect()).filter(isKeyAssignableWorkspace);
  const reconciled = reconcileKeyPins(keyPins, workspaces, excludedWorkspaceIds);
  if (keyPinsEqual(normalizeKeyPins(keyPins), reconciled)) return false;
  yield* put(keyPinsReconciled(reconciled));
  return true;
}

function* hydrateKeyPins(gate: HydrationGate): SagaGenerator<void> {
  try {
    const hydrated = yield* call(loadHardwareConsoleKeyPins);
    yield* put(hydrateHardwareConsoleKeyPins(hydrated.keyPins, hydrated.excludedWorkspaceIds));
    gate.succeeded = true;
  } catch (error) {
    logger.error('Key-pin hydration failed; dispatching defaults', { error });
    yield* put(hydrateHardwareConsoleKeyPins([]));
  } finally {
    gate.settled = true;
    const queued = gate.persistQueued;
    gate.persistQueued = false;
    if (gate.succeeded) {
      const reconciled = yield* reconcileCurrentKeyPins(gate);
      if (reconciled || queued) yield* persistKeyPins(gate);
    }
  }
}

function* persistPinMutation(gate: HydrationGate): SagaGenerator<void> {
  if (!gate.settled) {
    gate.persistQueued = true;
    return;
  }
  if (gate.succeeded) yield* reconcileCurrentKeyPins(gate);
  yield* persistKeyPins(gate);
}

function* reconcileWorkspaceMutation(gate: HydrationGate): SagaGenerator<void> {
  if (yield* reconcileCurrentKeyPins(gate)) yield* persistKeyPins(gate);
}

export function* keyPinPersistenceSaga(): SagaGenerator<void> {
  const gate: HydrationGate = { settled: false, succeeded: false, persistQueued: false };
  yield* all([
    call(hydrateKeyPins, gate),
    takeEvery(
      [pinWorkspaceToKey, markKeySlotUnassigned],
      persistPinMutation,
      gate,
    ),
    takeEvery(
      [
        setWorkspaceHasLoaded,
        replaceWorkspaceList,
        resetWorkspaceState,
        setWorkspaceEntity,
        updateWorkspaceEntity,
        bulkUpdateWorkspaceEntities,
        removeWorkspaceEntity,
      ],
      reconcileWorkspaceMutation,
      gate,
    ),
  ]);
}
