import { createSelector } from "../../utils/create-selector";

export const selectPanels = createSelector((state) => {
  return state.multiPanelContext.panels;
});

export const selectCheckedPanels = createSelector((state) => {
  return state.multiPanelContext.panels.filter((p) => p.checked);
});

export const selectSelections = createSelector((state) => {
  return state.multiPanelContext.selections;
});

export const selectCheckedSelections = createSelector((state) => {
  return state.multiPanelContext.selections.filter((s) => s.checked);
});

export const selectHasSelections = createSelector((state) => {
  return state.multiPanelContext.selections.length > 0;
});

export const selectSelectionCount = createSelector((state) => {
  return state.multiPanelContext.selections.length;
});

export const selectWorkspaceId = createSelector((state) => {
  return state.multiPanelContext.workspaceId;
});

export const selectCurrentAgentPanelId = createSelector((state) => {
  return state.multiPanelContext.currentAgentPanelId;
});

