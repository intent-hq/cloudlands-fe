import {
  all,
  call,
  cancelled,
  put,
  race,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';
import { m } from '$shared/paraglide/messages.js';
import { notify } from '$lib/components/patterns/notify';
import { scriptDefinitionTransport } from '$features/scripts/script-definition-transport';
import { scriptRuntimeSnapshot } from '$features/scripts/utils/script-change';
import { isLiveScriptStatus } from '$features/scripts/utils/script-status';
import { scriptOutputTailText } from '$lib/utils/script-output-text';
import { WorkspaceId } from '$shared/types/branded-ids';
import { scriptsOutputSaga } from './scripts-output-saga';
import { takeLeadingInContext } from '../../../utils/context-saga-effects';
import { selectWorkspaceActionContext } from '../../workspace/workspace-selectors';
import {
  selectScriptById,
  selectScriptDetectionOperation,
  selectScriptOutput,
  selectWorkspaceScriptOperations,
} from '../scripts-selectors';
import { createAgentFromConfigRequested } from '../../workspace-agents/workspace-agents-slice';
import {
  clearScriptOperations,
  createScriptFixAgentRequested,
  createScriptDefinitionRequested,
  detectScriptDefinitionsRequested,
  deleteScriptRequested,
  editScriptRequested,
  getScriptDefinitionRequested,
  listScriptDefinitionsRequested,
  refreshScripts,
  removeScript,
  removeScriptDefinitionRequested,
  removeScriptDefinitionsRequested,
  restartScriptRequested,
  saveScriptDefinitionsToRepoRequested,
  scriptDetectionFinished,
  scriptDetectionRequested,
  scriptOperationFailed,
  scriptOperationSucceeded,
  scriptReadFinished,
  scriptWorkflowFinished,
  scriptWorkflowReleased,
  startScriptRequested,
  stopScriptRequested,
  updateRuntimeState,
  updateScriptDefinitionRequested,
} from '../scripts-slice';
import {
  beginScriptRead,
  isScriptReadCurrent,
  reconcileScriptRead,
  type ScriptReadContext,
} from '../utils/script-read-context';
import type {
  ScriptBulkRemovalOutcome,
  ScriptDetectionOutcome,
  ScriptOperationState,
  ScriptQuickAction,
  ScriptWorkflowConsumer,
  ScriptWithState,
} from '../scripts-types';
import {
  backendReconnected,
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
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

type ScriptOperationRequest = ReturnType<
  | typeof startScriptRequested
  | typeof stopScriptRequested
  | typeof restartScriptRequested
  | typeof deleteScriptRequested
>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(errorMessage(error));
}

function operationFor(action: ScriptOperationRequest): Exclude<ScriptQuickAction, 'edit'> {
  if (action.type === deleteScriptRequested.type) return 'delete';
  if (action.type === stopScriptRequested.type) return 'stop';
  return action.type === restartScriptRequested.type ? 'restart' : 'start';
}

function operationContext(action: ScriptOperationRequest): string {
  return `${action.payload[0]}:${action.payload[1]}`;
}

function matchesWorkspaceCleanup(workspaceId: string) {
  return (action: { type: string; payload?: unknown }) =>
    (action.type === workspaceUnmounted.type || action.type === workspaceDeleted.type) &&
    Array.isArray(action.payload) &&
    action.payload[0] === workspaceId;
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

function* requireAuthority(workspaceId: string, expected?: string): SagaGenerator<string> {
  const authority = yield* selectWorkspaceActionContext.effect(workspaceId);
  if (!authority || (expected !== undefined && authority !== expected)) {
    throw new Error(m.workspace_client_accessChanged_error());
  }
  return authority;
}

function* finishWorkflow(
  workspaceId: string,
  consumer: ScriptWorkflowConsumer | undefined,
  status: 'success' | 'failure' | 'cancelled',
  result?: Parameters<typeof scriptWorkflowFinished>[3],
  error?: string,
): SagaGenerator<void> {
  if (consumer) yield* put(scriptWorkflowFinished(workspaceId, consumer, status, result, error));
}

function* runScriptOperation(action: ScriptOperationRequest): SagaGenerator<void> {
  const [workspaceId, scriptId, failureMessage] = action.payload;
  const operation = operationFor(action);
  if ((yield* selectScriptDetectionOperation.effect(workspaceId))?.pending) return;
  const authority = yield* selectWorkspaceActionContext.effect(workspaceId);
  const pending = (yield* selectWorkspaceScriptOperations.effect(workspaceId))[scriptId];
  if (pending?.pending && pending.action !== operation) return;
  if (!authority) {
    if (pending?.pending) {
      const message = m.workspace_client_accessChanged_error();
      yield* put(scriptOperationFailed(workspaceId, scriptId, operation, message));
      if (failureMessage) yield* call([notify, notify.error], message);
    }
    return;
  }
  const before = yield* selectScriptById.effect(workspaceId, scriptId);
  const stoppedRead =
    operation === 'stop' && before?.runtime.status === 'exited'
      ? yield* beginScriptRead(workspaceId)
      : undefined;
  let cleanedUp = false;
  try {
    if (operation === 'delete' && !before) return;
    const request = (() => {
      switch (operation) {
        case 'delete':
          return scriptDefinitionTransport.remove(workspaceId, scriptId);
        case 'start':
          return scriptDefinitionTransport.start(workspaceId, scriptId);
        case 'stop':
          return scriptDefinitionTransport.stop(workspaceId, scriptId);
        case 'restart':
          return scriptDefinitionTransport.restart(workspaceId, scriptId);
      }
    })();
    const outcome = yield* race({
      result: call(() => request),
      cleanup: take(matchesWorkspaceCleanup(workspaceId)),
    });
    if (outcome.cleanup) {
      cleanedUp = true;
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
          result: call(() => scriptDefinitionTransport.status(workspaceId, scriptId)),
          invalidated: call(waitForReadInvalidation, stoppedRead),
        });
        const runtime = scriptRuntimeSnapshot(result);
        if (
          runtime &&
          (yield* isScriptReadCurrent(stoppedRead)) &&
          before === (yield* selectScriptById.effect(workspaceId, scriptId))
        ) {
          yield* put(updateRuntimeState(workspaceId, scriptId, runtime, true));
        }
      } catch {
        // A compatibility status failure does not turn a successful stop into a failure.
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
    const current = (yield* selectWorkspaceScriptOperations.effect(workspaceId))[scriptId];
    if (
      pending?.pending &&
      current?.pending &&
      current.action === operation &&
      current.reservationId === pending.reservationId
    ) {
      yield* put(scriptOperationSucceeded(workspaceId, scriptId, operation));
    }
    if (stoppedRead) yield* put(scriptReadFinished(workspaceId, stoppedRead.requestId));
  }
}

function* readDefinition(workspaceId: string, scriptId: string): SagaGenerator<ScriptWithState> {
  const context = yield* beginScriptRead(workspaceId);
  try {
    const definition = yield* call(() => scriptDefinitionTransport.get(workspaceId, scriptId));
    const reconciliation = yield* reconcileScriptRead(context, [definition]);
    if (!reconciliation || reconciliation.definitionChanges.has(scriptId)) {
      throw new Error(m.scripts_pendingChange_error());
    }
    return definition;
  } finally {
    yield* put(scriptReadFinished(workspaceId, context.requestId));
  }
}

function* reserveEdit(
  workspaceId: string,
  scriptId: string,
  reservationId: string,
): SagaGenerator<ScriptOperationState> {
  let reservation = (yield* selectWorkspaceScriptOperations.effect(workspaceId))[scriptId];
  if (!reservation) {
    yield* put(editScriptRequested(workspaceId, scriptId, reservationId));
    reservation = (yield* selectWorkspaceScriptOperations.effect(workspaceId))[scriptId];
  }
  if (
    !reservation?.pending ||
    reservation.action !== 'edit' ||
    reservation.reservationId !== reservationId
  ) {
    throw new Error(m.scripts_pendingChange_error());
  }
  return reservation;
}

function* releaseEdit(
  workspaceId: string,
  scriptId: string,
  reservationId: string,
): SagaGenerator<void> {
  yield* put(scriptOperationSucceeded(workspaceId, scriptId, 'edit', reservationId));
}

function* createDefinition(
  action: ReturnType<typeof createScriptDefinitionRequested>,
): SagaGenerator<void> {
  const [workspaceId, input, consumer] = action.payload;
  let settled = false;
  try {
    const authority = yield* requireAuthority(workspaceId);
    const result = yield* call(() => scriptDefinitionTransport.create(workspaceId, input));
    yield* requireAuthority(workspaceId, authority);
    if (!result.success || !result.script)
      throw new Error(result.error ?? 'Script creation failed');
    yield* put(refreshScripts(workspaceId));
    yield* put(action.success(result.script));
    yield* finishWorkflow(workspaceId, consumer, 'success', result.script);
    settled = true;
  } catch (error) {
    const message = errorMessage(error);
    yield* put(action.failure(asError(error)));
    yield* finishWorkflow(workspaceId, consumer, 'failure', undefined, message);
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error('Script creation cancelled')));
      yield* finishWorkflow(workspaceId, consumer, 'cancelled');
    }
  }
}

