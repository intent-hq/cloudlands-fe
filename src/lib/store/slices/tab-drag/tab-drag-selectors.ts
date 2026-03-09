import { createSelector } from "../../utils/create-selector";

export const selectIsDragging = createSelector((state) => {
  return state.tabDrag.isDragging;
});

export const selectActiveHandleDrop = createSelector((state) => {
  return state.tabDrag.activeHandleDrop;
});

