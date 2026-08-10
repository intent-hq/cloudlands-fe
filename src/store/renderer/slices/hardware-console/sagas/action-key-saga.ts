import { all, call, delay, put, takeEvery, takeLatest, type SagaGenerator } from 'typed-redux-saga';

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

interface PersistenceGate {
  settled: boolean;
  succeeded: boolean;
  mappingQueued: boolean;
  scopesQueued: boolean;
}

export interface ActionKeySagaDeps extends ActionKeyDeps {
  manager?: HardwareConsoleManager;
}

function* persistMapping(gate: PersistenceGate): SagaGenerator<void> {
  if (!gate.settled) {
    gate.mappingQueued = true;
    return;
  }
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

function* persistScopes(gate: PersistenceGate): SagaGenerator<void> {
  if (!gate.settled) {
    gate.scopesQueued = true;
    return;
  }
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

function* hydrateActionKeys(gate: PersistenceGate): SagaGenerator<void> {
  try {
    const hydrated = yield* call(loadHardwareConsoleActionKeySettings);
    yield* put(hydrateHardwareConsoleActionMapping(hydrated.actionMappingByModel));
    yield* put(hydrateHardwareConsoleCycleScopes(hydrated.cycleScopeByFamily));
    if (hydrated.migratedDefaults) {
      yield* call(persistHardwareConsoleActionMapping, hydrated.actionMappingByModel);
    }
    gate.succeeded = true;
  } catch (error) {
    logger.error('Action-mapping hydration failed; dispatching defaults', { error });
    yield* put(hydrateHardwareConsoleActionMapping(normalizeActionMappingsByModel(undefined)));
    yield* put(hydrateHardwareConsoleCycleScopes(normalizeCycleScopeByFamily(undefined)));
  } finally {
    gate.settled = true;
    const mappingQueued = gate.mappingQueued;
    const scopesQueued = gate.scopesQueued;
    gate.mappingQueued = false;
    gate.scopesQueued = false;
    if (gate.succeeded && mappingQueued) yield* persistMapping(gate);
    if (gate.succeeded && scopesQueued) yield* persistScopes(gate);
  }
}

function* actionHudTimer(action: { type: string }): SagaGenerator<void> {
  if (action.type !== actionHudShown.type) return;
  yield* delay(ACTION_HUD_HIDE_MS);
  yield* put(actionHudHidden());
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

export function* actionKeySaga(deps: ActionKeySagaDeps = {}): SagaGenerator<void> {
  const manager = deps.manager ?? (yield* call(getHardwareConsoleManager));
  const teardown = yield* call(installHardwareConsoleActionKeys, manager, deps);
  const gate: PersistenceGate = {
    settled: false,
    succeeded: false,
    mappingQueued: false,
    scopesQueued: false,
  };
  try {
    yield* all([
      call(hydrateActionKeys, gate),
      takeEvery(setActionKeyMapping, persistMapping, gate),
      takeEvery(setCycleScope, persistScopes, gate),
      takeLatest([actionHudShown, actionHudHidden], actionHudTimer),
      takeEvery(openAgentTabRequested, focusArmedAgentTab),
    ]);
  } finally {
    yield* call(teardown);
  }
}