function* updateDefinition(
  action: ReturnType<typeof updateScriptDefinitionRequested>,
): SagaGenerator<void> {
  const [workspaceId, scriptId, updates, consumer, selected] = action.payload;
  const reservationId = `${action.type}:${action.seq}`;
  let settled = false;
  try {
    const reservation = yield* reserveEdit(workspaceId, scriptId, reservationId);
    const authority = yield* requireAuthority(workspaceId);
    const cached = yield* selectScriptById.effect(workspaceId, scriptId);
    const current = yield* readDefinition(workspaceId, scriptId);
    if ((yield* selectWorkspaceScriptOperations.effect(workspaceId))[scriptId] !== reservation) {
      throw new Error(m.scripts_pendingChange_error());
    }
    if (cached && !selected && cached !== (yield* selectScriptById.effect(workspaceId, scriptId))) {
      throw new Error(m.scripts_pendingChange_error());
    }
    if (
      selected &&
      (selected.id !== scriptId ||
        selected.workspaceId !== workspaceId ||
        selected.archivedAt ||
        selected.source !== current.source ||
        selected.updatedAt !== current.updatedAt)
    ) {
      throw new Error(m.scripts_pendingChange_error());
    }
    if (current.id !== scriptId || current.workspaceId !== workspaceId || current.archivedAt) {
      throw new Error(m.scripts_pendingChange_error());
    }
    if (isLiveScriptStatus(current.runtime?.status)) {
      throw new Error(m.scripts_client_updateRunning_error({ name: current.name }));
    }
    const result = yield* call(() =>
      scriptDefinitionTransport.upsert(workspaceId, scriptId, {
        name: updates.name ?? current.name,
        command: updates.command ?? current.command,
        mode: updates.mode ?? current.mode,
        ...((updates.cwd !== undefined ? updates.cwd : current.cwd) !== undefined
          ? { cwd: updates.cwd !== undefined ? updates.cwd : current.cwd }
          : {}),
        ...((updates.env !== undefined ? updates.env : current.env) !== undefined
          ? { env: updates.env !== undefined ? updates.env : current.env }
          : {}),
        ...((updates.category !== undefined ? updates.category : current.category) !== undefined
          ? { category: updates.category !== undefined ? updates.category : current.category }
          : {}),
        ...((updates.autoStart !== undefined ? updates.autoStart : current.autoStart) !== undefined
          ? { autoStart: updates.autoStart !== undefined ? updates.autoStart : current.autoStart }
          : {}),
        ...((updates.healthUrl !== undefined ? updates.healthUrl : current.healthUrl) !== undefined
          ? { healthUrl: updates.healthUrl !== undefined ? updates.healthUrl : current.healthUrl }
          : {}),
        ...((updates.readyPattern !== undefined ? updates.readyPattern : current.readyPattern) !==
        undefined
          ? {
              readyPattern:
                updates.readyPattern !== undefined ? updates.readyPattern : current.readyPattern,
            }
          : {}),
      }),
    );
    yield* requireAuthority(workspaceId, authority);
    if (!result.success || !result.script) throw new Error(result.error ?? 'Script update failed');
    const canPublish =
      (yield* selectWorkspaceScriptOperations.effect(workspaceId))[scriptId] === reservation;
    if (canPublish) yield* put(refreshScripts(workspaceId));
    yield* put(action.success(result.script));
    yield* finishWorkflow(
      workspaceId,
      consumer,
      canPublish ? 'success' : 'cancelled',
      canPublish ? result.script : undefined,
    );
    settled = true;
  } catch (error) {
    const message = errorMessage(error);
    yield* put(action.failure(asError(error)));
    yield* finishWorkflow(workspaceId, consumer, 'failure', undefined, message);
    settled = true;
  } finally {
    yield* releaseEdit(workspaceId, scriptId, reservationId);
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error('Script update cancelled')));
      yield* finishWorkflow(workspaceId, consumer, 'cancelled');
    }
  }
}

