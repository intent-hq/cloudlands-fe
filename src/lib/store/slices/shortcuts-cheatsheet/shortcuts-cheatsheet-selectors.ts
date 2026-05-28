import { createSelector } from "../../utils/create-selector";

export const selectIsCheatSheetOpen = createSelector((state) => {
  return state.shortcutsCheatSheet.isOpen;
});

export const selectCheatSheetContext = createSelector((state) => {
  return state.shortcutsCheatSheet.context;
});