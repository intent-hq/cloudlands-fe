import { call, put, takeLeading, join, cancel, type SagaGenerator } from 'typed-redux-saga';
import { WINDOW_CHANNELS } from '$shared/ipc/channels';
import { dockMachineSwitchRequested, dockMachineSwitchFinished } from '../hud-slice';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import { selectDockMachineSwitch } from '../hud-selectors';

async function switchMachine(backendId: string): Promise<void> {
  const response = await window.electronAPI?.invoke(WINDOW_CHANNELS.SWITCH_DOCK_BACKEND, {
    backendId,
  });
  if (!response || typeof response !== 'object' || !('success' in response) || !response.success)
    throw new Error('Dock machine switch failed');
}

function* switchRequested(
  action: ReturnType<typeof dockMachineSwitchRequested>,
): SagaGenerator<void> {
  const [backendId] = action.payload;
  const { pending } = yield* selectDockMachineSwitch.effect();
  if (pending !== backendId) return;
  try {
    yield* call(switchMachine, backendId);
    // The old document must remain locked until native replaces it.
  } catch {
    yield* put(dockMachineSwitchFinished(backendId, true));
  }
}

/** Owned by the dock route; IPC never opens ordinary backend windows. */
export function* dockMachineSaga(): SagaGenerator<void> {
  const failures = yield* takeEveryFromElectronChannel(
    WINDOW_CHANNELS.DOCK_BACKEND_SWITCH_FAILED,
    function* (payload: { backendId: string }): SagaGenerator<void> {
      yield* put(dockMachineSwitchFinished(payload.backendId, true));
    },
    {
      bufferPolicy: {
        kind: 'sliding',
        limit: 1,
        rationale: 'Only the pending dock handoff can fail.',
      },
    },
  );
  const requests = yield* takeLeading(dockMachineSwitchRequested, switchRequested);
  try {
    yield* join(requests);
  } finally {
    yield* cancel(failures);
    yield* cancel(requests);
  }
}
