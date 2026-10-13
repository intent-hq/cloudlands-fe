import { githubReposReducer } from '../../../../src/store/renderer/slices/github-repos/github-repos-slice';
import { knownReposReducer } from '../../../../src/store/renderer/slices/known-repos/known-repos-slice';
import { scriptsReducer } from '../../../../src/store/renderer/slices/scripts/scripts-slice';
import { fileTrackingReducer } from '../../../../src/store/renderer/slices/changes/changes-slice';
import { prStatusReducer } from '../../../../src/store/renderer/slices/pr-status/pr-status-slice';
import { terminalsReducer } from '../../../../src/store/renderer/slices/terminals/terminals-slice';
import { workspaceTasksReducer } from '../../../../src/store/renderer/slices/workspace-tasks/workspace-tasks-slice';
import '@tanstack/react-start/client-only';
import { ReactStore } from '@themislib/themis/react-store';
import type { StoreState } from '@themislib/themis/types';
import { catalogReducer } from './catalog/catalog-slice';
import { uiHighlightReducer } from '../../../../src/store/renderer/slices/ui-highlight/ui-highlight-slice';
import { autoUpdateReducer } from '../../../../src/store/renderer/slices/auto-update/auto-update-slice';
import { uiLayoutReducer } from '../../../../src/store/renderer/slices/ui-layout/ui-layout-slice';
import { userPreferencesReducer } from '../../../../src/store/renderer/slices/user-preferences/user-preferences-slice';
import { daemonHealthReducer } from '../../../../src/store/renderer/slices/daemon-health/daemon-health-slice';
import { directoryPickerReducer } from '../../../../src/store/renderer/slices/directory-picker/directory-picker-slice';
import { connectionsReducer } from '../../../../src/store/renderer/slices/connections/connections-slice';
import { principalReducer } from '../../../../src/store/renderer/slices/principal/principal-slice';
import { hostExecutionReducer } from '../../../../src/store/renderer/slices/host-execution/host-execution-slice';
import { workspaceEventsReducer } from '../../../../src/store/renderer/slices/workspace-events/workspace-events-slice';
import { workspaceReducer } from '../../../../src/store/renderer/slices/workspace/workspace-slice';
import { workspaceLifecycleReducer } from '../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { providerCatalogReducer } from '../../../../src/store/renderer/slices/provider-catalog/provider-catalog-slice';
import { providerModelsReducer } from '../../../../src/store/renderer/slices/provider-models/provider-models-slice';
import { modelReducer } from '../../../../src/store/renderer/slices/model/model-slice';
import { providerSettingsReducer } from '../../../../src/store/renderer/slices/provider-settings/provider-settings-slice';
import { agentAvailabilityReducer } from '../../../../src/store/renderer/slices/agent-availability/agent-availability-slice';
import { backgroundAgentSettingsReducer } from '../../../../src/store/renderer/slices/background-agent-settings/background-agent-settings-slice';
import { agentSessionReducer } from '../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import { agentModelReducer } from '../../../../src/store/renderer/slices/agent-model/agent-model-slice';
import { workspaceAgentsReducer } from '../../../../src/store/renderer/slices/workspace-agents/workspace-agents-slice';
import { panelLayoutReducer } from '../../../../src/store/renderer/slices/panel-layout/panel-layout-slice';
import { externalEditorsReducer } from '../../../../src/store/renderer/slices/external-editors/external-editors-slice';
import { sidebarNavReducer } from '../../../../src/store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { acquiredTabStateReducer } from '../../../../src/store/renderer/slices/tab-state/tab-state-acquisition-reducer';
import { workspaceNavigationReducer } from '../../../../src/store/renderer/slices/workspace-navigation/workspace-navigation-slice';
import { permissionReducer } from '../../../../src/store/renderer/slices/permission/permission-slice';
import { linkTooltipReducer } from './link-tooltip/link-tooltip-slice';
import { workspaceNotesReducer } from '../../../../src/store/renderer/slices/workspace-notes/workspace-notes-slice';
import { gitReducer } from '../../../../src/store/renderer/slices/git/git-slice';

export const store = new ReactStore({
  githubRepos: githubReposReducer,
  knownRepos: knownReposReducer,
  catalog: catalogReducer,
  scripts: scriptsReducer,
  changes: fileTrackingReducer,
  prStatus: prStatusReducer,
  terminals: terminalsReducer,
  workspaceTasks: workspaceTasksReducer,
  uiHighlight: uiHighlightReducer,
  autoUpdate: autoUpdateReducer,
  uiLayout: uiLayoutReducer,
  userPreferences: userPreferencesReducer,
  daemonHealth: daemonHealthReducer,
  directoryPicker: directoryPickerReducer,
  linkTooltip: linkTooltipReducer,
  connections: connectionsReducer,
  principal: principalReducer,
  hostExecution: hostExecutionReducer,
  workspaceEvents: workspaceEventsReducer,
  workspace: workspaceReducer,
  workspaceLifecycle: workspaceLifecycleReducer,
  providerCatalog: providerCatalogReducer,
  providerModels: providerModelsReducer,
  model: modelReducer,
  providerSettings: providerSettingsReducer,
  agentAvailability: agentAvailabilityReducer,
  backgroundAgentSettings: backgroundAgentSettingsReducer,
  agentSessions: agentSessionReducer,
  agentModel: agentModelReducer,
  workspaceAgents: workspaceAgentsReducer,
  panelLayout: panelLayoutReducer,
  externalEditors: externalEditorsReducer,
  sidebarNav: sidebarNavReducer,
  tabState: acquiredTabStateReducer,
  workspaceNavigation: workspaceNavigationReducer,
  permission: permissionReducer,
  workspaceNotes: workspaceNotesReducer,
  git: gitReducer,
});
export type AppState = StoreState<typeof store>;
