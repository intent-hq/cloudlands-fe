import {
  addItem,
  addItems,
  createCollection,
  getItem,
  getItems,
  removeItem,
  upsertItem,
} from '@themislib/themis/utils/collections/collection-utils';
/**
 * Scripts slice — actions and reducer.
 *
 * Workspace-scoped state for script entries and output.
 */

import type { ScriptReadChange } from '$features/scripts/utils/script-change';
import {
  backendReconnected,
  workspaceDeleted,
  workspaceUnmounted,
} from '../workspace-lifecycle/workspace-lifecycle-slice';
import { createAction, createAsyncAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { createDefaultRuntimeState } from '$features/scripts/types';
import type {
  WorkspaceScript,
  ScriptRuntimeState,
  ScriptWithState,
  ScriptListEntry,
  ScriptsState,
  ScriptsWorkspaceState,
  ScriptOutputBuffer,
  ScriptOutputChunk,
  ScriptQuickAction,
  ScriptDefinitionChanges,
  ScriptDefinitionInput,
  ScriptDefinitionSnapshot,
  ScriptDefinitionUpdate,
  ScriptDetectionOutcome,
  ScriptDefinitionChangesOutcome,
  ScriptAgentDetectionOutcome,
  ScriptBulkRemovalOutcome,
  ScriptRemovalTarget,
  ScriptWorkflowConsumer,
  ScriptWorkflowOutcome,
  ScriptWorkflowResult,
} from './scripts-types';

// ============================================================================
// Constants
// ============================================================================

/** Ring-buffer cap on stored chunks (comparable to the old 5000-line cap). */
export const MAX_OUTPUT_CHUNKS = 5000;
/** Ring-buffer cap on total stored text (UTF-16 code units) per script. */
export const MAX_OUTPUT_CHARS = 2_000_000;

// ============================================================================
// Empty / Initial State
// ============================================================================

export const emptyWorkspaceState: ScriptsWorkspaceState = {
  scripts: {},
  outputBuffers: {},
  operations: {},
  initialized: false,
  loading: false,
};

export const emptyOutputBuffer: ScriptOutputBuffer = { chunks: [], dropped: 0 };

/**
 * Evict chunks from the front until both caps hold, bumping `dropped` by the
 * eviction count. The newest chunk is always kept, even if it alone exceeds
 * the char cap.
 */
function trimOutputBuffer(buffer: ScriptOutputBuffer): ScriptOutputBuffer {
  const { chunks } = buffer;
  let total = 0;
  for (const chunk of chunks) total += chunk.text.length;
  let start = 0;
  while (
    chunks.length - start > 1 &&
    (chunks.length - start > MAX_OUTPUT_CHUNKS || total > MAX_OUTPUT_CHARS)
  ) {
    total -= chunks[start].text.length;
    start += 1;
  }
  if (start === 0) return buffer;
  return { ...buffer, chunks: chunks.slice(start), dropped: buffer.dropped + start };
}

const initialState: ScriptsState = {
  byWorkspaceId: {},
};

const { getWorkspaceState, setWorkspaceState } = createWorkspaceScopedHelpers(emptyWorkspaceState);

// ============================================================================
// Actions
// ============================================================================

export const setScriptListState =
  createAction<[wsId: string, loading: boolean, error?: string, supported?: boolean]>(
    'scripts/setListState',
  );
/** Refresh scripts for a workspace (triggers saga) */
export const loadMoreScripts = createAction<[wsId: string]>('scripts/loadMore');
export const setScriptPageCursor =
  createAction<[wsId: string, nextCursor?: string]>('scripts/pageCursor');
export const refreshScripts = createAction<[wsId: string]>('scripts/refreshScripts');

export const startScriptRequested = createAction<
  [wsId: string, scriptId: string, failureMessage?: string]
>('scripts/startScriptRequested');

export const stopScriptRequested = createAction<
  [wsId: string, scriptId: string, failureMessage?: string]
>('scripts/stopScriptRequested');

export const restartScriptRequested = createAction<
  [wsId: string, scriptId: string, failureMessage?: string]
>('scripts/restartScriptRequested');

export const deleteScriptRequested = createAction<
  [wsId: string, scriptId: string, failureMessage: string]
>('scripts/deleteScriptRequested');

export const removeScriptDefinitionsRequested = createAsyncAction<
  [
    wsId: string,
    targets: ScriptRemovalTarget[],
    failureMessage: string,
    consumer?: ScriptWorkflowConsumer,
  ],
  ScriptBulkRemovalOutcome
>('scripts/removeScriptDefinitions', 'scripts/removeScriptDefinitionsRequested');

export const createScriptDefinitionRequested = createAsyncAction<
  [wsId: string, input: ScriptDefinitionInput, consumer?: ScriptWorkflowConsumer],
  WorkspaceScript
>('scripts/createScriptDefinition', 'scripts/createScriptDefinitionRequested');

export const updateScriptDefinitionRequested = createAsyncAction<
  [
    wsId: string,
    scriptId: string,
    updates: ScriptDefinitionUpdate,
    consumer?: ScriptWorkflowConsumer,
    selectedDefinition?: WorkspaceScript,
  ],
  WorkspaceScript
>('scripts/updateScriptDefinition', 'scripts/updateScriptDefinitionRequested');

export const removeScriptDefinitionRequested = createAsyncAction<
  [
    wsId: string,
    scriptId: string,
    consumer?: ScriptWorkflowConsumer,
    selectedDefinition?: WorkspaceScript,
  ],
  void
>('scripts/removeScriptDefinition', 'scripts/removeScriptDefinitionRequested');

export const detectScriptDefinitionsRequested = createAsyncAction<
  [wsId: string, consumer?: ScriptWorkflowConsumer],
  ScriptDetectionOutcome
>('scripts/detectScriptDefinitions', 'scripts/detectScriptDefinitionsRequested');

export const detectScriptsWithAgentRequested = createAsyncAction<
  [wsId: string, consumer?: ScriptWorkflowConsumer],
  ScriptAgentDetectionOutcome
>('scripts/detectScriptsWithAgent', 'scripts/detectScriptsWithAgentRequested');

export const createScriptFixAgentRequested = createAction<
  [wsId: string, scriptId: string, retainedOutput?: string, consumerId?: string]
>('scripts/createFixAgentRequested');

type ApplyScriptDefinitionChangesArgs = [
  wsId: string,
  changes: ScriptDefinitionChanges,
  definitionsOrConsumer?: ScriptWithState[] | ScriptWorkflowConsumer,
  consumerOrLegacyId?: ScriptWorkflowConsumer | string,
];
type ApplyScriptDefinitionChangesPayload = [
  wsId: string,
  changes: ScriptDefinitionChanges,
  definitions?: ScriptWithState[],
  consumer?: ScriptWorkflowConsumer,
  lifetimeConsumerId?: string,
];
export const applyScriptDefinitionChangesRequested = createAsyncAction<
  ApplyScriptDefinitionChangesArgs,
  ApplyScriptDefinitionChangesPayload,
  ScriptDefinitionChangesOutcome
>(
  'scripts/applyScriptDefinitionChanges',
  'scripts/applyScriptDefinitionChangesRequested',
  (wsId, changes, definitionsOrConsumer, consumerOrLegacyId) => {
    const definitions = Array.isArray(definitionsOrConsumer) ? definitionsOrConsumer : undefined;
    const consumer = Array.isArray(definitionsOrConsumer)
      ? typeof consumerOrLegacyId === 'object'
        ? consumerOrLegacyId
        : undefined
      : (definitionsOrConsumer ??
        (typeof consumerOrLegacyId === 'object' ? consumerOrLegacyId : undefined));
    const lifetimeConsumerId =
      typeof consumerOrLegacyId === 'string' ? consumerOrLegacyId : consumer?.consumerId;
    return [wsId, changes, definitions, consumer, lifetimeConsumerId];
  },
);

export const listScriptDefinitionsRequested = createAsyncAction<
  [wsId: string, options?: { archive?: 'active' }, consumer?: ScriptWorkflowConsumer],
  ScriptWithState[]
>('scripts/listScriptDefinitions', 'scripts/listScriptDefinitionsRequested');

export const getScriptDefinitionRequested = createAsyncAction<
  [wsId: string, scriptId: string, consumer?: ScriptWorkflowConsumer],
  ScriptWithState
>('scripts/getScriptDefinition', 'scripts/getScriptDefinitionRequested');

export const scriptDefinitionChangesReleased = createAction<[wsId: string, consumerId: string]>(
  'scripts/scriptDefinitionChangesReleased',
);

export const restoreScriptDefinitionsRequested = createAsyncAction<
  [wsId: string, snapshot: ScriptDefinitionSnapshot, consumer?: ScriptWorkflowConsumer],
  void
>('scripts/restoreScriptDefinitions', 'scripts/restoreScriptDefinitionsRequested');

export const saveScriptDefinitionsToRepoRequested = createAsyncAction<
  [wsId: string, consumer?: ScriptWorkflowConsumer],
  void
>('scripts/saveScriptDefinitionsToRepo', 'scripts/saveScriptDefinitionsToRepoRequested');

export const scriptWorkflowFinished = createAction<
  [
    wsId: string,
    consumer: ScriptWorkflowConsumer,
    status: Exclude<ScriptWorkflowOutcome['status'], 'pending'>,
    result?: ScriptWorkflowResult,
    error?: string,
  ]
>('scripts/workflowFinished');
export const scriptWorkflowConsumed = createAction<
  [wsId: string, consumerId: string, requestId: string]
>('scripts/workflowConsumed');
export const scriptWorkflowReleased = createAction<[wsId: string, consumerId: string]>(
  'scripts/workflowReleased',
);

export const editScriptRequested = createAction<
  [wsId: string, scriptId: string, reservationId?: string]
>('scripts/editScriptRequested');

export const scriptOperationSucceeded = createAction<
  [wsId: string, scriptId: string, action: ScriptQuickAction, reservationId?: string]
>('scripts/scriptOperationSucceeded');

export const scriptOperationFailed = createAction<
  [wsId: string, scriptId: string, action: ScriptQuickAction, error: string]
>('scripts/scriptOperationFailed');

export const scriptDetectionRequested = createAction<[wsId: string, reservationId?: string]>(
  'scripts/detectionRequested',
);
export const scriptDetectionFinished = createAction<[wsId: string, reservationId?: string]>(
  'scripts/detectionFinished',
);

export const clearScriptOperations = createAction<[wsId: string]>('scripts/clearScriptOperations');

/** Set initialized state */
export const setScriptsInitialized =
  createAction<[wsId: string, initialized: boolean]>('scripts/setInitialized');

/** Bulk set script entries (from list response) */
export const setScriptsData = createAction(
  'scripts/setScriptsData',
  (wsId: string, scripts: ScriptListEntry[]) => ({ wsId, scripts }),
);

export const setActiveScriptsData =
  createAction<[wsId: string, scripts: ScriptListEntry[]]>('scripts/setActiveData');
export const scriptSnapshotReceived = createAction<[wsId: string, script: ScriptWithState]>(
  'scripts/snapshotReceived',
);
export const scriptReadStarted =
  createAction<[wsId: string, requestId: string]>('scripts/readStarted');
export const scriptReadFinished =
  createAction<[wsId: string, requestId: string]>('scripts/readFinished');
export const scriptReadReconciled =
  createAction<[wsId: string, requestId: string, scripts: ScriptListEntry[]]>(
    'scripts/readReconciled',
  );
/** Upsert a single script definition */
export const upsertScript =
  createAction<[wsId: string, script: WorkspaceScript]>('scripts/upsertScript');

/** Remove a script */
export const removeScript = createAction<[wsId: string, scriptId: string]>('scripts/removeScript');

/** Update runtime state for a script */
export const updateRuntimeState = createAction(
  'scripts/updateRuntimeState',
  (wsId: string, scriptId: string, partial: Partial<ScriptRuntimeState>, replace = false) => ({
    wsId,
    scriptId,
    partial,
    ...(replace ? { replace: true } : {}),
  }),
);

/** Viewer-owned historical read; releasing it cancels late snapshot publication. */
export const scriptOutputRequested =
  createAction<[wsId: string, scriptId: string, viewerId: string]>('scripts/outputRequested');
export const scriptOutputReleased =
  createAction<[wsId: string, scriptId: string, viewerId: string]>('scripts/outputReleased');
export const scriptOutputSnapshotReceived = createAction<
  [wsId: string, scriptId: string, viewerId: string, text: string]
>('scripts/outputSnapshotReceived');

/** Append one raw output chunk for a script */
export const appendScriptOutput =
  createAction<[wsId: string, scriptId: string, chunk: ScriptOutputChunk]>('scripts/appendOutput');

// ============================================================================
// Reducer
// ============================================================================

export const scriptsReducer = createReducer<ScriptsState>(initialState);
function startWorkflow(
  state: ScriptsState,
  workspaceId: string,
  consumer?: ScriptWorkflowConsumer,
): ScriptsState {
  if (!consumer) return state;
  const ws = getWorkspaceState(state, workspaceId);
  const outcomes = ws.workflowOutcomes ?? createCollection<ScriptWorkflowOutcome, 'id'>('id');
  return setWorkspaceState(state, workspaceId, {
    ...ws,
    workflowOutcomes: upsertItem(removeItem(outcomes, consumer.consumerId), {
      ...consumer,
      id: consumer.consumerId,
      workspaceId,
      status: 'pending',
    }),
  });
}

function asyncRequestReservation(action: { type: string }): string {
  return `${action.type}:${(action as { type: string; seq: number }).seq}`;
}

scriptsReducer.with(createScriptDefinitionRequested, (state, { payload }) =>
  startWorkflow(state, payload[0], payload[2]),
);
scriptsReducer.with(updateScriptDefinitionRequested, (state, action) => {
  const { payload } = action;
  return requestOperation(
    startWorkflow(state, payload[0], payload[3]),
    payload[0],
    payload[1],
    'edit',
    asyncRequestReservation(action),
  );
});
scriptsReducer.with(removeScriptDefinitionRequested, (state, action) => {
  const { payload } = action;
  return requestOperation(
    startWorkflow(state, payload[0], payload[2]),
    payload[0],
    payload[1],
    'edit',
    asyncRequestReservation(action),
  );
});
scriptsReducer.with(removeScriptDefinitionsRequested, (state, { payload }) =>
  startWorkflow(state, payload[0], payload[3]),
);
scriptsReducer.with(detectScriptDefinitionsRequested, (state, { payload }) =>
  startWorkflow(state, payload[0], payload[1]),
);
scriptsReducer.with(detectScriptsWithAgentRequested, (state, { payload }) =>
  startWorkflow(state, payload[0], payload[1]),
);
scriptsReducer.with(applyScriptDefinitionChangesRequested, (state, { payload }) =>
  startWorkflow(state, payload[0], payload[3]),
);
scriptsReducer.with(listScriptDefinitionsRequested, (state, { payload }) =>
  startWorkflow(state, payload[0], payload[2]),
);
scriptsReducer.with(getScriptDefinitionRequested, (state, { payload }) =>
  startWorkflow(state, payload[0], payload[2]),
);
scriptsReducer.with(restoreScriptDefinitionsRequested, (state, { payload }) =>
  startWorkflow(state, payload[0], payload[2]),
);
scriptsReducer.with(saveScriptDefinitionsToRepoRequested, (state, { payload }) =>
  startWorkflow(state, payload[0], payload[1]),
);
scriptsReducer.with(
  scriptWorkflowFinished,
  (state, { payload: [wsId, consumer, status, result, error] }) => {
    const ws = getWorkspaceState(state, wsId);
    const outcomes = ws.workflowOutcomes;
    const current = outcomes ? getItem(outcomes, consumer.consumerId) : undefined;
    if (
      current?.status !== 'pending' ||
      current.requestId !== consumer.requestId ||
      current.resourceId !== consumer.resourceId
    )
      return state;
    return setWorkspaceState(state, wsId, {
      ...ws,
      workflowOutcomes: upsertItem(outcomes!, {
        ...current,
        status,
        ...(result !== undefined ? { result } : {}),
        ...(error ? { error } : {}),
      }),
    });
  },
);
scriptsReducer.with(scriptWorkflowConsumed, (state, { payload: [wsId, consumerId, requestId] }) => {
  const ws = getWorkspaceState(state, wsId);
  const outcomes = ws.workflowOutcomes;
  const current = outcomes ? getItem(outcomes, consumerId) : undefined;
  if (
    !current ||
    current.requestId !== requestId ||
    current.status === 'pending' ||
    current.consumed
  )
    return state;
  return setWorkspaceState(state, wsId, {
    ...ws,
    workflowOutcomes: upsertItem(outcomes!, { ...current, consumed: true }),
  });
});
scriptsReducer.with(scriptWorkflowReleased, (state, { payload: [wsId, consumerId] }) => {
  const ws = getWorkspaceState(state, wsId);
  if (!ws.workflowOutcomes || !getItem(ws.workflowOutcomes, consumerId)) return state;
  return setWorkspaceState(state, wsId, {
    ...ws,
    workflowOutcomes: removeItem(ws.workflowOutcomes, consumerId),
  });
});
function recordChange(ws: ScriptsWorkspaceState, change: ScriptReadChange): ScriptsWorkspaceState {
  if (!Object.keys(ws.pendingReads ?? {}).length) return ws;
  return {
    ...ws,
    pendingReads: Object.fromEntries(
      Object.entries(ws.pendingReads ?? {}).map(([id, changes]) => [
        id,
        addItem(changes, { ...change, sequence: String(getItems(changes).length) }),
      ]),
    ),
  };
}
scriptsReducer.with(scriptReadStarted, (state, { payload: [wsId, requestId] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, {
    ...ws,
    pendingReads: { ...ws.pendingReads, [requestId]: createCollection('sequence') },
  });
});
scriptsReducer.with(scriptReadReconciled, (state, { payload: [wsId, requestId, scripts] }) => {
  const ws = getWorkspaceState(state, wsId);
  if (!ws.pendingReads?.[requestId]) return state;
  // UUID request keys retain insertion order. Only reads begun before this
  // accepted response replay it; later requests still own their own snapshots.
  const pendingReads = { ...ws.pendingReads };
  for (const id of Object.keys(pendingReads)) {
    if (id === requestId) break;
    const offset = getItems(pendingReads[id]).length;
    pendingReads[id] = addItems(
      pendingReads[id],
      scripts.map((script, index) => ({
        kind: 'read' as const,
        script,
        sequence: String(offset + index),
      })),
    );
  }
  return setWorkspaceState(state, wsId, { ...ws, pendingReads });
});
scriptsReducer.with(scriptReadFinished, (state, { payload: [wsId, requestId] }) => {
  const ws = getWorkspaceState(state, wsId);
  const { [requestId]: _read, ...pendingReads } = ws.pendingReads ?? {};
  return setWorkspaceState(state, wsId, { ...ws, pendingReads });
});
function invalidateWorkspaceReads(state: ScriptsState, wsId: string): ScriptsState {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, { ...ws, pendingReads: {} });
}
scriptsReducer.with(workspaceUnmounted, (state, { payload: [wsId] }) =>
  invalidateWorkspaceReads(state, wsId),
);
scriptsReducer.with(workspaceDeleted, (state, { payload: [wsId] }) =>
  invalidateWorkspaceReads(state, wsId),
);
scriptsReducer.with(backendReconnected, (state) => ({
  ...state,
  byWorkspaceId: Object.fromEntries(
    Object.entries(state.byWorkspaceId).map(([id, ws]) => [id, { ...ws, pendingReads: {} }]),
  ),
}));
scriptsReducer.with(scriptSnapshotReceived, (state, { payload: [wsId, script] }) => {
  const ws = recordChange(getWorkspaceState(state, wsId), { kind: 'snapshot', script });
  const activeIds =
    ws.activeScriptIds ??
    Object.values(ws.scripts)
      .filter((row) => !row.archivedAt)
      .map((row) => row.id);
  return setWorkspaceState(state, wsId, {
    ...ws,
    scripts: script.archivedAt
      ? Object.fromEntries(Object.entries(ws.scripts).filter(([id]) => id !== script.id))
      : { ...ws.scripts, [script.id]: script },
    activeScriptIds: script.archivedAt
      ? activeIds.filter((id) => id !== script.id)
      : [...new Set([...activeIds, script.id])],
  });
});
function requestOperation(
  state: ScriptsState,
  wsId: string,
  scriptId: string,
  action: ScriptQuickAction,
  reservationId?: string,
): ScriptsState {
  const ws = getWorkspaceState(state, wsId);
  if (ws.detectionOperation?.pending || ws.operations[scriptId]?.pending) return state;
  return setWorkspaceState(state, wsId, {
    ...ws,
    operations: {
      ...ws.operations,
      [scriptId]: { action, pending: true, ...(reservationId ? { reservationId } : {}) },
    },
  });
}

