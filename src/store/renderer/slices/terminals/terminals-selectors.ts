import { store } from "../../store";
import { type StoreState } from "$store/renderer/types";
import {
  emptyWorkspaceState,
  type TerminalTab,
} from "./terminals-slice";
import {
  getItem,
  getItems,
} from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";

function getActiveWs(state: StoreState) {
  const wsId = state.workspace.activeWorkspaceId;
  if (!wsId) return emptyWorkspaceState;
  return state.terminals.workspaces[wsId] || emptyWorkspaceState;
}

function getWsById(state: StoreState, wsId: string) {
  return state.terminals.workspaces[wsId] || emptyWorkspaceState;
}

function isSetupTerminal(terminal: TerminalTab): boolean {
  return (terminal.customName || terminal.name) === 'Setup';
}

export const selectIsTerminalOverlayOpen = store.createSelector((state) => {
  return getActiveWs(state).isOpen;
});

export const selectTerminalOverlayHeight = store.createSelector((state) => {
  return state.terminals.height;
});

export const selectActiveTerminalId = store.createSelector((state) => {
  return getActiveWs(state).activeTerminalId;
});

export const selectTerminals = store.createSelector((state) => {
  return getItems(getActiveWs(state).terminals);
});

export const selectIsTerminalOverlayOpenForWorkspace = store.createSelector((state, wsId: string) => {
  return getWsById(state, wsId).isOpen;
});

export const selectActiveTerminalIdForWorkspace = store.createSelector((state, wsId: string) => {
  return getWsById(state, wsId).activeTerminalId;
});

export const selectTerminalsForWorkspace = store.createSelector((state, wsId: string) => {
  return getItems(getWsById(state, wsId).terminals);
});

export const selectWorkspaceSetupTerminal = store.createSelector((state, wsId: string) => {
  return getItems(getWsById(state, wsId).terminals).find(isSetupTerminal);
});

/** Select only user-created terminals, filtering out agent terminals (IDs starting with "agent-") */
export const selectUserTerminals = store.createSelector((state) => {
  return getItems(getActiveWs(state).terminals).filter(
    (terminal) => !terminal.id.startsWith("agent-")
  );
});

/** Select workspace terminal state by workspace ID (parameterized) */
export const selectWorkspaceTerminalState = store.createSelector(
  (state, wsId: string) => {
    return state.terminals.workspaces[wsId] || emptyWorkspaceState;
  }
);

export const selectTerminalDisplayName = store.createSelector(
  (state, termId: string): string => {
    const ws = getActiveWs(state);
    const term = getItem(ws.terminals, termId);
    if (!term) return 'Terminal';
    return term.customName || term.name || 'Terminal';
  }
);

export const selectTerminalsLoaded = store.createSelector((state, wsId: string) => {
  const ws = state.terminals.workspaces[wsId] || emptyWorkspaceState;
  return ws.terminalsLoaded;
});

export const selectRecentlyCreatedTerminals = store.createSelector((state, wsId: string) => {
  const ws = state.terminals.workspaces[wsId] || emptyWorkspaceState;
  return ws.recentlyCreatedTerminals;
});

export const selectLoadedWorkspaceTerminals = store.createSelector((state, wsId: string) => {
  const ws = state.terminals.workspaces[wsId] || emptyWorkspaceState;
  if (!ws.terminalsLoaded) return [];
  return getItems(ws.terminals);
});
