/**
 * Scripts selectors — workspace-scoped.
 */

import { createSelector } from "../../utils/create-selector";
import { createDefaultRuntimeState } from "$features/scripts/types";
import type { ScriptWithState } from "./scripts-types";
import { emptyWorkspaceState } from "./scripts-slice";
import type { StoreState } from "$lib/store/types";

function getActiveWs(state: StoreState) {
  const wsId = state.workspace.activeWorkspaceId;
  if (!wsId) return emptyWorkspaceState;
  return state.scripts.byWorkspaceId[wsId] ?? emptyWorkspaceState;
}

function getWs(state: StoreState, wsId: string) {
  return state.scripts.byWorkspaceId[wsId] ?? emptyWorkspaceState;
}

/** All script entries with runtime state combined (active workspace). */
export const selectScriptEntries = createSelector((state): ScriptWithState[] => {
  const ws = getActiveWs(state);
  return Object.values(ws.scripts).map((script) => ({
    ...script,
    runtime: ws.runtimeStates[script.id] ?? createDefaultRuntimeState(),
  }));
});

/** Running scripts (active workspace). */
export const selectRunningScripts = createSelector((state): ScriptWithState[] => {
  return selectScriptEntries.select(state).filter((s) => s.runtime.status === 'running');
});

/** Idle scripts (active workspace). */
export const selectIdleScripts = createSelector((state): ScriptWithState[] => {
  return selectScriptEntries.select(state).filter((s) => s.runtime.status === 'idle');
});

/** Get a specific script by ID (active workspace). */
export const selectScriptById = createSelector(
  (state, scriptId: string) => {
    const ws = getActiveWs(state);
    return ws.scripts[scriptId] ?? null;
  },
);

/** Get runtime state for a specific script (active workspace). */
export const selectScriptRuntime = createSelector(
  (state, scriptId: string) => {
    const ws = getActiveWs(state);
    return ws.runtimeStates[scriptId] ?? createDefaultRuntimeState();
  },
);

/** Get output lines for a specific script (active workspace). */
export const selectScriptOutput = createSelector(
  (state, scriptId: string) => {
    const ws = getActiveWs(state);
    return ws.outputBuffers[scriptId] ?? [];
  },
);

/** Whether scripts are initialized for the active workspace. */
export const selectScriptsInitialized = createSelector((state) => {
  return getActiveWs(state).initialized;
});

/** Whether scripts are loading for the active workspace. */
export const selectScriptsLoading = createSelector((state) => {
  return getActiveWs(state).loading;
});

/** Scripts data for a specific workspace (parameterized). */
export const selectWorkspaceScriptEntries = createSelector(
  (state, wsId: string): ScriptWithState[] => {
    const ws = getWs(state, wsId);
    return Object.values(ws.scripts).map((script) => ({
      ...script,
      runtime: ws.runtimeStates[script.id] ?? createDefaultRuntimeState(),
    }));
  },
);

/** Get output lines for a specific workspace + script (parameterized). */
export const selectWorkspaceScriptOutput = createSelector(
  (state, wsId: string, scriptId: string) => {
    const ws = getWs(state, wsId);
    return ws.outputBuffers[scriptId] ?? [];
  },
);

/** Get a script by ID for a specific workspace (parameterized). */
export const selectWorkspaceScript = createSelector(
  (state, wsId: string, scriptId: string) => {
    const ws = getWs(state, wsId);
    return ws.scripts[scriptId] ?? null;
  },
);

/** Get runtime for a script in a specific workspace (parameterized). */
export const selectWorkspaceScriptRuntime = createSelector(
  (state, wsId: string, scriptId: string) => {
    const ws = getWs(state, wsId);
    return ws.runtimeStates[scriptId] ?? createDefaultRuntimeState();
  },
);

