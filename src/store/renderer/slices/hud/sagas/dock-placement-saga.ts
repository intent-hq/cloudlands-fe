import { buffers } from 'redux-saga';
import { actionChannel, call, cancel, put, take, type SagaGenerator } from 'typed-redux-saga';
import { WINDOW_CHANNELS } from '$shared/ipc/channels';
import type { DockPlacementCommand, DockPlacementSnapshot } from '$shared/dock-placement';
import { takeEveryFromElectronChannel } from '../../../utils/ipc-channel';
import {
  dockPlacementCommandRequested,
  dockPlacementFailed,
  dockDragStartResolved,
  dockResizeStartResolved,
  dockPlacementReceived,
  dockFocusRequested,
} from '../hud-slice';

/** Native placement stays main-owned; the bridge serializes drag and resize ownership. */
async function invokePlacement(
  command?: DockPlacementCommand,
): Promise<DockPlacementSnapshot | null> {
  const bridge = typeof window === 'undefined' ? undefined : window.electronAPI;
  if (!bridge) return null;
  const response = await bridge.invoke(
    command ? WINDOW_CHANNELS.UPDATE_DOCK_PLACEMENT : WINDOW_CHANNELS.GET_DOCK_PLACEMENT,
    command ?? {},
  );
  if (response === null || response === undefined) return null;
  if (typeof response !== 'object' || !('revision' in response) || !('surface' in response)) {
    throw new Error('Invalid dock placement response');
  }
  return response as DockPlacementSnapshot;
}

function* receivePlacement(snapshot: DockPlacementSnapshot): SagaGenerator<void> {
  yield* put(dockPlacementReceived(snapshot));
}
function* receiveFocus(): SagaGenerator<void> {
  yield* put(dockFocusRequested());
}

export function* dockPlacementSaga(): SagaGenerator<void> {
  const commands = yield* actionChannel(dockPlacementCommandRequested, buffers.expanding());
  const updates = yield* takeEveryFromElectronChannel(
    WINDOW_CHANNELS.DOCK_PLACEMENT_CHANGED,
    receivePlacement,
    {
      bufferPolicy: {
        kind: 'sliding',
        limit: 1,
        rationale: 'Only current native dock geometry is actionable.',
      },
    },
  );
  const focus = yield* takeEveryFromElectronChannel(WINDOW_CHANNELS.FOCUS_DOCK, receiveFocus);
  try {
    try {
      const snapshot = yield* call(invokePlacement);
      if (snapshot) yield* put(dockPlacementReceived(snapshot));
    } catch {
      yield* put(dockPlacementFailed());
    }
    while (true) {
      const {
        payload: [command],
      } = yield* take<ReturnType<typeof dockPlacementCommandRequested>>(commands);
      try {
        const snapshot = yield* call(invokePlacement, command);
        if (snapshot) yield* put(dockPlacementReceived(snapshot));
        if (command.action === 'begin-drag')
          yield* put(
            dockDragStartResolved(snapshot?.phase === 'dragging' ? snapshot.dragToken : null),
          );
        if (command.action === 'begin-resize')
          yield* put(dockResizeStartResolved(snapshot?.resizeToken ?? null));
      } catch {
        yield* put(dockPlacementFailed());
        if (command.action === 'begin-drag') yield* put(dockDragStartResolved(null));
        if (command.action === 'begin-resize') yield* put(dockResizeStartResolved(null));
      }
    }
  } finally {
    commands.close();
    yield* cancel(updates);
    yield* cancel(focus);
  }
}
