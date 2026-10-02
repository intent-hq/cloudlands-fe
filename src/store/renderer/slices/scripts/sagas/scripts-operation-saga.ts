import { scriptsOutputSaga } from './scripts-output-saga';
import { selectWorkspaceActionContext } from '../../workspace/workspace-selectors';
import type { SagaGenerator } from 'typed-redux-saga';
import { all, call, put, race, take, takeEvery } from 'typed-redux-saga';

import { notify } from '$lib/components/patterns/notify';
import { scriptsClient } from '$features/scripts/scripts.client';
import { scriptRuntimeSnapshot } from '$features/scripts/utils/script-change';
import {
  beginScriptRead,
  isScriptReadCurrent,
  type ScriptReadContext,
} from '../utils/script-read-context';
import { selectScriptById, selectWorkspaceScriptOperations } from '../scripts-selectors';
import { takeLeadingInContext } from '../../../utils/context-saga-effects';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  clearScriptOperations,
  restartScriptRequested,
  scriptOperationFailed,
  scriptOperationSucceeded,
  scriptReadFinished,
  startScriptRequested,
  stopScriptRequested,
  updateRuntimeState,
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

function* waitForReadInvalidation(context: ScriptReadContext): SagaGenerator<true> {
  while (yield* isScriptReadCurrent(context)) yield* take('*');
  return true;
}

function* runScriptOperation(action: ScriptOperationRequest): SagaGenerator<void> {
  const [workspaceId, scriptId, failureMessage] = action.payload;
  const operation = operationFor(action);
  const authority = yield* selectWorkspaceActionContext.effect(workspaceId);
  if (!authority) return;
  const pendingOperation = (yield* selectWorkspaceScriptOperations.effect(workspaceId))[scriptId];
  const before = yield* selectScriptById.effect(workspaceId, scriptId);
  // Older daemons reset finished scripts silently. A changed row proves that
  // an event/read already supplied authority; otherwise reconcile runtime only.
  const stoppedRead =
    operation === 'stop' && before?.runtime.status === 'exited'
      ? yield* beginScriptRead(workspaceId)
      : undefined;
  try {
    const outcome = yield* race({
      result: call([scriptsClient, scriptsClient[operation]], workspaceId, scriptId),
      cleanup: take(matchesWorkspaceCleanup(workspaceId)),
    });
    if (outcome.cleanup || authority !== (yield* selectWorkspaceActionContext.effect(workspaceId)))
      return;
    if (!outcome.result?.success) {
      const message = outcome.result?.error || failureMessage || 'Script operation failed';
      yield* put(scriptOperationFailed(workspaceId, scriptId, operation, message));
      if (failureMessage) yield* call([notify, notify.error], message);
      return;
    }
    if (
      stoppedRead &&
      (yield* isScriptReadCurrent(stoppedRead)) &&
      before === (yield* selectScriptById.effect(workspaceId, scriptId))
    ) {
      try {
        const { result } = yield* race({
          result: call([scriptsClient, scriptsClient.getStatus], workspaceId, scriptId),
          invalidated: call(waitForReadInvalidation, stoppedRead),
        });
        const runtime = result?.success ? scriptRuntimeSnapshot(result.status) : undefined;
        if (
          runtime &&
          (yield* isScriptReadCurrent(stoppedRead)) &&
          before === (yield* selectScriptById.effect(workspaceId, scriptId))
        ) {
          yield* put(updateRuntimeState(workspaceId, scriptId, runtime, true));
        }
      } catch {
        // The stop succeeded; a failed compatibility read must not report that
        // the mutation failed. Reconnect still reconciles the authoritative row.
      }
    }
    if (stoppedRead && !(yield* isScriptReadCurrent(stoppedRead))) return;
    yield* put(scriptOperationSucceeded(workspaceId, scriptId, operation));
  } catch (error) {
    if (authority !== (yield* selectWorkspaceActionContext.effect(workspaceId))) return;
    const message = errorMessage(error);
    yield* put(scriptOperationFailed(workspaceId, scriptId, operation, message));
    if (failureMessage) yield* call([notify, notify.error], message || failureMessage);
  } finally {
    // Retire only this request's pending state. Failed or newer operations must
    // survive cleanup from a cancelled compatibility read.
    if (
      pendingOperation?.pending &&
      pendingOperation === (yield* selectWorkspaceScriptOperations.effect(workspaceId))[scriptId]
    )
      yield* put(scriptOperationSucceeded(workspaceId, scriptId, operation));
    if (stoppedRead) yield* put(scriptReadFinished(workspaceId, stoppedRead.requestId));
  }
}

function* clearWorkspaceOperations(
  action: ReturnType<typeof workspaceUnmounted | typeof workspaceDeleted>,
): SagaGenerator<void> {
  yield* put(clearScriptOperations(action.payload[0]));
}

export function* scriptsOperationSaga(): SagaGenerator<void> {
  yield* all([
    call(scriptsOutputSaga),
    takeLeadingInContext(
      [startScriptRequested, stopScriptRequested, restartScriptRequested],
      operationContext,
      runScriptOperation,
    ),
    takeEvery(workspaceUnmounted, clearWorkspaceOperations),
    takeEvery(workspaceDeleted, clearWorkspaceOperations),
  ]);
}
