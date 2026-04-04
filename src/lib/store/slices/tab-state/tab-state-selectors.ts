import { createSelector } from "../../utils/create-selector";
import { serializeWorkspaceTabsState } from "./tab-state-slice";

export const selectIsDragging = createSelector((state) => {
  return state.tabState.isDragging;
});

export const selectActiveHandleDrop = createSelector((state) => {
  return state.tabState.activeHandleDrop;
});

export const selectScrollPosition = createSelector(
  (state, tabId: string): number | undefined => {
    return state.tabState.scrollPositions[tabId];
  }
);

export const selectAllScrollPositions = createSelector((state) => {
  return state.tabState.scrollPositions;
});

export const selectCurrentWorkspaceTabId = createSelector((state) => {
  return state.tabState.currentTabId;
});

export const selectWorkspaceTabOrder = createSelector((state) => {
  return state.tabState.tabOrder;
});

export const selectPersistedWorkspaceTabsState = createSelector((state) => {
  return serializeWorkspaceTabsState(state.tabState);
});