/**
 * Scripts selectors — workspace-scoped.
 */

import { store } from '../../store';
import { createDefaultRuntimeState } from '$features/scripts/types';
import { isLiveScriptStatus } from '$features/scripts/utils/script-status';
import type { ScriptOperationState, ScriptWithState } from './scripts-types';
import { emptyOutputBuffer, emptyWorkspaceState } from './scripts-slice';
import type { StoreState } from '$store/renderer/types';

function getWs(state: StoreState, wsId: string | null | undefined) {
  if (!wsId) return emptyWorkspaceState;
  return state.scripts.byWorkspaceId[wsId] ?? emptyWorkspaceState;
}

/** Scripts initialized state (active workspace). */
export const selectScriptsInitialized = store.createSelector(
  (state, wsId: string | null): boolean => {
    const ws = getWs(state, wsId);
    return ws.initialized;
  },
);

/** All stored script entries (active workspace). */
export const selectScriptEntries = store.createSelector(
  (state, wsId: string | null): ScriptWithState[] => {
    const ws = getWs(state, wsId);
    return Object.values(ws.scripts);
  },
);

/** Live scripts — running or restarting (active workspace). */
export const selectRunningScripts = store.createSelector(
  (state, wsId: string | null): ScriptWithState[] => {
    return selectScriptEntries
      .select(state, wsId)
      .filter((s) => isLiveScriptStatus((s.runtime ?? createDefaultRuntimeState()).status));
  },
);

/** Get a specific script by ID (active workspace). */
export const selectScriptById = store.createSelector(
  (state, wsId: string | null, scriptId: string) => {
    const ws = getWs(state, wsId);
    return ws.scripts[scriptId] ?? null;
  },
);

/** Get runtime state for a specific script (active workspace). */
export const selectScriptRuntime = store.createSelector(
  (state, wsId: string | null, scriptId: string) => {
    const ws = getWs(state, wsId);
    return ws.scripts[scriptId]?.runtime ?? createDefaultRuntimeState();
  },
);

/** Get the raw-chunk output buffer for a specific script (active workspace). */
export const selectScriptOutput = store.createSelector(
  (state, wsId: string | null, scriptId: string) => {
    const ws = getWs(state, wsId);
    return ws.outputBuffers[scriptId] ?? emptyOutputBuffer;
  },
);

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

export const selectWorkspaceScriptOperations = store.createSelector(
  (state, wsId: string): Record<string, ScriptOperationState> => getWs(state, wsId).operations,
);

/** Get runtime for a script in a specific workspace (parameterized). */
export const selectWorkspaceScriptRuntime = store.createSelector(
  (state, wsId: string, scriptId: string) => {
    const ws = getWs(state, wsId);
    return ws.scripts[scriptId]?.runtime ?? createDefaultRuntimeState();
  },
);
