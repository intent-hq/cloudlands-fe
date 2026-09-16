import type { SagaGenerator } from 'typed-redux-saga';
import { call, cancelled, join, put } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { takeLatestInContext, takeLeadingInContext } from '../../../utils/context-saga-effects';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  addTerminal,
  createTerminalFromOverlayFailed,
  createTerminalFromOverlayRequested,
  createTerminalFromOverlaySucceeded,
  createTerminalWithCommandRequested,
  openTerminalOverlay,
} from '../terminals-slice';

type TerminalOperationAction =
  | ReturnType<typeof createTerminalWithCommandRequested>
  | ReturnType<typeof createTerminalFromOverlayRequested>
  | ReturnType<typeof workspaceUnmounted>;

function operationContext(action: TerminalOperationAction) {
  const workspaceId = action.payload[0];
  return action.type === workspaceUnmounted.type
    ? { context: workspaceId, cancel: true as const }
    : workspaceId;
}

function* createTerminalWithCommandWorker(action: TerminalOperationAction): SagaGenerator<void> {
  if (action.type === workspaceUnmounted.type) return;
  const request = action as ReturnType<typeof createTerminalWithCommandRequested>;
  let settled = false;
  try {
    const [workspaceId, command, cwd, title] = request.payload;
    const result = yield* call([appClient.terminals, appClient.terminals.create], {
      workspaceId,
      command,
      cwd,
      cols: 80,
      rows: 24,
    });
    if (!result.success || !result.id) throw new Error(result.error ?? 'Terminal creation failed');
    yield* put(addTerminal(workspaceId, result.id, title));
    yield* put(openTerminalOverlay(workspaceId, result.id));
    yield* put(request.success(result.id));
    settled = true;
  } catch (error) {
    yield* put(request.failure(error instanceof Error ? error : new Error(String(error))));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(request.failure(new Error('Terminal creation cancelled')));
    }
  }
}

function* createTerminalWorker(
  action:
    ReturnType<typeof createTerminalFromOverlayRequested> | ReturnType<typeof workspaceUnmounted>,
): SagaGenerator<void> {
  if (action.type === workspaceUnmounted.type) return;
  let settled = false;
  const [workspaceId] = action.payload;
  try {
    const result = yield* call([appClient.terminals, appClient.terminals.create], {
      workspaceId,
      cols: 80,
      rows: 24,
    });
    if (!result.success || !result.id) throw new Error(result.error ?? 'Terminal creation failed');
    yield* put(addTerminal(workspaceId, result.id));
    yield* put(openTerminalOverlay(workspaceId, result.id));
    yield* put(createTerminalFromOverlaySucceeded(workspaceId, result.id));
    settled = true;
  } catch (error) {
    yield* put(
      createTerminalFromOverlayFailed(
        workspaceId,
        error instanceof Error ? error.message : String(error),
      ),
    );
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(createTerminalFromOverlayFailed(workspaceId, 'Terminal creation cancelled'));
    }
  }
}

export function* terminalOperationSaga(): SagaGenerator<void> {
  const watcher = yield* takeLatestInContext(
    [createTerminalWithCommandRequested, workspaceUnmounted],
    operationContext,
    createTerminalWithCommandWorker,
  );
  const overlayWatcher = yield* takeLeadingInContext(
    [createTerminalFromOverlayRequested, workspaceUnmounted],
    operationContext,
    createTerminalWorker,
  );
  yield* join(watcher);
  yield* join(overlayWatcher);
}