function* removeDefinition(
  action: ReturnType<typeof removeScriptDefinitionRequested>,
): SagaGenerator<void> {
  const [workspaceId, scriptId, consumer, selected] = action.payload;
  const reservationId = `${action.type}:${action.seq}`;
  let settled = false;
  try {
    const reservation = yield* reserveEdit(workspaceId, scriptId, reservationId);
    const authority = yield* requireAuthority(workspaceId);
    const current = yield* readDefinition(workspaceId, scriptId);
    if ((yield* selectWorkspaceScriptOperations.effect(workspaceId))[scriptId] !== reservation) {
      throw new Error(m.scripts_pendingChange_error());
    }
    if (
      selected &&
      (selected.id !== scriptId ||
        selected.workspaceId !== workspaceId ||
        selected.archivedAt ||
        selected.source !== current.source ||
        selected.updatedAt !== current.updatedAt)
    ) {
      throw new Error(m.scripts_pendingChange_error());
    }
    if (
      current.id !== scriptId ||
      current.workspaceId !== workspaceId ||
      current.archivedAt ||
      (selected && isLiveScriptStatus(current.runtime?.status))
    ) {
      throw new Error(m.scripts_pendingChange_error());
    }
    const result = yield* call(() => scriptDefinitionTransport.remove(workspaceId, scriptId));
    yield* requireAuthority(workspaceId, authority);
    if (!result.success) throw new Error(result.error ?? 'Script removal failed');
    const canPublish =
      (yield* selectWorkspaceScriptOperations.effect(workspaceId))[scriptId] === reservation;
    if (canPublish) yield* put(removeScript(workspaceId, scriptId));
    yield* put(action.success(undefined));
    yield* finishWorkflow(workspaceId, consumer, canPublish ? 'success' : 'cancelled');
    settled = true;
  } catch (error) {
    const message = errorMessage(error);
    yield* put(action.failure(asError(error)));
    yield* finishWorkflow(workspaceId, consumer, 'failure', undefined, message);
    settled = true;
  } finally {
    yield* releaseEdit(workspaceId, scriptId, reservationId);
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error('Script removal cancelled')));
      yield* finishWorkflow(workspaceId, consumer, 'cancelled');
    }
  }
}

