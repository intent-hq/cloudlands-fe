import { type StoreState } from "$lib/store/types";
import { createSelector } from "../../utils/create-selector";
import { emptyWorkspaceState } from "./terminal-overlay-slice";

function getActiveWs(state: StoreState) {
  const wsId = state.terminalOverlay.activeWorkspaceId;
  if (!wsId) return emptyWorkspaceState;
  return state.terminalOverlay.workspaces[wsId] || emptyWorkspaceState;
}

export const selectIsTerminalOverlayOpen = createSelector((state) => {
  return getActiveWs(state).isOpen;
});

export const selectTerminalOverlayHeight = createSelector((state) => {
  return state.terminalOverlay.height;
});

export const selectTerminalOverlayWorkspaceId = createSelector((state) => {
  return state.terminalOverlay.activeWorkspaceId;
});

export const selectActiveTerminalId = createSelector((state) => {
  return getActiveWs(state).activeTerminalId;
});

export const selectTerminals = createSelector((state) => {
  return getActiveWs(state).terminals;
});

/** Select workspace terminal state by workspace ID (parameterized) */
export const selectWorkspaceTerminalState = createSelector(
  (state, wsId: string) => {
    return state.terminalOverlay.workspaces[wsId] || emptyWorkspaceState;
  }
);

export const selectTerminalDisplayName = createSelector(
  (state, termId: string): string => {
    const ws = getActiveWs(state);
    const term = ws.terminals.find((t: any) => t.id === termId);
    if (!term) return 'Terminal';
    return term.customName || term.name || 'Terminal';
  }
);

