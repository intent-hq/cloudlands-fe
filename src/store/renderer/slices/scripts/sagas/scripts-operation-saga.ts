import type { SagaGenerator } from 'typed-redux-saga';
import { all, call, put, race, take, takeEvery } from 'typed-redux-saga';

import { scriptsClient } from '$features/scripts/scripts.client';
import { takeLeadingInContext } from '../../../utils/context-saga-effects';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  clearScriptOperations,
  refreshScripts,
  restartScriptRequested,
  scriptOperationFailed,
  scriptOperationSucceeded,
  startScriptRequested,
  stopScriptRequested,
} from '../scripts-slice';
import type { ScriptQuickAction } from '../scripts-types';

type ScriptOperationRequest = ReturnType<
  typeof startScriptRequested | typeof stopScriptRequested | typeof restartScriptRequested
>;

function operationContext(action: ScriptOperationRequest): string {
  return `${action.payload[0]}:${action.payload[1]}`;
}

function matchesWorkspaceCleanup(workspaceId: string) {
  return (action: { type: string; payload?: unknown }) =>
    (action.type === workspaceUnmounted.type || action.type === workspaceDeleted.type) &&
    Array.isArray(action.payload) &&
    action.payload[0] === workspaceId;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function operationFor(action: ScriptOperationRequest): ScriptQuickAction {
  if (action.type === stopScriptRequested.type) return 'stop';
  return action.type === restartScriptRequested.type ? 'restart' : 'start';
}

function* runScriptOperation(action: ScriptOperationRequest): SagaGenerator<void> {
  const [workspaceId, scriptId] = action.payload;
  const operation = operationFor(action);
  try {
    const outcome = yield* race({
      result: call([scriptsClient, scriptsClient[operation]], workspaceId, scriptId),
      cleanup: take(matchesWorkspaceCleanup(workspaceId)),
    });
    if (outcome.cleanup) return;
    if (!outcome.result?.success) {
      yield* put(
        scriptOperationFailed(
          workspaceId,
          scriptId,
          operation,
          outcome.result?.error ?? 'Script operation failed',
        ),
      );
      return;
    }
    yield* put(scriptOperationSucceeded(workspaceId, scriptId, operation));
    yield* put(refreshScripts(workspaceId));
  } catch (error) {
    yield* put(scriptOperationFailed(workspaceId, scriptId, operation, errorMessage(error)));
  }
}

function* clearWorkspaceOperations(
  action: ReturnType<typeof workspaceUnmounted | typeof workspaceDeleted>,
): SagaGenerator<void> {
  yield* put(clearScriptOperations(action.payload[0]));
}

export function* scriptsOperationSaga(): SagaGenerator<void> {
  yield* all([
    takeLeadingInContext(
      [startScriptRequested, stopScriptRequested, restartScriptRequested],
      operationContext,
      runScriptOperation,
    ),
    takeEvery(workspaceUnmounted, clearWorkspaceOperations),
    takeEvery(workspaceDeleted, clearWorkspaceOperations),
  ]);
}