function* removeDefinitions(
  action: ReturnType<typeof removeScriptDefinitionsRequested>,
): SagaGenerator<void> {
  const [workspaceId, targets, failureMessage, consumer] = action.payload;
  const outcome: ScriptBulkRemovalOutcome = { removed: [], failed: [] };
  let settled = false;
  try {
    for (const target of targets) {
      const reservationId = `${action.type}:${action.seq}:${target.id}`;
      let pendingWrite: Promise<unknown> | undefined;
      try {
        const reservation = yield* reserveEdit(workspaceId, target.id, reservationId);
        const authority = yield* requireAuthority(workspaceId);
        const current = yield* readDefinition(workspaceId, target.id);
        if (
          (yield* selectWorkspaceScriptOperations.effect(workspaceId))[target.id] !== reservation
        ) {
          throw new Error(m.scripts_pendingChange_error());
        }
        if (
          target.workspaceId !== workspaceId ||
          current.id !== target.id ||
          current.workspaceId !== workspaceId ||
          current.archivedAt ||
          target.archivedAt ||
          current.source !== target.source ||
          current.updatedAt !== target.updatedAt
        ) {
          throw new Error(m.scripts_pendingChange_error());
        }
        yield* requireAuthority(workspaceId, authority);
        const request = scriptDefinitionTransport.remove(workspaceId, target.id);
        pendingWrite = request;
        const result = yield* call(() => request);
        pendingWrite = undefined;
        if (!result.success) throw new Error(result.error ?? failureMessage);
        outcome.removed.push(target.id);
        if ((yield* selectWorkspaceActionContext.effect(workspaceId)) === authority) {
          yield* put(removeScript(workspaceId, target.id));
        }
      } catch (error) {
        const message = errorMessage(error) || failureMessage;
        outcome.failed.push({ scriptId: target.id, error: message });
        yield* call([notify, notify.error], message);
      } finally {
        if ((yield* cancelled()) && pendingWrite) {
          try {
            yield* call(() => pendingWrite);
          } catch {
            // The reservation outlives an uncancellable transport write.
          }
        }
        yield* releaseEdit(workspaceId, target.id, reservationId);
      }
    }
    yield* put(action.success(outcome));
    yield* finishWorkflow(workspaceId, consumer, 'success', outcome);
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error('Script removal cancelled')));
      yield* finishWorkflow(workspaceId, consumer, 'cancelled');
    }
  }
}

