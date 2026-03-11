import { createSelector } from "../../utils/create-selector";

export const selectNoteFontStyle = createSelector((state) => {
  return state.noteFontSettings.fontStyle;
});

export const selectNoteFontStyleLabel = createSelector((state) => {
  switch (state.noteFontSettings.fontStyle) {
    case 'sans':
      return 'Sans-serif';
    case 'monospace':
      return 'Monospace';
    default:
      return 'Sans-serif';
  }
});

export const selectIsNoteMonospace = createSelector((state) => {
  return state.noteFontSettings.fontStyle === 'monospace';
});

