import { storeUtilityReducer } from "./slices/store-utility/store-utility-slice";
import { shortcutsCheatSheetReducer } from "./slices/shortcuts-cheatsheet/shortcuts-cheatsheet-slice";
import { tabDragReducer } from "./slices/tab-drag/tab-drag-slice";
import { tabScrollReducer } from "./slices/tab-scroll/tab-scroll-slice";
import { terminalOverlayReducer } from "./slices/terminal-overlay/terminal-overlay-slice";

export const reducers = {
  storeUtility: storeUtilityReducer,
  shortcutsCheatSheet: shortcutsCheatSheetReducer,
  tabDrag: tabDragReducer,
  tabScroll: tabScrollReducer,
  terminalOverlay: terminalOverlayReducer,
} as const;