function* runRemoveDefinitions(
  action: ReturnType<typeof removeScriptDefinitionsRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  yield* race({
    operation: call(removeDefinitions, action),
    cleanup: take(matchesWorkspaceCleanup(workspaceId)),
  });
}

function* createScriptFixAgent(
  action: ReturnType<typeof createScriptFixAgentRequested>,
): SagaGenerator<void> {
  const [workspaceId, scriptId, retainedOutput, consumerId] = action.payload;
  let request: ReturnType<typeof createAgentFromConfigRequested>;
  try {
    const authority = yield* requireAuthority(workspaceId);
    const script = consumerId
      ? (yield* race({
          definition: call(readDefinition, workspaceId, scriptId),
          released: call(waitForWorkflowRelease, workspaceId, consumerId),
          cleanup: take(matchesWorkspaceCleanup(workspaceId)),
        })).definition
      : yield* readDefinition(workspaceId, scriptId);
    if (!script) return;
    yield* requireAuthority(workspaceId, authority);
    const buffer = yield* selectScriptOutput.effect(workspaceId, scriptId);
    const lastLines =
      buffer.chunks.length > 0
        ? scriptOutputTailText(buffer, 100)
        : (retainedOutput ?? '').split('\n').slice(-100).join('\n');
    const exitCode = script.runtime?.exitCode;
    const failedText =
      exitCode !== null && exitCode !== undefined && exitCode !== 0
        ? ` failed with exit code ${exitCode}`
        : '';
    // i18n-ignore (agent-facing prompt, kept in English)
    const prompt = `The script '${script.name}'${failedText}.\n\nCommand: \`${script.command}\`\n\nOutput (last 100 lines):\n\`\`\`\n${lastLines}\n\`\`\`\n\nPlease analyze the error and suggest how to fix this script. If you can identify the issue, update the script command using the \`create_script\` MCP tool with scriptId="${scriptId}".`;
    yield* requireAuthority(workspaceId, authority);
    request = createAgentFromConfigRequested(
      workspaceId,
      {
        name: m.terminal_scriptOutput_fixAgentName_label({ name: script.name }),
        nameExplicitlySet: false,
        workspaceId: WorkspaceId(workspaceId),
        initialMessage: prompt,
        source: 'error-notification',
      },
      { openAgent: true },
    );
  } catch (error) {
    yield* call([notify, notify.error], errorMessage(error));
    return;
  }
  yield* put(request);
  try {
    yield* call(() => request.promise);
  } catch {
    // Agent creation owns user-visible failure feedback.
  }
}

