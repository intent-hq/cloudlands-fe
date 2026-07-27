/**
 * Scripts slice — actions and reducer.
 *
 * Workspace-scoped state for script entries and output.
 */

import { createAction } from '$lib/store-shim/utils/store/create-action';
import { createReducer } from '$lib/store-shim/utils/store/create-reducer';
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
  return { chunks: chunks.slice(start), dropped: buffer.dropped + start };
}

const initialState: ScriptsState = {
  byWorkspaceId: {},
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyWorkspaceState);

// ============================================================================
// Actions
// ============================================================================

/** Initialize scripts for a workspace (triggers saga) */
export const initializeScripts = createAction<[wsId: string]>('scripts/initializeScripts');

/** Refresh scripts for a workspace (triggers saga) */
export const refreshScripts = createAction<[wsId: string]>('scripts/refreshScripts');

/** Set loading state */
export const setScriptsLoading =
  createAction<[wsId: string, loading: boolean]>('scripts/setLoading');

/** Set initialized state */
export const setScriptsInitialized =
  createAction<[wsId: string, initialized: boolean]>('scripts/setInitialized');

/** Bulk set script entries (from list response) */
export const setScriptsData = createAction(
  'scripts/setScriptsData',
  (wsId: string, scripts: ScriptWithState[]) => ({ wsId, scripts }),
);

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

/** Append one raw output chunk for a script */
export const appendScriptOutput =
  createAction<[wsId: string, scriptId: string, chunk: ScriptOutputChunk]>('scripts/appendOutput');

/**
 * Replace a script's output buffer wholesale. No production dispatcher today
 * (reopen replay is served straight from the renderer store); kept for tests
 * and future seeding. The reducer resets `dropped` to 0 — do not dispatch
 * while a `ScriptOutputViewer` is live, or its absolute stream position would
 * exceed the new buffer's and it would render nothing until it catches up.
 */
export const setScriptOutput =
  createAction<[wsId: string, scriptId: string, chunks: ScriptOutputChunk[]]>('scripts/setOutput');

/** Dispose workspace scripts state */
export const disposeScripts = createAction<[wsId: string]>('scripts/dispose');

// ============================================================================
// Reducer
// ============================================================================

export const scriptsReducer = createReducer<ScriptsState>(initialState)
  .with(setScriptsLoading, (state, { payload: [wsId, loading] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, { ...ws, loading });
  })
  .with(setScriptsInitialized, (state, { payload: [wsId, initialized] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, { ...ws, initialized });
  })
  .with(setScriptsData, (state, { payload: { wsId, scripts } }) => {
    const ws = getWorkspaceState(state, wsId);
    const scriptsById: Record<string, ScriptWithState> = {};
    for (const script of scripts) {
      scriptsById[script.id] = script;
    }
    return setWorkspaceState(state, wsId, { ...ws, scripts: scriptsById });
  })
  .with(upsertScript, (state, { payload: [wsId, script] }) => {
    const ws = getWorkspaceState(state, wsId);
    const runtime = ws.scripts[script.id]?.runtime ?? createDefaultRuntimeState();
    return setWorkspaceState(state, wsId, {
      ...ws,
      scripts: { ...ws.scripts, [script.id]: { ...script, runtime } },
    });
  })
  .with(removeScript, (state, { payload: [wsId, scriptId] }) => {
    const ws = getWorkspaceState(state, wsId);
    const { [scriptId]: _s, ...scripts } = ws.scripts;
    const { [scriptId]: _o, ...outputBuffers } = ws.outputBuffers;
    return setWorkspaceState(state, wsId, { ...ws, scripts, outputBuffers });
  })
  .with(updateRuntimeState, (state, { payload: { wsId, scriptId, partial } }) => {
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
  })
  .with(appendScriptOutput, (state, { payload: [wsId, scriptId, chunk] }) => {
    const ws = getWorkspaceState(state, wsId);
    const current = ws.outputBuffers[scriptId] ?? emptyOutputBuffer;
    const combined = trimOutputBuffer({
      chunks: [...current.chunks, chunk],
      dropped: current.dropped,
    });
    return setWorkspaceState(state, wsId, {
      ...ws,
      outputBuffers: { ...ws.outputBuffers, [scriptId]: combined },
    });
  })
  .with(setScriptOutput, (state, { payload: [wsId, scriptId, chunks] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      outputBuffers: { ...ws.outputBuffers, [scriptId]: trimOutputBuffer({ chunks, dropped: 0 }) },
    });
  })
  .with(disposeScripts, (state, { payload: [wsId] }) => clearWorkspaceState(state, wsId));
