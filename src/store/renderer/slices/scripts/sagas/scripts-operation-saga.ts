import type { SagaGenerator } from 'typed-redux-saga';
import { all, call, put, race, take, takeEvery } from 'typed-redux-saga';

import { scriptsClient } from '$features/scripts/scripts.client';
import { takeLeadingInContext } from '../../../utils/context-saga-effects';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  applyScriptDetectionRequested,
  clearScriptOperations,
  createScriptRequested,
  detectScriptsRequested,
  refreshScripts,
  removeScript,
  removeScriptRequested,
  restartScriptRequested,
  restoreScriptsRequested,
  saveScriptsToRepoRequested,
  scriptCommandFailed,
  scriptCommandSucceeded,
  scriptOperationFailed,
  scriptOperationSucceeded,
  startScriptRequested,
  stopScriptRequested,
  updateScriptRequested,
  upsertScript,
} from '../scripts-slice';
import { selectScriptEntries } from '../scripts-selectors';
import type {
  ScriptCommandResult,
  ScriptDefinitionInput,
  ScriptQuickAction,
} from '../scripts-types';

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

type ScriptCommandRequest = ReturnType<
  | typeof createScriptRequested
  | typeof updateScriptRequested
  | typeof removeScriptRequested
  | typeof detectScriptsRequested
  | typeof saveScriptsToRepoRequested
  | typeof applyScriptDetectionRequested
  | typeof restoreScriptsRequested
>;

function commandKey(action: ScriptCommandRequest): string {
  if (action.type === updateScriptRequested.type) return `update:${action.payload[1]}`;
  if (action.type === removeScriptRequested.type) return `remove:${action.payload[1]}`;
  if (action.type === createScriptRequested.type) return 'create';
  if (action.type === detectScriptsRequested.type) return 'detect';
  if (action.type === saveScriptsToRepoRequested.type) return 'save';
  if (action.type === applyScriptDetectionRequested.type) return 'apply';
  return 'restore';
}

function commandContext(action: ScriptCommandRequest): string {
  return `${action.payload[0]}:${commandKey(action)}`;
}

function definitionOf(script: {
  name: string;
  command: string;
  mode: ScriptDefinitionInput['mode'];
  category?: ScriptDefinitionInput['category'];
  source?: ScriptDefinitionInput['source'];
  cwd?: string;
  env?: Record<string, string>;
  autoStart?: boolean;
}): ScriptDefinitionInput {
  return {
    name: script.name,
    command: script.command,
    mode: script.mode,
    ...(script.category !== undefined ? { category: script.category } : {}),
    ...(script.source !== undefined ? { source: script.source } : {}),
    ...(script.cwd !== undefined ? { cwd: script.cwd } : {}),
    ...(script.env !== undefined ? { env: script.env } : {}),
    ...(script.autoStart !== undefined ? { autoStart: script.autoStart } : {}),
  };
}

function* applyDetection(
  workspaceId: string,
  action: Extract<ScriptCommandRequest, ReturnType<typeof applyScriptDetectionRequested>>,
): SagaGenerator<ScriptCommandResult> {
  const entries = yield* selectScriptEntries.effect(workspaceId);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const autoIds = new Set(
    entries.filter((entry) => entry.source === 'auto-detected').map((entry) => entry.id),
  );
  const skippedRunning = new Set<string>();
  let added = 0;
  let updated = 0;
  let removed = 0;
  for (const scriptId of action.payload[1].remove) {
    const entry = byId.get(scriptId);
    if (!entry || !autoIds.has(scriptId)) continue;
    if (entry.runtime.status === 'running') {
      skippedRunning.add(entry.name);
      continue;
    }
    const result = yield* call([scriptsClient, scriptsClient.remove], workspaceId, scriptId);
    if (result.success) removed += 1;
  }
  for (const { id, updates } of action.payload[1].update) {
    const entry = byId.get(id);
    if (!entry || !autoIds.has(id)) continue;
    if (entry.runtime.status === 'running') {
      skippedRunning.add(entry.name);
      continue;
    }
    const result = yield* call([scriptsClient, scriptsClient.update], workspaceId, id, updates);
    if (result.success) updated += 1;
  }
  for (const input of action.payload[1].add) {
    const result = yield* call([scriptsClient, scriptsClient.create], workspaceId, input);
    if (result.success) added += 1;
  }
  return {
    kind: 'apply',
    detected: action.payload[1].add.length,
    added,
    updated,
    removed,
    skippedRunning: [...skippedRunning],
  };
}

function* restoreScripts(
  workspaceId: string,
  scripts: ScriptDefinitionInput[],
): SagaGenerator<ScriptCommandResult> {
  const current = yield* selectScriptEntries.effect(workspaceId);
  // Restore is fail-fast: stop at the first rejected mutation, then let the
  // command wrapper refresh whatever partial daemon state earlier steps produced.
  for (const script of current) {
    const response = yield* call([scriptsClient, scriptsClient.remove], workspaceId, script.id);
    if (!response.success) {
      throw new Error(response.error ?? 'Script removal failed during restore');
    }
  }
  for (const script of scripts) {
    const response = yield* call(
      [scriptsClient, scriptsClient.create],
      workspaceId,
      definitionOf(script),
    );
    if (!response.success) {
      throw new Error(response.error ?? 'Script creation failed during restore');
    }
  }
  return { kind: 'restore' };
}