function* runCreateScriptFixAgent(
  action: ReturnType<typeof createScriptFixAgentRequested>,
): SagaGenerator<void> {
  yield* call(createScriptFixAgent, action);
}

function fixAgentContext(action: ReturnType<typeof createScriptFixAgentRequested>): string {
  return `${action.payload[0]}:${action.payload[1]}`;
}

function detectionOutcome(input: {
  detected: number;
  added: number;
  updated?: number;
  removed: number;
  skippedRunning?: string[];
  packageManager?: ScriptDetectionOutcome['packageManager'];
}): ScriptDetectionOutcome {
  return {
    detected: input.detected,
    added: input.added,
    updated: input.updated ?? 0,
    removed: input.removed,
    skippedRunning: input.skippedRunning ?? [],
    ...(input.packageManager ? { packageManager: input.packageManager } : {}),
  };
}

function* reserveInventory(workspaceId: string, reservationId: string): SagaGenerator<void> {
  yield* put(scriptDetectionRequested(workspaceId, reservationId));
  const reservation = yield* selectScriptDetectionOperation.effect(workspaceId);
  if (!reservation?.pending || reservation.reservationId !== reservationId) {
    throw new Error(m.scripts_pendingChange_error());
  }
}

function* releaseInventory(workspaceId: string, reservationId: string): SagaGenerator<void> {
  yield* put(scriptDetectionFinished(workspaceId, reservationId));
}

