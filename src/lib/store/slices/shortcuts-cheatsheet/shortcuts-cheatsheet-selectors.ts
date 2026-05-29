import { store } from "../../store";

export const selectIsCheatSheetOpen = store.createSelector((state) => {
  return state.shortcutsCheatSheet.isOpen;
});

export const selectCheatSheetContext = store.createSelector((state) => {
  return state.shortcutsCheatSheet.context;
});