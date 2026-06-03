/**
 * Scripts slice — actions and reducer.
 *
 * Workspace-scoped state for script entries and output.
 */

import { createAction } from 'ag-redux-toolkit/utils/store/create-action';
import { createReducer } from 'ag-redux-toolkit/utils/store/create-reducer';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { createDefaultRuntimeState } from '$features/scripts/types';
import type {
  WorkspaceScript,
  ScriptRuntimeState,
  ScriptWithState,
  ScriptsState,
  ScriptsWorkspaceState,
  ScriptOutputLine,
} from './scripts-types';

// ============================================================================
// Constants
// ============================================================================

export const MAX_OUTPUT_LINES = 5000;

// ============================================================================
// Empty / Initial State
// ============================================================================

export const emptyWorkspaceState: ScriptsWorkspaceState = {
  scripts: {},
  outputBuffers: {},
  initialized: false,
  loading: false,
};

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

/** Append output lines for a script */
export const appendScriptOutput =
  createAction<[wsId: string, scriptId: string, lines: ScriptOutputLine[]]>('scripts/appendOutput');

/** Set output buffer for a script (used during init to load buffered output) */
export const setScriptOutput =
  createAction<[wsId: string, scriptId: string, lines: ScriptOutputLine[]]>('scripts/setOutput');

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
  .with(appendScriptOutput, (state, { payload: [wsId, scriptId, lines] }) => {
    const ws = getWorkspaceState(state, wsId);
    const current = ws.outputBuffers[scriptId] ?? [];
    let combined = [...current, ...lines];
    if (combined.length > MAX_OUTPUT_LINES) {
      combined = combined.slice(combined.length - MAX_OUTPUT_LINES);
    }
    return setWorkspaceState(state, wsId, {
      ...ws,
      outputBuffers: { ...ws.outputBuffers, [scriptId]: combined },
    });
  })
  .with(setScriptOutput, (state, { payload: [wsId, scriptId, lines] }) => {
    const ws = getWorkspaceState(state, wsId);
    return setWorkspaceState(state, wsId, {
      ...ws,
      outputBuffers: { ...ws.outputBuffers, [scriptId]: lines },
    });
  })
  .with(disposeScripts, (state, { payload: [wsId] }) => clearWorkspaceState(state, wsId));
