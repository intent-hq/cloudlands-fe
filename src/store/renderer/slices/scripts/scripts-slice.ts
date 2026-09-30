/**
 * Scripts slice — actions and reducer.
 *
 * Workspace-scoped state for script entries and output.
 */

import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { createDefaultRuntimeState } from '$features/scripts/types';
import type {
  WorkspaceScript,
  ScriptRuntimeState,
  ScriptWithState,
  ScriptsState,
  ScriptsWorkspaceState,
  ScriptOutputBuffer,
  ScriptOutputChunk,
  ScriptQuickAction,
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
export const scriptArchiveRequested = createAction<
  [wsId: string, scriptIds: string[], operation: 'archive' | 'restore']
>('scripts/archiveRequested');
export const scriptArchiveFinished =
  createAction<
    [
      wsId: string,
      result: { error?: string; changed?: number; skipped?: number },
      generation?: number,
    ]
  >('scripts/archiveFinished');

/** Refresh scripts for a workspace (triggers saga) */
export const refreshScripts =
  createAction<[wsId: string, invalidateHistory?: boolean]>('scripts/refreshScripts');

export const startScriptRequested = createAction<[wsId: string, scriptId: string]>(
  'scripts/startScriptRequested',
);

export const stopScriptRequested = createAction<[wsId: string, scriptId: string]>(
  'scripts/stopScriptRequested',
);

export const restartScriptRequested = createAction<[wsId: string, scriptId: string]>(
  'scripts/restartScriptRequested',
);

export const scriptOperationSucceeded = createAction<
  [wsId: string, scriptId: string, action: ScriptQuickAction]
>('scripts/scriptOperationSucceeded');

export const scriptOperationFailed = createAction<
  [wsId: string, scriptId: string, action: ScriptQuickAction, error: string]
>('scripts/scriptOperationFailed');

export const clearScriptOperations = createAction<[wsId: string]>('scripts/clearScriptOperations');

/** Set initialized state */
export const setScriptsInitialized =
  createAction<[wsId: string, initialized: boolean]>('scripts/setInitialized');

/** Bulk set script entries (from list response) */
export const setScriptsData = createAction(
  'scripts/setScriptsData',
  (wsId: string, scripts: ScriptWithState[]) => ({ wsId, scripts }),
);

export const setActiveScriptsData =
  createAction<[wsId: string, scripts: ScriptWithState[]]>('scripts/setActiveData');
export const setArchivedScriptsData =
  createAction<[wsId: string, scripts: ScriptWithState[], version: number]>(
    'scripts/setArchivedData',
  );
export const setScriptHistoryLoadState = createAction<
  [wsId: string, loading: boolean, error?: string]
>('scripts/setHistoryLoadState');

/** Upsert a single script definition */
export const upsertScript =
  createAction<[wsId: string, script: WorkspaceScript]>('scripts/upsertScript');

/** Remove a script */
export const removeScript = createAction<[wsId: string, scriptId: string]>('scripts/removeScript');

/** Update runtime state for a script */
export const updateRuntimeState = createAction(
  'scripts/updateRuntimeState',
  (wsId: string, scriptId: string, partial: Partial<ScriptRuntimeState>) => ({
    wsId,
    scriptId,
    partial,
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
function requestOperation(
  state: ScriptsState,
  wsId: string,
  scriptId: string,
  action: ScriptQuickAction,
): ScriptsState {
  const ws = getWorkspaceState(state, wsId);
  if (ws.operations[scriptId]?.pending) return state;
  return setWorkspaceState(state, wsId, {
    ...ws,
    operations: { ...ws.operations, [scriptId]: { action, pending: true } },
  });
}

scriptsReducer.with(startScriptRequested, (state, { payload: [wsId, scriptId] }) =>
  requestOperation(state, wsId, scriptId, 'start'),
);
scriptsReducer.with(stopScriptRequested, (state, { payload: [wsId, scriptId] }) =>
  requestOperation(state, wsId, scriptId, 'stop'),
);
scriptsReducer.with(restartScriptRequested, (state, { payload: [wsId, scriptId] }) =>
  requestOperation(state, wsId, scriptId, 'restart'),
);
scriptsReducer.with(scriptOperationSucceeded, (state, { payload: [wsId, scriptId, action] }) => {
  const ws = getWorkspaceState(state, wsId);
  if (ws.operations[scriptId]?.action !== action) return state;
  const { [scriptId]: _operation, ...operations } = ws.operations;
  return setWorkspaceState(state, wsId, { ...ws, operations });
});
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
  if (Object.keys(ws.operations).length === 0 && !ws.archiveOperation) return state;
  return setWorkspaceState(state, wsId, { ...ws, operations: {}, archiveOperation: undefined });
});
scriptsReducer.with(setScriptsInitialized, (state, { payload: [wsId, initialized] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, {
    ...ws,
    initialized,
    ...(initialized ? {} : { historyVersion: (ws.historyVersion ?? 0) + 1 }),
  });
});
scriptsReducer.with(setScriptsData, (state, { payload: { wsId, scripts } }) => {
  const ws = getWorkspaceState(state, wsId);
  const scriptsById: Record<string, ScriptWithState> = {};
  for (const script of scripts) {
    scriptsById[script.id] = script;
  }
  return setWorkspaceState(state, wsId, {
    ...ws,
    scripts: scriptsById,
    activeScriptIds: undefined,
    archivedScriptIds: undefined,
    historyInitialized: false,
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
  const ws = getWorkspaceState(state, wsId);
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
    archivedScriptIds: ws.archivedScriptIds?.filter((id) => id !== scriptId),
  });
});
scriptsReducer.with(updateRuntimeState, (state, { payload: { wsId, scriptId, partial } }) => {
  const ws = getWorkspaceState(state, wsId);
  const script = ws.scripts[scriptId];
  if (!script) return state;
  const current = script.runtime ?? createDefaultRuntimeState();
  return setWorkspaceState(state, wsId, {
    ...ws,
    scripts: {
      ...ws.scripts,
      [scriptId]: { ...script, runtime: { ...current, ...partial } },
    },
  });
});
scriptsReducer.with(scriptOutputRequested, (state, { payload: [wsId, scriptId, viewerId] }) => {
  const ws = state.byWorkspaceId[wsId];
  if (!ws?.scripts[scriptId]) return state;
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
    if (!ws?.scripts[scriptId] || ws.retainedOutputs?.[viewerId]?.scriptId !== scriptId)
      return state;
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
scriptsReducer.with(scriptArchiveRequested, (state, { payload: [wsId] }) => {
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, {
    ...ws,
    archiveGeneration: (ws.archiveGeneration ?? 0) + 1,
    archiveOperation: { pending: true },
  });
});
scriptsReducer.with(scriptArchiveFinished, (state, { payload: [wsId, result, generation] }) => {
  const ws = getWorkspaceState(state, wsId);
  if (generation !== undefined && generation !== (ws.archiveGeneration ?? 0)) return state;
  return setWorkspaceState(state, wsId, { ...ws, archiveOperation: { pending: false, ...result } });
});

scriptsReducer.with(refreshScripts, (state, { payload: [wsId, invalidateHistory] }) => {
  if (!invalidateHistory) return state;
  const ws = getWorkspaceState(state, wsId);
  return setWorkspaceState(state, wsId, { ...ws, historyVersion: (ws.historyVersion ?? 0) + 1 });
});
scriptsReducer.with(setActiveScriptsData, (state, { payload: [wsId, entries] }) => {
  const ws = getWorkspaceState(state, wsId);
  const incoming = Object.fromEntries(entries.map((script) => [script.id, script]));
  return setWorkspaceState(state, wsId, {
    ...ws,
    scripts: { ...ws.scripts, ...incoming },
    activeScriptIds: entries.map((script) => script.id),
    archivedScriptIds: ws.archivedScriptIds?.filter((id) => !incoming[id]),
  });
});
scriptsReducer.with(setArchivedScriptsData, (state, { payload: [wsId, entries, version] }) => {
  const ws = getWorkspaceState(state, wsId);
  const incoming = Object.fromEntries(entries.map((script) => [script.id, script]));
  return setWorkspaceState(state, wsId, {
    ...ws,
    scripts: { ...ws.scripts, ...incoming },
    archivedScriptIds: entries.map((script) => script.id),
    activeScriptIds: ws.activeScriptIds?.filter((id) => !incoming[id]),
    historyInitialized: true,
    historyLoadedVersion: version,
  });
});
scriptsReducer.with(
  setScriptHistoryLoadState,
  (state, { payload: [wsId, historyLoading, historyError] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, { ...ws, historyLoading, historyError });
  },
);
