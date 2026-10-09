import { connectionsListReceived, authRejectedReceived } from '../../connections/connections-slice';
import { connectionStatusChanged, heartbeatFailed } from '../../daemon-health/daemon-health-slice';
import {
  daemonEventsSubscribing,
  daemonEventsSubscribed,
} from '../../workspace-events/workspace-events-slice';
import {
  principalContextChanged,
  principalReadStarted,
  principalReceived,
  principalReadFailed,
  hostMembershipChanged,
  principalIdentityChanged,
} from '../../principal/principal-slice';
import {
  setLabsMultiplayerEnabled,
  toggleLabsMultiplayer,
} from '../../user-preferences/user-preferences-slice';
import {
  replaceWorkspaceList,
  setWorkspaceEntity,
  updateWorkspaceEntity,
  bulkUpdateWorkspaceEntities,
  removeWorkspaceEntity,
  resetWorkspaceState,
} from '../../workspace/workspace-slice';
import { scriptsOutputSaga } from './scripts-output-saga';
import { selectWorkspaceActionContext } from '../../workspace/workspace-selectors';
import type { SagaGenerator } from 'typed-redux-saga';
import { all, call, put, race, take, takeEvery } from 'typed-redux-saga';

import { m } from '$shared/paraglide/messages.js';
import { notify } from '$lib/components/patterns/notify';
import { scriptsClient } from '$features/scripts/scripts.client';
import { runMutation } from '$lib/client/live/live-support';
import { isLiveScriptStatus } from '$features/scripts/utils/script-status';
import { scriptRuntimeSnapshot } from '$features/scripts/utils/script-change';
import {
  beginScriptRead,
  isScriptReadCurrent,
  type ScriptReadContext,
} from '../utils/script-read-context';
import {
  selectScriptById,
  selectWorkspaceScriptOperations,
  selectScriptDetectionOperation,
} from '../scripts-selectors';
import { takeLeadingInContext } from '../../../utils/context-saga-effects';
import {
  backendReconnected,
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  clearScriptOperations,
  deleteScriptRequested,
  removeScript,
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
  | typeof startScriptRequested
  | typeof stopScriptRequested
  | typeof restartScriptRequested
  | typeof deleteScriptRequested
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

function operationFor(action: ScriptOperationRequest): Exclude<ScriptQuickAction, 'edit'> {
  if (action.type === deleteScriptRequested.type) return 'delete';
  if (action.type === stopScriptRequested.type) return 'stop';
  return action.type === restartScriptRequested.type ? 'restart' : 'start';
}

function* waitForReadInvalidation(context: ScriptReadContext): SagaGenerator<true> {
  while (yield* isScriptReadCurrent(context)) {
    yield* take([
      backendReconnected,
      workspaceUnmounted,
      workspaceDeleted,
      scriptReadFinished,
      connectionsListReceived,
      authRejectedReceived,
      connectionStatusChanged,
      heartbeatFailed,
      daemonEventsSubscribing,
      daemonEventsSubscribed,
      principalContextChanged,
      principalReadStarted,
      principalReceived,
      principalReadFailed,
      hostMembershipChanged,
      principalIdentityChanged,
      setLabsMultiplayerEnabled,
      toggleLabsMultiplayer,
      replaceWorkspaceList,
      setWorkspaceEntity,
      updateWorkspaceEntity,
      bulkUpdateWorkspaceEntities,
      removeWorkspaceEntity,
      resetWorkspaceState,
    ]);
  }
  return true;
}

/** Internal transport for the delete reservation already acquired by the reducer. */
function removeReservedScript(workspaceId: string, scriptId: string) {
  return runMutation('script.remove', { workspaceId, scriptId });
}

function* runScriptOperation(action: ScriptOperationRequest): SagaGenerator<void> {
  const [workspaceId, scriptId, failureMessage] = action.payload;
  const operation = operationFor(action);
  if ((yield* selectScriptDetectionOperation.effect(workspaceId))?.pending) return;
  const authority = yield* selectWorkspaceActionContext.effect(workspaceId);
  const pendingOperation = (yield* selectWorkspaceScriptOperations.effect(workspaceId))[scriptId];
  // Definition edits share the reducer reservation but run in their caller.
  // A lifecycle request rejected by that reservation must not send an RPC.
  if (pendingOperation?.pending && pendingOperation.action !== operation) return;
  if (!authority) {
    if (pendingOperation?.pending) {
      const message = m.workspace_client_accessChanged_error();
      yield* put(scriptOperationFailed(workspaceId, scriptId, operation, message));
      if (failureMessage) yield* call([notify, notify.error], message);
    }
    return;
  }
  const before = yield* selectScriptById.effect(workspaceId, scriptId);
  // Older daemons reset finished scripts silently. A changed row proves that
  // an event/read already supplied authority; otherwise reconcile runtime only.
  const stoppedRead =
    operation === 'stop' && before?.runtime.status === 'exited'
      ? yield* beginScriptRead(workspaceId)
      : undefined;
  let cleanedUp = false;
  try {
    if (operation === 'delete' && (!before || isLiveScriptStatus(before.runtime?.status))) return;
    const method = operation === 'delete' ? removeReservedScript : scriptsClient[operation];
    const request = method(workspaceId, scriptId);
    const outcome = yield* race({
      result: call(() => request),
      cleanup: take(matchesWorkspaceCleanup(workspaceId)),
    });
    if (outcome.cleanup) {
      cleanedUp = true;
      // The daemon cannot cancel removal. Keep ownership until it settles so a
      // definition save cannot recreate the row while deletion is still running.
      if (operation === 'delete') yield* call(() => request);
      return;
    }
    if (authority !== (yield* selectWorkspaceActionContext.effect(workspaceId))) return;
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
    if (operation === 'delete') yield* put(removeScript(workspaceId, scriptId));
    else yield* put(scriptOperationSucceeded(workspaceId, scriptId, operation));
  } catch (error) {
    if (cleanedUp || authority !== (yield* selectWorkspaceActionContext.effect(workspaceId)))
      return;
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
      [startScriptRequested, stopScriptRequested, restartScriptRequested, deleteScriptRequested],
      operationContext,
      runScriptOperation,
    ),
    takeEvery(workspaceUnmounted, clearWorkspaceOperations),
    takeEvery(workspaceDeleted, clearWorkspaceOperations),
  ]);
}
