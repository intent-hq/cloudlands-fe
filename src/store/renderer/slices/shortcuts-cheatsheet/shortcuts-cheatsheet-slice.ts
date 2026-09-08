import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';

export type CheatSheetContext = 'global' | 'chat' | 'editor' | 'panel' | 'terminal';

export type ShortcutsCheatSheetState = {
  isOpen: boolean;
  context: CheatSheetContext;
};

const initialState: ShortcutsCheatSheetState = {
  isOpen: false,
  context: 'global',
};

export const openCheatSheet = createAction<[context: CheatSheetContext]>(
  'shortcutsCheatSheet/openCheatSheet',
);
export const closeCheatSheet = createAction('shortcutsCheatSheet/closeCheatSheet');
export const toggleCheatSheet = createAction<[context: CheatSheetContext]>(
  'shortcutsCheatSheet/toggleCheatSheet',
);

export const shortcutsCheatSheetReducer = createReducer<ShortcutsCheatSheetState>(initialState);
shortcutsCheatSheetReducer.with(openCheatSheet, (state, { payload: [context] }) => ({
  ...state,
  isOpen: true,
  context,
}));
shortcutsCheatSheetReducer.with(closeCheatSheet, (state) => ({
  ...state,
  isOpen: false,
}));
shortcutsCheatSheetReducer.with(toggleCheatSheet, (state, { payload: [context] }) => {
  if (state.isOpen) {
    return {
      ...state,
      isOpen: false,
    };
  }

  return {
    ...state,
    isOpen: true,
    context,
  };
});
