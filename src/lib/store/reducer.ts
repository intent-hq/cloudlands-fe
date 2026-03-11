import { agentFontSettingsReducer } from "./slices/agent-font-settings/agent-font-settings-slice";
import { noteFontSettingsReducer } from "./slices/note-font-settings/note-font-settings-slice";
import { codeFontSettingsReducer } from "./slices/code-font-settings/code-font-settings-slice";
import { openActionReducer } from "./slices/open-action/open-action-slice";
import { sidebarWidthReducer } from "./slices/sidebar-width/sidebar-width-slice";
import { storeUtilityReducer } from "./slices/store-utility/store-utility-slice";
import { shortcutsCheatSheetReducer } from "./slices/shortcuts-cheatsheet/shortcuts-cheatsheet-slice";
import { tabDragReducer } from "./slices/tab-drag/tab-drag-slice";
import { tabScrollReducer } from "./slices/tab-scroll/tab-scroll-slice";
import { terminalOverlayReducer } from "./slices/terminal-overlay/terminal-overlay-slice";
import { editorSettingsReducer } from "./slices/editor-settings/editor-settings-slice";
import { noteSpellcheckSettingsReducer } from "./slices/note-spellcheck-settings/note-spellcheck-settings-slice";
import { zoomReducer } from "./slices/zoom/zoom-slice";

export const reducers = {
  agentFontSettings: agentFontSettingsReducer,
  noteFontSettings: noteFontSettingsReducer,
  codeFontSettings: codeFontSettingsReducer,
  editorSettings: editorSettingsReducer,
  openAction: openActionReducer,
  sidebarWidth: sidebarWidthReducer,
  storeUtility: storeUtilityReducer,
  shortcutsCheatSheet: shortcutsCheatSheetReducer,
  tabDrag: tabDragReducer,
  tabScroll: tabScrollReducer,
  terminalOverlay: terminalOverlayReducer,
  noteSpellcheckSettings: noteSpellcheckSettingsReducer,
  zoom: zoomReducer,
} as const;

