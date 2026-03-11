import { createSelector } from "../../utils/create-selector";

export const selectLineWrapping = createSelector((state) => {
  return state.editorSettings.lineWrapping;
});

export const selectFoldUnchanged = createSelector((state) => {
  return state.editorSettings.foldUnchanged;
});

export const selectDiffSideBySide = createSelector((state) => {
  return state.editorSettings.diffSideBySide;
});

export const selectDiffIndicators = createSelector((state) => {
  return state.editorSettings.diffIndicators;
});

