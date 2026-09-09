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
import {
  hydrateHardwareConsoleKeyPins,
  keyPinsReconciled,
  markKeySlotUnassigned,
  pinWorkspaceToKey,
} from '../hardware-console-slice';
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

function* attemptHydration(gate: HydrationGate): SagaGenerator<boolean> {
  try {
    const hydrated = yield* call(loadHardwareConsoleKeyPins);
    yield* put(hydrateHardwareConsoleKeyPins(hydrated.keyPins, hydrated.excludedWorkspaceIds));
    gate.succeeded = true;
    return true;
  } catch (error) {
    logger.error('Key-pin hydration failed', { error });
    return false;
  }
}

function* hydrateKeyPins(gate: HydrationGate): SagaGenerator<void> {
  try {
    if (!(yield* attemptHydration(gate))) yield* put(hydrateHardwareConsoleKeyPins([]));
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

type PinMutationAction =
  ReturnType<typeof pinWorkspaceToKey> | ReturnType<typeof markKeySlotUnassigned>;

function* persistPinMutation(gate: HydrationGate, action: PinMutationAction): SagaGenerator<void> {
  if (!gate.settled) {
    gate.persistQueued = true;
    return;
  }
  if (!gate.succeeded) {
    // Hydration failed, so the in-memory pins are boot defaults — persisting them
    // would overwrite the real bag. Retry hydration and re-apply the mutation on
    // top of the restored pins; if the retry fails too, skip the persist.
    // Known limitation: only the latest mutation is re-applied. Earlier mutations
    // made while hydration kept failing were already skipped, so the recovery
    // hydrate silently reverts them in the UI — the accepted trade-off versus
    // wiping the bag. A follow-up could queue all skipped mutations instead.
    if (yield* attemptHydration(gate)) {
      yield* put(action);
    } else {
      logger.warn(
        `Skipped ${HARDWARE_CONSOLE_SETTINGS_PATH} keyPins persist: hydration has not succeeded`,
      );
    }
    return;
  }
  yield* reconcileCurrentKeyPins(gate);
  yield* persistKeyPins(gate);
}

function* reconcileWorkspaceMutation(gate: HydrationGate): SagaGenerator<void> {
  if (yield* reconcileCurrentKeyPins(gate)) yield* persistKeyPins(gate);
}

export function* keyPinPersistenceSaga(): SagaGenerator<void> {
  const gate: HydrationGate = { settled: false, succeeded: false, persistQueued: false };
  yield* all([
    call(hydrateKeyPins, gate),
    takeEvery([pinWorkspaceToKey, markKeySlotUnassigned], persistPinMutation, gate),
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
