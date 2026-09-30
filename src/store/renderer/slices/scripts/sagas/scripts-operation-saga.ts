import { appClient } from '$lib/client';
import { m } from '$shared/paraglide/messages.js';
import { selectWorkspaceActionContext } from '../../workspace/workspace-selectors';
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
  scriptArchiveRequested,
  scriptArchiveFinished,
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
  const authority = yield* selectWorkspaceActionContext.effect(workspaceId);
  if (!authority) return;
  try {
    const outcome = yield* race({
      result: call([scriptsClient, scriptsClient[operation]], workspaceId, scriptId),
      cleanup: take(matchesWorkspaceCleanup(workspaceId)),
    });
    if (outcome.cleanup || authority !== (yield* selectWorkspaceActionContext.effect(workspaceId)))
      return;
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
    if (authority !== (yield* selectWorkspaceActionContext.effect(workspaceId))) return;
    yield* put(scriptOperationFailed(workspaceId, scriptId, operation, errorMessage(error)));
  }
}

function* clearWorkspaceOperations(
  action: ReturnType<typeof workspaceUnmounted | typeof workspaceDeleted>,
): SagaGenerator<void> {
  yield* put(clearScriptOperations(action.payload[0]));
}

function* runArchiveOperation(
  action: ReturnType<typeof scriptArchiveRequested>,
): SagaGenerator<void> {
  const [workspaceId, scriptIds, operation] = action.payload;
  const authority = yield* selectWorkspaceActionContext.effect(workspaceId);
  if (!authority) {
    yield* put(scriptArchiveFinished(workspaceId, { error: m.error_handling_permission_error() }));
    return;
  }
  let reconcile = false;
  try {
    const method = appClient.scripts[operation];
    if (!method || !appClient.scripts.supportsLifecycle) {
      throw new Error(m.scripts_history_unsupported_error());
    }
    const negotiation = yield* race({
      supported: call([appClient.scripts, appClient.scripts.supportsLifecycle]),
      cleanup: take(matchesWorkspaceCleanup(workspaceId)),
    });
    if (
      negotiation.cleanup ||
      authority !== (yield* selectWorkspaceActionContext.effect(workspaceId))
    )
      return;
    if (!negotiation.supported) throw new Error(m.scripts_history_unsupported_error());
    reconcile = true;
    const outcome = yield* race({
      result: call([appClient.scripts, method], workspaceId, scriptIds),
      cleanup: take(matchesWorkspaceCleanup(workspaceId)),
    });
    if (outcome.cleanup) {
      reconcile = false;
      return;
    }
    if (authority !== (yield* selectWorkspaceActionContext.effect(workspaceId))) return;
    if (outcome.result) {
      const result = outcome.result;
      yield* put(
        scriptArchiveFinished(workspaceId, {
          changed: 'archived' in result ? result.archived.length : result.restored.length,
          skipped: result.skipped.length,
        }),
      );
    }
  } catch (error) {
    if (authority !== (yield* selectWorkspaceActionContext.effect(workspaceId))) return;
    yield* put(scriptArchiveFinished(workspaceId, { error: errorMessage(error) }));
  } finally {
    // A persistence failure can follow earlier per-ID commits. Re-read while this
    // workspace authority is still current; cleanup must not revive its requests.
    if (reconcile && authority === (yield* selectWorkspaceActionContext.effect(workspaceId))) {
      yield* put(refreshScripts(workspaceId, true));
    }
  }
}

export function* scriptsOperationSaga(): SagaGenerator<void> {
  yield* all([
    takeLeadingInContext(
      [scriptArchiveRequested],
      (action) => action.payload[0],
      runArchiveOperation,
    ),
    takeLeadingInContext(
      [startScriptRequested, stopScriptRequested, restartScriptRequested],
      operationContext,
      runScriptOperation,
    ),
    takeEvery(workspaceUnmounted, clearWorkspaceOperations),
    takeEvery(workspaceDeleted, clearWorkspaceOperations),
  ]);
}