scriptsReducer.with(scriptDetectionRequested, (state, { payload: [wsId, reservationId] }) => {
  const ws = getWorkspaceState(state, wsId);
  if (ws.detectionOperation?.pending || Object.values(ws.operations).some((op) => op.pending))
    return state;
  return setWorkspaceState(state, wsId, {
    ...ws,
    detectionOperation: {
      action: 'edit',
      pending: true,
      ...(reservationId ? { reservationId } : {}),
    },
  });
});
scriptsReducer.with(scriptDetectionFinished, (state, { payload: [wsId, reservationId] }) => {
  const ws = getWorkspaceState(state, wsId);
  if (reservationId && ws.detectionOperation?.reservationId !== reservationId) return state;
  const { detectionOperation: _detection, ...rest } = ws;
  return setWorkspaceState(state, wsId, rest);
});

scriptsReducer.with(editScriptRequested, (state, { payload: [wsId, scriptId, reservationId] }) =>
  requestOperation(state, wsId, scriptId, 'edit', reservationId),
);
scriptsReducer.with(startScriptRequested, (state, { payload: [wsId, scriptId] }) =>
  requestOperation(state, wsId, scriptId, 'start'),
);
scriptsReducer.with(stopScriptRequested, (state, { payload: [wsId, scriptId] }) =>
  requestOperation(state, wsId, scriptId, 'stop'),
);
scriptsReducer.with(restartScriptRequested, (state, { payload: [wsId, scriptId] }) =>
  requestOperation(state, wsId, scriptId, 'restart'),
);
scriptsReducer.with(deleteScriptRequested, (state, { payload: [wsId, scriptId] }) =>
  requestOperation(state, wsId, scriptId, 'delete'),
);
scriptsReducer.with(
  scriptOperationSucceeded,
  (state, { payload: [wsId, scriptId, action, reservationId] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (ws.operations[scriptId]?.action !== action) return state;
    if (reservationId && ws.operations[scriptId]?.reservationId !== reservationId) return state;
    const { [scriptId]: _operation, ...operations } = ws.operations;
    return setWorkspaceState(state, wsId, { ...ws, operations });
  },
);
scriptsReducer.with(
  scriptOperationFailed,
  (state, { payload: [wsId, scriptId, action, error] }) => {
    const ws = getWorkspaceState(state, wsId);
    if (ws.operations[scriptId]?.action !== action) return state;
    return setWorkspaceState(state, wsId, {
      ...ws,
      operations: { ...ws.operations, [scriptId]: { action, pending: false, error } },
    });
  },
);
scriptsReducer.with(clearScriptOperations, (state, { payload: [wsId] }) => {
  const ws = getWorkspaceState(state, wsId);
  if (Object.keys(ws.operations).length === 0) return state;
  // Definition writes and daemon deletions cannot be cancelled by unmount.
  // Their owners release the reservation only after the wire request settles.
  const operations = Object.fromEntries(
    Object.entries(ws.operations)
      .filter(
        ([, operation]) =>
          (operation.action === 'edit' || operation.action === 'delete') && operation.pending,
      )
      .map(([id, operation]) => [id, { ...operation }]),
  );
  return setWorkspaceState(state, wsId, { ...ws, operations });
});
scriptsReducer.with(setScriptsInitialized, (state, { payload: [wsId, initialized] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, {
    ...ws,
    initialized,
  });
});
scriptsReducer.with(setScriptsData, (state, { payload: { wsId, scripts } }) => {
  const ws = getWorkspaceState(state, wsId);
  const scriptsById: Record<string, ScriptListEntry> = {};
  for (const script of scripts) {
    scriptsById[script.id] = script;
  }
  return setWorkspaceState(state, wsId, {
    ...ws,
    scripts: scriptsById,
    activeScriptIds: undefined,
  });
});
scriptsReducer.with(upsertScript, (state, { payload: [wsId, script] }) => {
  const ws = getWorkspaceState(state, wsId);
  const runtime = ws.scripts[script.id]?.runtime ?? createDefaultRuntimeState();
  return setWorkspaceState(state, wsId, {
    ...ws,
    scripts: { ...ws.scripts, [script.id]: { ...script, runtime } },
  });
});
scriptsReducer.with(removeScript, (state, { payload: [wsId, scriptId] }) => {
  const ws = recordChange(getWorkspaceState(state, wsId), { kind: 'removed', scriptId });
  const { [scriptId]: _s, ...scripts } = ws.scripts;
  const { [scriptId]: _o, ...outputBuffers } = ws.outputBuffers;
  return setWorkspaceState(state, wsId, {
    ...ws,
    scripts,
    outputBuffers,
    retainedOutputs: Object.fromEntries(
      Object.entries(ws.retainedOutputs ?? {}).filter(([, output]) => output.scriptId !== scriptId),
    ),
    activeScriptIds: ws.activeScriptIds?.filter((id) => id !== scriptId),
  });
});
scriptsReducer.with(
  updateRuntimeState,
  (state, { payload: { wsId, scriptId, partial, replace } }) => {
    const ws = recordChange(getWorkspaceState(state, wsId), {
      kind: 'runtime',
      scriptId,
      partial,
      replace,
    });
    const script = ws.scripts[scriptId];
    if (!script) return setWorkspaceState(state, wsId, ws);
    const current = script.runtime ?? createDefaultRuntimeState();
    return setWorkspaceState(state, wsId, {
      ...ws,
      scripts: {
        ...ws.scripts,
        [scriptId]: {
          ...script,
          runtime: replace ? (partial as ScriptRuntimeState) : { ...current, ...partial },
        },
      },
    });
  },
);
scriptsReducer.with(scriptOutputRequested, (state, { payload: [wsId, scriptId, viewerId] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, {
    ...ws,
    retainedOutputs: { ...ws.retainedOutputs, [viewerId]: { scriptId, status: 'loading' } },
  });
});
scriptsReducer.with(scriptOutputReleased, (state, { payload: [wsId, scriptId, viewerId] }) => {
  const ws = state.byWorkspaceId[wsId];
  if (ws?.retainedOutputs?.[viewerId]?.scriptId !== scriptId) return state;
  const { [viewerId]: _released, ...retainedOutputs } = ws.retainedOutputs;
  return setWorkspaceState(state, wsId, { ...ws, retainedOutputs });
});
scriptsReducer.with(
  scriptOutputSnapshotReceived,
  (state, { payload: [wsId, scriptId, viewerId, text] }) => {
    const ws = state.byWorkspaceId[wsId];
    if (ws?.retainedOutputs?.[viewerId]?.scriptId !== scriptId) return state;
    // This is a formatted, capped poll response, not raw PTY bytes. Even a
    // successful read has no cursor with which to join delayed stream events.
    const available = !!text && text !== 'No output yet.'; // daemon wire sentinel
    return setWorkspaceState(state, wsId, {
      ...ws,
      retainedOutputs: {
        ...ws.retainedOutputs,
        [viewerId]: {
          scriptId,
          status: available ? 'available' : 'unavailable',
          ...(available ? { text: text.slice(-MAX_OUTPUT_CHARS) } : {}),
        },
      },
    });
  },
);
scriptsReducer.with(appendScriptOutput, (state, { payload: [wsId, scriptId, chunk] }) => {
  const ws = getWorkspaceState(state, wsId);
  const current = ws.outputBuffers[scriptId] ?? emptyOutputBuffer;
  const combined = trimOutputBuffer({
    ...current,
    chunks: [...current.chunks, chunk],
    dropped: current.dropped,
  });
  return setWorkspaceState(state, wsId, {
    ...ws,
    outputBuffers: { ...ws.outputBuffers, [scriptId]: combined },
  });
});

scriptsReducer.with(
  setScriptListState,
  (state, { payload: [wsId, loading, loadError, supported] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      loading,
      loadError,
      ...(supported !== undefined ? { lifecycleSupported: supported } : {}),
    });
  },
);
scriptsReducer.with(setActiveScriptsData, (state, { payload: [wsId, entries] }) => {
  const ws = getWorkspaceState(state, wsId);
  const incoming = Object.fromEntries(entries.map((script) => [script.id, script]));
  return setWorkspaceState(state, wsId, {
    ...ws,
    scripts: incoming,
    activeScriptIds: entries.filter((script) => !script.archivedAt).map((script) => script.id),
  });
});

scriptsReducer.with(setScriptPageCursor, (state, { payload: [wsId, nextCursor] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, { ...ws, nextCursor });
});