function* detectDefinitions(
  action: ReturnType<typeof detectScriptDefinitionsRequested>,
): SagaGenerator<void> {
  const [workspaceId, consumer] = action.payload;
  const reservationId = crypto.randomUUID();
  let pendingWrite: Promise<unknown> | undefined;
  let definitionsChanged = false;
  let settled = false;
  try {
    yield* reserveInventory(workspaceId, reservationId);
    const authority = yield* requireAuthority(workspaceId);
    const { candidates, packageManager } = yield* call(() =>
      scriptDefinitionTransport.detectCandidates(workspaceId),
    );
    const existing = yield* call(() =>
      scriptDefinitionTransport.list(workspaceId, { archive: 'active' }),
    );
    const autoByName = new Map(
      existing.filter((s) => s.source === 'auto-detected').map((s) => [s.name, s]),
    );
    const userNames = new Set(
      existing.filter((s) => s.source !== 'auto-detected').map((s) => s.name),
    );
    const names = new Set<string>();
    const skippedRunning: string[] = [];
    let added = 0;
    let updated = 0;
    let removed = 0;
    for (const candidate of candidates) {
      names.add(candidate.name);
      if (userNames.has(candidate.name)) continue;
      const current = autoByName.get(candidate.name);
      if (!current) {
        yield* requireAuthority(workspaceId, authority);
        const request = scriptDefinitionTransport.create(workspaceId, {
          name: candidate.name,
          command: candidate.command,
          mode: candidate.mode,
          category: candidate.category,
          purpose: 'saved',
          source: 'auto-detected',
        });
        pendingWrite = request;
        const result = yield* call(() => request);
        pendingWrite = undefined;
        if (!result.success)
          throw new Error(result.error ?? m.terminal_quakeOverlay_detectFailed_error());
        definitionsChanged = true;
        added += 1;
        continue;
      }
      if (
        current.command === candidate.command &&
        current.mode === candidate.mode &&
        current.category === candidate.category
      )
        continue;
      if (isLiveScriptStatus(current.runtime?.status)) {
        skippedRunning.push(current.name);
        continue;
      }
      yield* requireAuthority(workspaceId, authority);
      const request = scriptDefinitionTransport.upsert(workspaceId, current.id, {
        name: candidate.name,
        command: candidate.command,
        mode: candidate.mode,
        category: candidate.category,
        ...(current.cwd !== undefined ? { cwd: current.cwd } : {}),
        ...(current.env !== undefined ? { env: current.env } : {}),
        ...(current.autoStart !== undefined ? { autoStart: current.autoStart } : {}),
        ...(current.healthUrl !== undefined ? { healthUrl: current.healthUrl } : {}),
        ...(current.readyPattern !== undefined ? { readyPattern: current.readyPattern } : {}),
      });
      pendingWrite = request;
      const result = yield* call(() => request);
      pendingWrite = undefined;
      if (!result.success)
        throw new Error(result.error ?? m.terminal_quakeOverlay_detectFailed_error());
      definitionsChanged = true;
      updated += 1;
    }
    for (const row of autoByName.values()) {
      if (names.has(row.name)) continue;
      if (isLiveScriptStatus(row.runtime?.status)) {
        skippedRunning.push(row.name);
        continue;
      }
      yield* requireAuthority(workspaceId, authority);
      const request = scriptDefinitionTransport.remove(workspaceId, row.id);
      pendingWrite = request;
      const result = yield* call(() => request);
      pendingWrite = undefined;
      if (!result.success)
        throw new Error(result.error ?? m.terminal_quakeOverlay_detectFailed_error());
      definitionsChanged = true;
      removed += 1;
    }
    yield* requireAuthority(workspaceId, authority);
    const outcome = detectionOutcome({
      detected: candidates.length,
      added,
      updated,
      removed,
      skippedRunning,
      packageManager,
    });
    yield* put(refreshScripts(workspaceId));
    yield* put(action.success(outcome));
    yield* finishWorkflow(workspaceId, consumer, 'success', outcome);
    settled = true;
  } catch (error) {
    // Earlier writes may have committed before a later operation failed.
    if (definitionsChanged) yield* put(refreshScripts(workspaceId));
    const message = errorMessage(error);
    yield* put(action.failure(asError(error)));
    yield* finishWorkflow(workspaceId, consumer, 'failure', undefined, message);
    settled = true;
  } finally {
    const wasCancelled = yield* cancelled();
    if (wasCancelled && pendingWrite) {
      try {
        yield* call(() => pendingWrite);
      } catch {
        // The inventory reservation outlives an uncancellable transport write.
      }
    }
    yield* releaseInventory(workspaceId, reservationId);
    if (!settled && wasCancelled) {
      yield* put(action.failure(new Error('Script detection cancelled')));
      yield* finishWorkflow(workspaceId, consumer, 'cancelled');
    }
  }
}

function* runDetectDefinitions(
  action: ReturnType<typeof detectScriptDefinitionsRequested>,
): SagaGenerator<void> {
  const [workspaceId, consumer] = action.payload;
  if (!consumer) {
    yield* call(detectDefinitions, action);
    return;
  }
  yield* race({
    operation: call(detectDefinitions, action),
    released: call(waitForWorkflowRelease, workspaceId, consumer.consumerId),
    cleanup: take(matchesWorkspaceCleanup(workspaceId)),
  });
}

function* waitForWorkflowRelease(workspaceId: string, consumerId: string): SagaGenerator<void> {
  for (;;) {
    const action = yield* take(scriptWorkflowReleased);
    if (action.payload[0] === workspaceId && action.payload[1] === consumerId) return;
  }
}

