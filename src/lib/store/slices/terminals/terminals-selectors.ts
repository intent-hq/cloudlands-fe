import { type StoreState } from "$lib/store/types";
import { createSelector } from "../../utils/create-selector";
import { emptyWorkspaceState } from "./terminals-slice";
import { getItem, getItems } from "../../utils/collection-utils";

function getActiveWs(state: StoreState) {
  const wsId = state.workspace.activeWorkspaceId;
  if (!wsId) return emptyWorkspaceState;
  return state.terminals.workspaces[wsId] || emptyWorkspaceState;
}

export const selectIsTerminalOverlayOpen = createSelector((state) => {
  return getActiveWs(state).isOpen;
});

export const selectTerminalOverlayHeight = createSelector((state) => {
  return state.terminals.height;
});

export const selectActiveTerminalId = createSelector((state) => {
  return getActiveWs(state).activeTerminalId;
});

export const selectTerminals = createSelector((state) => {
  return getItems(getActiveWs(state).terminals);
});

/** Select only user-created terminals, filtering out agent terminals (IDs starting with "agent-") */
export const selectUserTerminals = createSelector((state) => {
  return getItems(getActiveWs(state).terminals).filter(
    (terminal) => !terminal.id.startsWith("agent-")
  );
});

/** Select workspace terminal state by workspace ID (parameterized) */
export const selectWorkspaceTerminalState = createSelector(
  (state, wsId: string) => {
    return state.terminals.workspaces[wsId] || emptyWorkspaceState;
  }
);

export const selectTerminalDisplayName = createSelector(
  (state, termId: string): string => {
    const ws = getActiveWs(state);
    const term = getItem(ws.terminals, termId);
    if (!term) return 'Terminal';
    return term.customName || term.name || 'Terminal';
  }
);

export const selectTerminalsLoaded = createSelector((state, wsId: string) => {
  const ws = state.terminals.workspaces[wsId] || emptyWorkspaceState;
  return ws.terminalsLoaded;
});

export const selectIsLoadingTerminals = createSelector((state, wsId: string) => {
  const ws = state.terminals.workspaces[wsId] || emptyWorkspaceState;
  return ws.isLoadingTerminals;
});

export const selectRecentlyCreatedTerminals = createSelector((state, wsId: string) => {
  const ws = state.terminals.workspaces[wsId] || emptyWorkspaceState;
  return ws.recentlyCreatedTerminals;
});

export const selectLoadedWorkspaceTerminals = createSelector((state, wsId: string) => {
  const ws = state.terminals.workspaces[wsId] || emptyWorkspaceState;
  if (!ws.terminalsLoaded) return [];
  return getItems(ws.terminals);
});

export const selectIsTerminalRecentlyCreated = createSelector(
  (state, wsId: string, terminalId: string) => {
    const ws = state.terminals.workspaces[wsId] || emptyWorkspaceState;
    return ws.recentlyCreatedTerminals.includes(terminalId);
  }
);
