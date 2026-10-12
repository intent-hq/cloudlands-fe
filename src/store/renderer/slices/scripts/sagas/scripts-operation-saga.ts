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
import { all, call, cancelled, put, race, take, takeEvery } from 'typed-redux-saga';

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
  applyScriptDefinitionChangesRequested,
  clearScriptOperations,
  createScriptDefinitionRequested,
  detectScriptDefinitionsRequested,
  deleteScriptRequested,
  refreshScripts,
  removeScript,
  removeScriptDefinitionRequested,
  restartScriptRequested,
  restoreScriptDefinitionsRequested,
  saveScriptDefinitionsToRepoRequested,
  scriptDefinitionChangesReleased,
  scriptOperationFailed,
  scriptOperationSucceeded,
  scriptReadFinished,
  startScriptRequested,
  stopScriptRequested,
  updateRuntimeState,
  updateScriptDefinitionRequested,
} from '../scripts-slice';
import type { ScriptDetectionOutcome, ScriptQuickAction } from '../scripts-types';

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

function failure(error: unknown): Error {
  return error instanceof Error ? error : new Error(errorMessage(error));
}

function* scriptAuthority(workspaceId: string, expected?: string): SagaGenerator<string> {
  const authority = yield* selectWorkspaceActionContext.effect(workspaceId);
  if (!authority || (expected !== undefined && authority !== expected)) {
    throw new Error(m.workspace_client_accessChanged_error());
  }
  return authority;
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

function* createScriptDefinition(
  action: ReturnType<typeof createScriptDefinitionRequested>,
): SagaGenerator<void> {
  let settled = false;
  try {
    const [workspaceId, input] = action.payload;
    const authority = yield* scriptAuthority(workspaceId);
    const result = yield* call([scriptsClient, scriptsClient.create], workspaceId, input);
    yield* scriptAuthority(workspaceId, authority);
    if (!result.success || !result.data) throw new Error(result.error ?? 'Script creation failed');
    yield* put(refreshScripts(workspaceId));
    yield* put(action.success(result.data));
    settled = true;
  } catch (error) {
    yield* put(action.failure(failure(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('Script creation cancelled')));
  }
}

function* updateScriptDefinition(
  action: ReturnType<typeof updateScriptDefinitionRequested>,
): SagaGenerator<void> {
  let settled = false;
  try {
    const [workspaceId, scriptId, updates] = action.payload;
    const authority = yield* scriptAuthority(workspaceId);
    const result = yield* call(
      [scriptsClient, scriptsClient.update],
      workspaceId,
      scriptId,
      updates,
    );
    yield* scriptAuthority(workspaceId, authority);
    if (!result.success || !result.data) throw new Error(result.error ?? 'Script update failed');
    yield* put(refreshScripts(workspaceId));
    yield* put(action.success(result.data));
    settled = true;
  } catch (error) {
    yield* put(action.failure(failure(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('Script update cancelled')));
  }
}

function* removeScriptDefinition(
  action: ReturnType<typeof removeScriptDefinitionRequested>,
): SagaGenerator<void> {
  let settled = false;
  try {
    const [workspaceId, scriptId] = action.payload;
    const authority = yield* scriptAuthority(workspaceId);
    const result = yield* call([scriptsClient, scriptsClient.remove], workspaceId, scriptId);
    yield* scriptAuthority(workspaceId, authority);
    if (!result.success) throw new Error(result.error ?? 'Script removal failed');
    yield* put(action.success(undefined as void));
    settled = true;
  } catch (error) {
    yield* put(action.failure(failure(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('Script removal cancelled')));
  }
}

function detectionOutcome(result: {
  detected?: number;
  added?: number;
  removed?: number;
  skippedRunning?: string[];
  packageManager?: ScriptDetectionOutcome['packageManager'];
}): ScriptDetectionOutcome {
  return {
    detected: result.detected ?? 0,
    added: result.added ?? 0,
    updated: 0,
    removed: result.removed ?? 0,
    skippedRunning: result.skippedRunning ?? [],
    ...(result.packageManager ? { packageManager: result.packageManager } : {}),
  };
}

function* detectScriptDefinitions(
  action: ReturnType<typeof detectScriptDefinitionsRequested>,
): SagaGenerator<void> {
  let settled = false;
  try {
    const [workspaceId] = action.payload;
    const authority = yield* scriptAuthority(workspaceId);
    const result = yield* call([scriptsClient, scriptsClient.detect], workspaceId);
    yield* scriptAuthority(workspaceId, authority);
    if (!result.success) throw new Error(result.error ?? 'Script detection failed');
    yield* put(refreshScripts(workspaceId));
    yield* put(action.success(detectionOutcome(result)));
    settled = true;
  } catch (error) {
    yield* put(action.failure(failure(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('Script detection cancelled')));
  }
}

type ScriptDefinitionChangesLifetime = { ended: boolean };

function* waitForScriptDefinitionChangesRelease(
  workspaceId: string,
  consumerId: string,
  lifetime: ScriptDefinitionChangesLifetime,
): SagaGenerator<void> {
  for (;;) {
    const action = yield* take(scriptDefinitionChangesReleased);
    if (action.payload[0] !== workspaceId || action.payload[1] !== consumerId) continue;
    lifetime.ended = true;
    return;
  }
}

function* waitForScriptDefinitionChangesUnmount(
  workspaceId: string,
  lifetime: ScriptDefinitionChangesLifetime,
): SagaGenerator<void> {
  for (;;) {
    const action = yield* take(workspaceUnmounted);
    if (action.payload[0] !== workspaceId) continue;
    lifetime.ended = true;
    return;
  }
}

function* waitForScriptDefinitionChangesDelete(
  workspaceId: string,
  lifetime: ScriptDefinitionChangesLifetime,
): SagaGenerator<void> {
  for (;;) {
    const action = yield* take(workspaceDeleted);
    if (action.payload[0] !== workspaceId) continue;
    lifetime.ended = true;
    return;
  }
}

function* applyScriptDefinitionChanges(
  action: ReturnType<typeof applyScriptDefinitionChangesRequested>,
  lifetime: ScriptDefinitionChangesLifetime,
): SagaGenerator<void> {
  let settled = false;
  try {
    const [workspaceId, changes, definitions] = action.payload;
    const authority = yield* scriptAuthority(workspaceId);
    const autoDetectedIds = new Set(
      definitions.filter((script) => script.source === 'auto-detected').map((script) => script.id),
    );
    const entriesById = new Map(definitions.map((script) => [script.id, script]));
    const isCurrent = () => !lifetime.ended;
    const skippedRunning = new Set<string>();
    let added = 0;
    let updated = 0;
    let removed = 0;

    for (const scriptId of changes.remove) {
      const target = entriesById.get(scriptId);
      if (!target || !autoDetectedIds.has(scriptId)) continue;
      if (target.runtime?.status === 'running') {
        skippedRunning.add(target.name);
        continue;
      }
      yield* scriptAuthority(workspaceId, authority);
      const result = yield* call(
        [scriptsClient, scriptsClient.remove],
        workspaceId,
        scriptId,
        target,
        isCurrent,
      );
      if (result.success) removed += 1;
    }
    for (const { id, updates } of changes.update) {
      const target = entriesById.get(id);
      if (!target || !autoDetectedIds.has(id)) continue;
      if (target.runtime?.status === 'running') {
        skippedRunning.add(target.name);
        continue;
      }
      yield* scriptAuthority(workspaceId, authority);
      const result = yield* call(
        [scriptsClient, scriptsClient.update],
        workspaceId,
        id,
        updates,
        target,
        isCurrent,
      );
      if (result.success) updated += 1;
    }
    for (const input of changes.add) {
      yield* scriptAuthority(workspaceId, authority);
      const result = yield* call([scriptsClient, scriptsClient.create], workspaceId, input);
      if (result.success && result.data) {
        added += 1;
      }
    }
    yield* scriptAuthority(workspaceId, authority);
    yield* put(refreshScripts(workspaceId));
    yield* put(
      action.success({
        detected: changes.add.length,
        added,
        updated,
        removed,
        skippedRunning: [...skippedRunning],
      }),
    );
    settled = true;
  } catch (error) {
    yield* put(action.failure(failure(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('Applying script changes cancelled')));
  }
}

function* runScriptDefinitionChanges(
  action: ReturnType<typeof applyScriptDefinitionChangesRequested>,
): SagaGenerator<void> {
  const [workspaceId, , , consumerId] = action.payload;
  const lifetime: ScriptDefinitionChangesLifetime = { ended: false };
  yield* race({
    operation: call(applyScriptDefinitionChanges, action, lifetime),
    released: call(waitForScriptDefinitionChangesRelease, workspaceId, consumerId, lifetime),
    unmounted: call(waitForScriptDefinitionChangesUnmount, workspaceId, lifetime),
    deleted: call(waitForScriptDefinitionChangesDelete, workspaceId, lifetime),
  });
}

function* restoreScriptDefinitions(
  action: ReturnType<typeof restoreScriptDefinitionsRequested>,
): SagaGenerator<void> {
  let settled = false;
  try {
    const [workspaceId, snapshot] = action.payload;
    const authority = yield* scriptAuthority(workspaceId);
    const result = yield* call(
      [scriptsClient, scriptsClient.restoreSnapshot],
      workspaceId,
      snapshot,
    );
    yield* scriptAuthority(workspaceId, authority);
    if (!result.success) throw new Error(result.error ?? 'Script restore failed');
    yield* put(refreshScripts(workspaceId));
    yield* put(action.success(undefined as void));
    settled = true;
  } catch (error) {
    yield* put(action.failure(failure(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('Script restore cancelled')));
  }
}

function* saveScriptDefinitionsToRepo(
  action: ReturnType<typeof saveScriptDefinitionsToRepoRequested>,
): SagaGenerator<void> {
  let settled = false;
  try {
    const [workspaceId] = action.payload;
    const authority = yield* scriptAuthority(workspaceId);
    const result = yield* call([scriptsClient, scriptsClient.saveToRepo], workspaceId);
    yield* scriptAuthority(workspaceId, authority);
    if (!result.success) throw new Error(result.error ?? 'Saving scripts failed');
    yield* put(action.success(undefined as void));
    settled = true;
  } catch (error) {
    yield* put(action.failure(failure(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('Saving scripts cancelled')));
  }
}

export function* scriptsOperationSaga(): SagaGenerator<void> {
  yield* all([
    call(scriptsOutputSaga),
    takeLeadingInContext(
      [startScriptRequested, stopScriptRequested, restartScriptRequested, deleteScriptRequested],
      operationContext,
      runScriptOperation,
    ),
    takeEvery(createScriptDefinitionRequested, createScriptDefinition),
    takeEvery(updateScriptDefinitionRequested, updateScriptDefinition),
    takeEvery(removeScriptDefinitionRequested, removeScriptDefinition),
    takeEvery(detectScriptDefinitionsRequested, detectScriptDefinitions),
    takeEvery(applyScriptDefinitionChangesRequested, runScriptDefinitionChanges),
    takeEvery(restoreScriptDefinitionsRequested, restoreScriptDefinitions),
    takeEvery(saveScriptDefinitionsToRepoRequested, saveScriptDefinitionsToRepo),
    takeEvery(workspaceUnmounted, clearWorkspaceOperations),
    takeEvery(workspaceDeleted, clearWorkspaceOperations),
  ]);
}
