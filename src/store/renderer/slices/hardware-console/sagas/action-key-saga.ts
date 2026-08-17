import { buffers } from 'redux-saga';
import {
  actionChannel,
  all,
  call,
  delay,
  flush,
  put,
  race,
  take,
  takeEvery,
  takeLatest,
  type SagaGenerator,
} from 'typed-redux-saga';

import {
  ACTION_HUD_HIDE_MS,
  consumeArmedComposerFocus,
  focusAgentComposer,
  installHardwareConsoleActionKeys,
  loadHardwareConsoleActionKeySettings,
  persistHardwareConsoleActionMapping,
  persistHardwareConsoleCycleScopes,
  type ActionKeyDeps,
} from '$features/hardware-console/actions/action-key-service';
import { normalizeActionMappingsByModel } from '$features/hardware-console/actions/action-mapping';
import { normalizeCycleScopeByFamily } from '$features/hardware-console/actions/cycle-scope';
import type { HardwareConsoleManager } from '$features/hardware-console/device/device-manager';
import { getHardwareConsoleManager } from '$features/hardware-console/instance';
import { createLogger } from '$lib/utils/client-logger';
import { openAgentTabRequested } from '../../app-layout/app-layout-slice';
import {
  actionHudHidden,
  actionHudShown,
  hydrateHardwareConsoleActionMapping,
  hydrateHardwareConsoleCycleScopes,
  setActionKeyMapping,
  setCycleScope,
} from '../hardware-console-slice';
import {
  selectHardwareConsoleActionMappingsByModel,
  selectHardwareConsoleCycleScopes,
} from '../hardware-console-selectors';
import { HARDWARE_CONSOLE_SETTINGS_PATH } from '$features/hardware-console/assignment/key-pin-persistence-service';

const logger = createLogger('HardwareConsoleActionKeys');

export interface ActionKeySagaDeps extends ActionKeyDeps {
  manager?: HardwareConsoleManager;
}

function* persistMapping(_action: ReturnType<typeof setActionKeyMapping>): SagaGenerator<void> {
  try {
    yield* call(
      persistHardwareConsoleActionMapping,
      yield* selectHardwareConsoleActionMappingsByModel.effect(),
    );
  } catch (error) {
    logger.error(`Failed to persist ${HARDWARE_CONSOLE_SETTINGS_PATH} actionMappingByModel`, {
      error,
    });
  }
}

function* persistScopes(_action: ReturnType<typeof setCycleScope>): SagaGenerator<void> {
  try {
    yield* call(
      persistHardwareConsoleCycleScopes,
      yield* selectHardwareConsoleCycleScopes.effect(),
    );
  } catch (error) {
    logger.error(`Failed to persist ${HARDWARE_CONSOLE_SETTINGS_PATH} cycleScopeByFamily`, {
      error,
    });
  }
}

function* hydrateActionKeys(): SagaGenerator<boolean> {
  let hydrated: Awaited<ReturnType<typeof loadHardwareConsoleActionKeySettings>>;
  try {
    hydrated = yield* call(loadHardwareConsoleActionKeySettings);
    yield* put(hydrateHardwareConsoleActionMapping(hydrated.actionMappingByModel));
    yield* put(hydrateHardwareConsoleCycleScopes(hydrated.cycleScopeByFamily));
  } catch (error) {
    logger.error('Action-mapping hydration failed; dispatching defaults', { error });
    yield* put(hydrateHardwareConsoleActionMapping(normalizeActionMappingsByModel(undefined)));
    yield* put(hydrateHardwareConsoleCycleScopes(normalizeCycleScopeByFamily(undefined)));
    return false;
  }
  if (hydrated.migratedDefaults) {
    // Kept outside the hydration try: the persist can throw on a transient bag-read
    // flap, and that must not overwrite the just-hydrated in-memory values with
    // defaults. The bag is untouched, so the migration simply re-runs next boot.
    try {
      yield* call(persistHardwareConsoleActionMapping, hydrated.actionMappingByModel);
    } catch (error) {
      logger.error(
        `Failed to persist migrated ${HARDWARE_CONSOLE_SETTINGS_PATH} actionMappingByModel; keeping hydrated values`,
        { error },
      );
    }
  }
  return true;
}

function* waitForActionHudHidden(): SagaGenerator<void> {
  const _action: ReturnType<typeof actionHudHidden> = yield* take(actionHudHidden);
}

function* actionHudShownWorker(_action: ReturnType<typeof actionHudShown>): SagaGenerator<void> {
  const { timedOut } = yield* race({
    timedOut: delay(ACTION_HUD_HIDE_MS),
    hidden: call(waitForActionHudHidden),
  });
  if (timedOut) yield* put(actionHudHidden());
}

function* focusArmedAgentTab(
  action: ReturnType<typeof openAgentTabRequested>,
): SagaGenerator<void> {
  if (!(yield* call(consumeArmedComposerFocus))) return;
  const detail = action.payload[1];
  if (detail && typeof detail.agentId === 'string') {
    yield* call(focusAgentComposer, detail.agentId);
  }
}

function* actionKeyPersistenceSaga(): SagaGenerator<void> {
  const mappingActions = yield* actionChannel(setActionKeyMapping, buffers.sliding(1));
  const scopeActions = yield* actionChannel(setCycleScope, buffers.sliding(1));
  try {
    const hydrationSucceeded = yield* call(hydrateActionKeys);
    if (!hydrationSucceeded) {
      yield* flush(mappingActions);
      yield* flush(scopeActions);
    }
    yield* all([takeEvery(mappingActions, persistMapping), takeEvery(scopeActions, persistScopes)]);
  } finally {
    mappingActions.close();
    scopeActions.close();
  }
}

export function* actionKeySaga(deps: ActionKeySagaDeps = {}): SagaGenerator<void> {
  const manager = deps.manager ?? (yield* call(getHardwareConsoleManager));
  const teardown = yield* call(installHardwareConsoleActionKeys, manager, deps);
  try {
    yield* all([
      call(actionKeyPersistenceSaga),
      takeLatest(actionHudShown, actionHudShownWorker),
      takeEvery(openAgentTabRequested, focusArmedAgentTab),
    ]);
  } finally {
    yield* call(teardown);
  }
}
