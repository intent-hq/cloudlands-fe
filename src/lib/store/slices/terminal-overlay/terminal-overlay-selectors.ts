import { createSelector } from "../../utils/create-selector";

export const selectIsTerminalOverlayOpen = createSelector((state) => {
  return state.terminalOverlay.isOpen;
});

export const selectTerminalOverlayHeight = createSelector((state) => {
  return state.terminalOverlay.height;
});

export const selectTerminalOverlayWorkspaceId = createSelector((state) => {
  return state.terminalOverlay.workspaceId;
});

export const selectActiveTerminalId = createSelector((state) => {
  return state.terminalOverlay.activeTerminalId;
});

export const selectTerminals = createSelector((state) => {
  return state.terminalOverlay.terminals;
});

export const selectTerminalDisplayName = createSelector(
  (state, termId: string): string => {
    const term = state.terminalOverlay.terminals.find((t) => t.id === termId);
    if (!term) return 'Terminal';
    return term.customName || term.name || 'Terminal';
  }
);

