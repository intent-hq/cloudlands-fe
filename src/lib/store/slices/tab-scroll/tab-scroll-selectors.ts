import { createSelector } from "../../utils/create-selector";

export const selectScrollPosition = createSelector(
  (state, tabId: string): number | undefined => {
    return state.tabScroll.positions[tabId];
  }
);

export const selectAllScrollPositions = createSelector((state) => {
  return state.tabScroll.positions;
});

