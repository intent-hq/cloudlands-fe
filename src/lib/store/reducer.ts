import { openActionReducer } from "./slices/open-action/open-action-slice";
import { sidebarWidthReducer } from "./slices/sidebar-width/sidebar-width-slice";
import { storeUtilityReducer } from "./slices/store-utility/store-utility-slice";
import { shortcutsCheatSheetReducer } from "./slices/shortcuts-cheatsheet/shortcuts-cheatsheet-slice";
import { tabDragReducer } from "./slices/tab-drag/tab-drag-slice";
import { tabScrollReducer } from "./slices/tab-scroll/tab-scroll-slice";
import { terminalOverlayReducer } from "./slices/terminal-overlay/terminal-overlay-slice";
import { zoomReducer } from "./slices/zoom/zoom-slice";

export const reducers = {
  openAction: openActionReducer,
  sidebarWidth: sidebarWidthReducer,
  storeUtility: storeUtilityReducer,
  shortcutsCheatSheet: shortcutsCheatSheetReducer,
  tabDrag: tabDragReducer,
  tabScroll: tabScrollReducer,
  terminalOverlay: terminalOverlayReducer,
  zoom: zoomReducer,
} as const;