function* finishCommand(
  workspaceId: string,
  key: string,
  operation: () => SagaGenerator<ScriptCommandResult>,
  refreshOnFailure = false,
): SagaGenerator<void> {
  try {
    const outcome = yield* race({
      result: call(operation),
      cleanup: take(matchesWorkspaceCleanup(workspaceId)),
    });
    if (outcome.cleanup || !outcome.result) return;
    const result = outcome.result;
    yield* put(scriptCommandSucceeded(workspaceId, key, result));
    yield* put(refreshScripts(workspaceId));
  } catch (error) {
    yield* put(scriptCommandFailed(workspaceId, key, errorMessage(error)));
    if (refreshOnFailure) yield* put(refreshScripts(workspaceId));
  }
}

function* createCommand(action: ReturnType<typeof createScriptRequested>): SagaGenerator<void> {
  const [workspaceId, input] = action.payload;
  yield* finishCommand(workspaceId, 'create', function* () {
    const response = yield* call([scriptsClient, scriptsClient.create], workspaceId, input);
    if (!response.success || !response.data)
      throw new Error(response.error ?? 'Script creation failed');
    yield* put(upsertScript(workspaceId, response.data));
    return { kind: 'create', script: response.data };
  });
}

function* updateCommand(action: ReturnType<typeof updateScriptRequested>): SagaGenerator<void> {
  const [workspaceId, scriptId, updates] = action.payload;
  yield* finishCommand(workspaceId, `update:${scriptId}`, function* () {
    const response = yield* call(
      [scriptsClient, scriptsClient.update],
      workspaceId,
      scriptId,
      updates,
    );
    if (!response.success || !response.data)
      throw new Error(response.error ?? 'Script update failed');
    yield* put(upsertScript(workspaceId, response.data));
    return { kind: 'update', script: response.data };
  });
}

function* removeCommand(action: ReturnType<typeof removeScriptRequested>): SagaGenerator<void> {
  const [workspaceId, scriptId] = action.payload;
  yield* finishCommand(workspaceId, `remove:${scriptId}`, function* () {
    const response = yield* call([scriptsClient, scriptsClient.remove], workspaceId, scriptId);
    if (!response.success) throw new Error(response.error ?? 'Script removal failed');
    yield* put(removeScript(workspaceId, scriptId));
    return { kind: 'remove', scriptId };
  });
}

function* detectCommand(action: ReturnType<typeof detectScriptsRequested>): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  yield* finishCommand(workspaceId, 'detect', function* () {
    const response = yield* call([scriptsClient, scriptsClient.detect], workspaceId);
    if (!response.success) throw new Error(response.error ?? 'Script detection failed');
    return {
      kind: 'detect',
      detected: response.detected ?? 0,
      added: response.added ?? 0,
      updated: 0,
      removed: response.removed ?? 0,
      skippedRunning: response.skippedRunning ?? [],
    };
  });
}

function* saveCommand(action: ReturnType<typeof saveScriptsToRepoRequested>): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  yield* finishCommand(workspaceId, 'save', function* () {
    const response = yield* call([scriptsClient, scriptsClient.saveToRepo], workspaceId);
    if (!response.success) throw new Error(response.error ?? 'Saving scripts failed');
    return { kind: 'save' };
  });
}

function* applyCommand(
  action: ReturnType<typeof applyScriptDetectionRequested>,
): SagaGenerator<void> {
  const [workspaceId] = action.payload;
  yield* finishCommand(workspaceId, 'apply', function* () {
    return yield* applyDetection(workspaceId, action);
  });
}

function* restoreCommand(action: ReturnType<typeof restoreScriptsRequested>): SagaGenerator<void> {
  const [workspaceId, scripts] = action.payload;
  yield* finishCommand(
    workspaceId,
    'restore',
    function* () {
      return yield* restoreScripts(workspaceId, scripts);
    },
    true,
  );
}

export function* scriptsOperationSaga(): SagaGenerator<void> {
  yield* all([
    takeLeadingInContext(
      [startScriptRequested, stopScriptRequested, restartScriptRequested],
      operationContext,
      runScriptOperation,
    ),
    takeLeadingInContext([createScriptRequested], commandContext, createCommand),
    takeLeadingInContext([updateScriptRequested], commandContext, updateCommand),
    takeLeadingInContext([removeScriptRequested], commandContext, removeCommand),
    takeLeadingInContext([detectScriptsRequested], commandContext, detectCommand),
    takeLeadingInContext([saveScriptsToRepoRequested], commandContext, saveCommand),
    takeLeadingInContext([applyScriptDetectionRequested], commandContext, applyCommand),
    takeLeadingInContext([restoreScriptsRequested], commandContext, restoreCommand),
    takeEvery(workspaceUnmounted, clearWorkspaceOperations),
    takeEvery(workspaceDeleted, clearWorkspaceOperations),
  ]);
}
