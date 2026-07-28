/**
 * Scripts selectors — workspace-scoped.
 */

import { store } from "../../store";
import { createDefaultRuntimeState } from '$features/scripts/types';
import type { ScriptWithState } from './scripts-types';
import { emptyOutputBuffer, emptyWorkspaceState } from './scripts-slice';
import type { StoreState } from '$store/renderer/types';

function getActiveWs(state: StoreState) {
  const wsId = state.workspace.activeWorkspaceId;
  if (!wsId) return emptyWorkspaceState;
  return state.scripts.byWorkspaceId[wsId] ?? emptyWorkspaceState;
}

function getWs(state: StoreState, wsId: string) {
  return state.scripts.byWorkspaceId[wsId] ?? emptyWorkspaceState;
}

/** Scripts initialized state (active workspace). */
export const selectScriptsInitialized = store.createSelector((state): boolean => {
  const ws = getActiveWs(state);
  return ws.initialized;
});

/** All stored script entries (active workspace). */
export const selectScriptEntries = store.createSelector((state): ScriptWithState[] => {
  const ws = getActiveWs(state);
  return Object.values(ws.scripts);
});

/** Running scripts (active workspace). */
export const selectRunningScripts = store.createSelector((state): ScriptWithState[] => {
  return selectScriptEntries
    .select(state)
    .filter((s) => (s.runtime ?? createDefaultRuntimeState()).status === 'running');
});

/** Get a specific script by ID (active workspace). */
export const selectScriptById = store.createSelector((state, scriptId: string) => {
  const ws = getActiveWs(state);
  return ws.scripts[scriptId] ?? null;
});

/** Get runtime state for a specific script (active workspace). */
export const selectScriptRuntime = store.createSelector((state, scriptId: string) => {
  const ws = getActiveWs(state);
  return ws.scripts[scriptId]?.runtime ?? createDefaultRuntimeState();
});

/** Get the raw-chunk output buffer for a specific script (active workspace). */
export const selectScriptOutput = store.createSelector((state, scriptId: string) => {
  const ws = getActiveWs(state);
  return ws.outputBuffers[scriptId] ?? emptyOutputBuffer;
});

/** Scripts data for a specific workspace (parameterized). */
export const selectWorkspaceScriptsInitialized = store.createSelector(
  (state, wsId: string): boolean => getWs(state, wsId).initialized,
);

export const selectWorkspaceScriptEntries = store.createSelector(
  (state, wsId: string): ScriptWithState[] => {
    const ws = getWs(state, wsId);
    return Object.values(ws.scripts);
  },
);

/** Get runtime for a script in a specific workspace (parameterized). */
export const selectWorkspaceScriptRuntime = store.createSelector(
  (state, wsId: string, scriptId: string) => {
    const ws = getWs(state, wsId);
    return ws.scripts[scriptId]?.runtime ?? createDefaultRuntimeState();
  },
);
