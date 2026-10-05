import { store } from '../../store';

export const selectIsCheatSheetOpen = store.createSelector((state) => {
  return state.shortcutsCheatSheet.isOpen;
});
