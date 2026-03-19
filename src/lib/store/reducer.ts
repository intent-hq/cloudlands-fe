import { providerSettingsReducer } from "./slices/provider-settings/provider-settings-slice";
import { backgroundAgentSettingsReducer } from "./slices/background-agent-settings/background-agent-settings-slice";
import { fontSettingsReducer } from "./slices/font-settings/font-settings-slice";
import { externalEditorsReducer } from "./slices/external-editors/external-editors-slice";
import { uiLayoutReducer } from "./slices/ui-layout/ui-layout-slice";
import { storeUtilityReducer } from "./slices/store-utility/store-utility-slice";
import { shortcutsCheatSheetReducer } from "./slices/shortcuts-cheatsheet/shortcuts-cheatsheet-slice";
import { tabStateReducer } from "./slices/tab-state/tab-state-slice";
import { terminalOverlayReducer } from "./slices/terminal-overlay/terminal-overlay-slice";
import { userPreferencesReducer } from "./slices/user-preferences/user-preferences-slice";
import { notificationSettingsReducer } from "./slices/notification-settings/notification-settings-slice";
import { workspaceSettingsReducer } from "./slices/workspace-settings/workspace-settings-slice";
import { noteReadTrackingReducer } from "./slices/note-read-tracking/note-read-tracking-slice";
import { multiPanelContextReducer } from "./slices/multi-panel-context/multi-panel-context-slice";
import { permissionReducer } from "./slices/permission/permission-slice";
import { pipReducer } from "./slices/pip/pip-slice";
import { featureCodesReducer } from "./slices/feature-codes/feature-codes-slice";
import { modelReducer } from "./slices/model/model-slice";
import { specialistsReducer } from "./slices/specialists/specialists-slice";

export const reducers = {
  providerSettings: providerSettingsReducer,
  backgroundAgentSettings: backgroundAgentSettingsReducer,
  fontSettings: fontSettingsReducer,
  externalEditors: externalEditorsReducer,
  uiLayout: uiLayoutReducer,
  storeUtility: storeUtilityReducer,
  shortcutsCheatSheet: shortcutsCheatSheetReducer,
  tabState: tabStateReducer,
  terminalOverlay: terminalOverlayReducer,
  notificationSettings: notificationSettingsReducer,
  noteReadTracking: noteReadTrackingReducer,
  multiPanelContext: multiPanelContextReducer,
  permission: permissionReducer,
  featureCodes: featureCodesReducer,
  model: modelReducer,
  pip: pipReducer,
  specialists: specialistsReducer,
  userPreferences: userPreferencesReducer,
  workspaceSettings: workspaceSettingsReducer,
} as const;

