import { createSelector } from "../../utils/create-selector";

export const selectSidebarWidth = createSelector((state) => {
  return state.sidebarWidth.width;
});

export const selectIsCollapsed = createSelector((state) => {
  return state.sidebarWidth.isCollapsed;
});

export const selectWidthBeforeCollapse = createSelector((state) => {
  return state.sidebarWidth.widthBeforeCollapse;
});

export const selectEffectiveWidth = createSelector((state) => {
  return state.sidebarWidth.isCollapsed ? 0 : state.sidebarWidth.width;
});