function* listDefinitions(
  action: ReturnType<typeof listScriptDefinitionsRequested>,
): SagaGenerator<void> {
  const [workspaceId, options, consumer] = action.payload;
  try {
    const authority = yield* requireAuthority(workspaceId);
    const result = yield* call(() => scriptDefinitionTransport.list(workspaceId, options));
    yield* requireAuthority(workspaceId, authority);
    yield* put(action.success(result));
    yield* finishWorkflow(workspaceId, consumer, 'success', result);
  } catch (error) {
    yield* put(action.failure(asError(error)));
    yield* finishWorkflow(workspaceId, consumer, 'failure', undefined, errorMessage(error));
  }
}

function* getDefinition(
  action: ReturnType<typeof getScriptDefinitionRequested>,
): SagaGenerator<void> {
  const [workspaceId, scriptId, consumer] = action.payload;
  try {
    const authority = yield* requireAuthority(workspaceId);
    const result = yield* readDefinition(workspaceId, scriptId);
    yield* requireAuthority(workspaceId, authority);
    yield* put(action.success(result));
    yield* finishWorkflow(workspaceId, consumer, 'success', result);
  } catch (error) {
    yield* put(action.failure(asError(error)));
    yield* finishWorkflow(workspaceId, consumer, 'failure', undefined, errorMessage(error));
  }
}

function* saveDefinitions(
  action: ReturnType<typeof saveScriptDefinitionsToRepoRequested>,
): SagaGenerator<void> {
  const [workspaceId, consumer] = action.payload;
  let pendingWrite: Promise<unknown> | undefined;
  let settled = false;
  try {
    const authority = yield* requireAuthority(workspaceId);
    const scripts = yield* call(() =>
      scriptDefinitionTransport.list(workspaceId, { archive: 'active' }),
    );
    yield* requireAuthority(workspaceId, authority);
    const request = scriptDefinitionTransport.saveRepoScripts(workspaceId, scripts);
    pendingWrite = request;
    yield* call(() => request);
    pendingWrite = undefined;
    yield* requireAuthority(workspaceId, authority);
    yield* put(action.success(undefined));
    yield* finishWorkflow(workspaceId, consumer, 'success');
    settled = true;
  } catch (error) {
    yield* put(action.failure(asError(error)));
    yield* finishWorkflow(workspaceId, consumer, 'failure', undefined, errorMessage(error));
    settled = true;
  } finally {
    const wasCancelled = yield* cancelled();
    if (wasCancelled && pendingWrite) {
      try {
        yield* call(() => pendingWrite);
      } catch {
        // The caller lifetime cannot cancel an issued save write.
      }
    }
    if (!settled && wasCancelled) {
      yield* put(action.failure(new Error('Script save cancelled')));
      yield* finishWorkflow(workspaceId, consumer, 'cancelled');
    }
  }
}

function* runSaveDefinitions(
  action: ReturnType<typeof saveScriptDefinitionsToRepoRequested>,
): SagaGenerator<void> {
  const [workspaceId, consumer] = action.payload;
  if (!consumer) {
    yield* call(saveDefinitions, action);
    return;
  }
  yield* race({
    operation: call(saveDefinitions, action),
    released: call(waitForWorkflowRelease, workspaceId, consumer.consumerId),
    cleanup: take(matchesWorkspaceCleanup(workspaceId)),
  });
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
    takeEvery(createScriptDefinitionRequested, createDefinition),
    takeEvery(updateScriptDefinitionRequested, updateDefinition),
    takeEvery(removeScriptDefinitionRequested, removeDefinition),
    takeEvery(removeScriptDefinitionsRequested, runRemoveDefinitions),
    takeLeadingInContext(createScriptFixAgentRequested, fixAgentContext, runCreateScriptFixAgent),
    takeEvery(detectScriptDefinitionsRequested, runDetectDefinitions),
    takeEvery(listScriptDefinitionsRequested, listDefinitions),
    takeEvery(getScriptDefinitionRequested, getDefinition),
    takeEvery(saveScriptDefinitionsToRepoRequested, runSaveDefinitions),
    takeEvery(workspaceUnmounted, clearWorkspaceOperations),
    takeEvery(workspaceDeleted, clearWorkspaceOperations),
  ]);
}
