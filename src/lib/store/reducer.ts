import { providerSettingsReducer } from "./slices/provider-settings/provider-settings-slice";
import { backgroundAgentSettingsReducer } from "./slices/background-agent-settings/background-agent-settings-slice";
import { externalEditorsReducer } from "./slices/external-editors/external-editors-slice";
import { uiLayoutReducer } from "./slices/ui-layout/ui-layout-slice";
import { storeUtilityReducer } from "./slices/store-utility/store-utility-slice";
import { shortcutsCheatSheetReducer } from "./slices/shortcuts-cheatsheet/shortcuts-cheatsheet-slice";
import { tabStateReducer } from "./slices/tab-state/tab-state-slice";
import { terminalsReducer } from "./slices/terminals/terminals-slice";
import { userPreferencesReducer } from "./slices/user-preferences/user-preferences-slice";
import { workspaceSettingsReducer } from "./slices/workspace-settings/workspace-settings-slice";
import { noteReadTrackingReducer } from "./slices/note-read-tracking/note-read-tracking-slice";
import { multiPanelContextReducer } from "./slices/multi-panel-context/multi-panel-context-slice";
import { permissionReducer } from "./slices/permission/permission-slice";
import { pipReducer } from "./slices/pip/pip-slice";
import { featureCodesReducer } from "./slices/feature-codes/feature-codes-slice";
import { globalModalsReducer } from "./slices/global-modals/global-modals-slice";
import { gitOperationsReducer } from "./slices/git-operations/git-operations-slice";
import { knownReposReducer } from "./slices/known-repos/known-repos-slice";
import { deepLinksReducer } from "./slices/deep-links/deep-links-slice";
import { modelReducer } from "./slices/model/model-slice";
import { specialistsReducer } from "./slices/specialists/specialists-slice";
import { systemStatusReducer } from "./slices/system-status/system-status-slice";
import { workspaceOperationsReducer } from "./slices/workspace-operations/workspace-operations-slice";
import { workspaceAgentsReducer } from "./slices/workspace-agents/workspace-agents-slice";
import { workspaceReducer } from "./slices/workspace/workspace-slice";

export const reducers = {
  providerSettings: providerSettingsReducer,
  backgroundAgentSettings: backgroundAgentSettingsReducer,
  externalEditors: externalEditorsReducer,
  uiLayout: uiLayoutReducer,
  storeUtility: storeUtilityReducer,
  shortcutsCheatSheet: shortcutsCheatSheetReducer,
  tabState: tabStateReducer,
  terminals: terminalsReducer,
  noteReadTracking: noteReadTrackingReducer,
  multiPanelContext: multiPanelContextReducer,
  permission: permissionReducer,
  featureCodes: featureCodesReducer,
  globalModals: globalModalsReducer,
  gitOperations: gitOperationsReducer,
  knownRepos: knownReposReducer,
  deepLinks: deepLinksReducer,
  model: modelReducer,
  pip: pipReducer,
  specialists: specialistsReducer,
  systemStatus: systemStatusReducer,
  userPreferences: userPreferencesReducer,
  workspaceAgents: workspaceAgentsReducer,
  workspaceOperations: workspaceOperationsReducer,
  workspaceSettings: workspaceSettingsReducer,
  workspace: workspaceReducer,
} as const;

