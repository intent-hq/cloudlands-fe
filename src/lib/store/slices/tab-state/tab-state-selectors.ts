import { createSelector } from "../../utils/create-selector";

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