import { store } from "../../store";
import { serializeWorkspaceTabsState } from "./tab-state-slice";

export const selectIsDragging = store.createSelector((state) => {
  return state.tabState.isDragging;
});

export const selectActiveHandleDrop = store.createSelector((state) => {
  return state.tabState.activeHandleDrop;
});

export const selectScrollPosition = store.createSelector(
  (state, tabId: string): number | undefined => {
    return state.tabState.scrollPositions[tabId];
  }
);

export const selectAllScrollPositions = store.createSelector((state) => {
  return state.tabState.scrollPositions;
});

export const selectCurrentWorkspaceTabId = store.createSelector((state) => {
  return state.tabState.currentTabId;
});

export const selectWorkspaceTabOrder = store.createSelector((state) => {
  return state.tabState.tabOrder;
});

export const selectPersistedWorkspaceTabsState = store.createSelector((state) => {
  return serializeWorkspaceTabsState(state.tabState);
});