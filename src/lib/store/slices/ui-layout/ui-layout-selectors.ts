import { createSelector } from "../../utils/create-selector";

export const selectLineWrapping = createSelector((state) => {
  return state.uiLayout.lineWrapping;
});

export const selectFoldUnchanged = createSelector((state) => {
  return state.uiLayout.foldUnchanged;
});

export const selectDiffSideBySide = createSelector((state) => {
  return state.uiLayout.diffSideBySide;
});

export const selectDiffIndicators = createSelector((state) => {
  return state.uiLayout.diffIndicators;
});

export const selectSidebarWidth = createSelector((state) => {
  return state.uiLayout.sidebarWidth;
});

export const selectIsCollapsed = createSelector((state) => {
  return state.uiLayout.sidebarCollapsed;
});

export const selectWidthBeforeCollapse = createSelector((state) => {
  return state.uiLayout.sidebarWidthBeforeCollapse;
});

export const selectEffectiveWidth = createSelector((state) => {
  return state.uiLayout.sidebarCollapsed ? 0 : state.uiLayout.sidebarWidth;
});