import { all, call, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { sendMessage } from '../../chat-state/chat-state-slice';
import {
  extractSubmittedPromptText,
  installHardwareConsolePromptPickerJoystick,
  loadHardwareConsolePrompts,
  persistHardwareConsolePromptPickerLimit,
  persistHardwareConsolePromptUsage,
  type PromptPickerJoystickDeps,
} from '$features/hardware-console/prompt-picker/prompt-picker-service';
import { DEFAULT_PROMPT_PICKER_LIMIT } from '$features/hardware-console/prompt-picker/curation';
import type { HardwareConsoleManager } from '$features/hardware-console/device/device-manager';
import { getHardwareConsoleManager } from '$features/hardware-console/instance';
import { createLogger } from '$lib/utils/client-logger';
import { HARDWARE_CONSOLE_SETTINGS_PATH } from '$features/hardware-console/assignment/key-pin-persistence-service';
import {
  hydrateHardwareConsolePrompts,
  promptUsageRecorded,
  setPromptPickerLimit,
} from '../hardware-console-slice';
import {
  selectHardwareConsolePromptUsage,
  selectPromptPickerLimit,
} from '../hardware-console-selectors';

const logger = createLogger('HardwareConsolePromptPicker');

interface PersistenceGate {
  settled: boolean;
  succeeded: boolean;
  usageQueued: boolean;
  limitQueued: boolean;
}

export interface PromptPickerSagaDeps extends PromptPickerJoystickDeps {
  manager?: HardwareConsoleManager;
}

function* persistUsage(gate: PersistenceGate): SagaGenerator<void> {
  if (!gate.settled) {
    gate.usageQueued = true;
    return;
  }
  try {
    yield* call(
      persistHardwareConsolePromptUsage,
      yield* selectHardwareConsolePromptUsage.effect(),
    );
  } catch (error) {
    logger.error(`Failed to persist ${HARDWARE_CONSOLE_SETTINGS_PATH} promptUsage`, { error });
  }
}

function* persistLimit(gate: PersistenceGate): SagaGenerator<void> {
  if (!gate.settled) {
    gate.limitQueued = true;
    return;
  }
  try {
    yield* call(persistHardwareConsolePromptPickerLimit, yield* selectPromptPickerLimit.effect());
  } catch (error) {
    logger.error(`Failed to persist ${HARDWARE_CONSOLE_SETTINGS_PATH} promptPickerLimit`, {
      error,
    });
  }
}

function* hydratePrompts(gate: PersistenceGate): SagaGenerator<void> {
  try {
    const hydrated = yield* call(loadHardwareConsolePrompts);
    yield* put(hydrateHardwareConsolePrompts(hydrated.promptUsage, hydrated.promptPickerLimit));
    gate.succeeded = true;
  } catch (error) {
    logger.error('Prompt-tracker hydration failed; dispatching defaults', { error });
    yield* put(hydrateHardwareConsolePrompts([], DEFAULT_PROMPT_PICKER_LIMIT));
  } finally {
    gate.settled = true;
    const usageQueued = gate.usageQueued;
    const limitQueued = gate.limitQueued;
    gate.usageQueued = false;
    gate.limitQueued = false;
    if (gate.succeeded && usageQueued) yield* persistUsage(gate);
    if (gate.succeeded && limitQueued) yield* persistLimit(gate);
  }
}

function* trackSubmittedPrompt(action: ReturnType<typeof sendMessage>): SagaGenerator<void> {
  const text = extractSubmittedPromptText(action);
  if (text !== null) yield* put(promptUsageRecorded(text));
}

export function* promptPickerSaga(deps: PromptPickerSagaDeps = {}): SagaGenerator<void> {
  const manager = deps.manager ?? (yield* call(getHardwareConsoleManager));
  const teardown = yield* call(installHardwareConsolePromptPickerJoystick, manager, deps);
  const gate: PersistenceGate = {
    settled: false,
    succeeded: false,
    usageQueued: false,
    limitQueued: false,
  };
  try {
    yield* all([
      call(hydratePrompts, gate),
      takeEvery(sendMessage, trackSubmittedPrompt),
      takeEvery(promptUsageRecorded, persistUsage, gate),
      takeEvery(setPromptPickerLimit, persistLimit, gate),
    ]);
  } finally {
    yield* call(teardown);
  }
}
