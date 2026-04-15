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
import { transientUiReducer } from "./slices/transient-ui/transient-ui-slice";
import { workspaceOperationsReducer } from "./slices/workspace-operations/workspace-operations-slice";
import { workspaceAgentsReducer } from "./slices/workspace-agents/workspace-agents-slice";
import { workspaceNavigationReducer } from "./slices/workspace-navigation/workspace-navigation-slice";
import { workspaceNotesReducer } from "./slices/workspace-notes/workspace-notes-slice";
import { workspaceSwitcherReducer } from "./slices/workspace-switcher/workspace-switcher-slice";
import { workspaceEventsReducer } from "./slices/workspace-events/workspace-events-slice";
import { paletteReducer } from "./slices/palette/palette-slice";
import { releaseNotesReducer } from "./slices/release-notes/release-notes-slice";
import { skillsReducer } from "./slices/skills/skills-slice";
import { workspaceReducer } from "./slices/workspace/workspace-slice";
import { githubAuthReducer } from "./slices/github-auth/github-auth-slice";
import { githubReposReducer } from "./slices/github-repos/github-repos-slice";
import { githubRepoSearchReducer } from "./slices/github-repo-search/github-repo-search-slice";
import { clonePreflightReducer } from "./slices/clone-preflight/clone-preflight-slice";
import { linearAuthReducer } from "./slices/linear-auth/linear-auth-slice";
import { browserReducer } from "./slices/browser/browser-slice";
import { sentryAuthReducer } from "./slices/sentry-auth/sentry-auth-slice";
import { contextReducer } from "./slices/context/context-slice";
import { setupScriptsReducer } from "./slices/setup-scripts/setup-scripts-slice";
import { mcpServersReducer } from "./slices/mcp-servers/mcp-servers-slice";
import { mcpSettingsReducer } from "./slices/mcp-settings/mcp-settings-slice";
import { commentsReducer } from "./slices/comments/comments-slice";
import { lineChangesReducer } from "./slices/line-changes/line-changes-slice";
import { autoUpdateReducer } from "./slices/auto-update/auto-update-slice";
import { sidebarNavReducer } from "./slices/sidebar-nav/sidebar-nav-slice";
import { scriptsReducer } from "./slices/scripts/scripts-slice";
import { agentFollowReducer } from "./slices/agent-follow/agent-follow-slice";
import { gitReducer } from "./slices/git/git-slice";
import { agentOverviewReducer } from "./slices/agent-overview/agent-overview-slice";
import { fileTrackingReducer } from "./slices/file-tracking/file-tracking-slice";
import { agentLockReducer } from "./slices/agent-lock/agent-lock-slice";
import { panelLayoutReducer } from "./slices/panel-layout/panel-layout-slice";
import { streamingConfigReducer } from "./slices/streaming-config/streaming-config-slice";
import { unreadTrackingReducer } from "./slices/unread-tracking/unread-tracking-slice";
import { prStatusReducer } from "./slices/pr-status/pr-status-slice";
import { backgroundAgentExecutorReducer } from "./slices/background-agent-executor/background-agent-executor-slice";
import { chatStateReducer } from "./slices/chat-state/chat-state-slice";
import { fileExplorerReducer } from "./slices/file-explorer/file-explorer-slice";
import { agentSessionReducer } from "./slices/agent-session/agent-session-slice";
import { agentSubscriptionUIReducer } from "./slices/agent-subscription-ui/agent-subscription-ui-slice";
import { onboardingReducer } from "./slices/onboarding/onboarding-slice";
import { agentAvailabilityReducer } from "./slices/agent-availability/agent-availability-slice";

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
  transientUi: transientUiReducer,
  userPreferences: userPreferencesReducer,
  workspaceAgents: workspaceAgentsReducer,
  workspaceNavigation: workspaceNavigationReducer,
  workspaceNotes: workspaceNotesReducer,
  workspaceOperations: workspaceOperationsReducer,
  workspaceSettings: workspaceSettingsReducer,
  workspaceSwitcher: workspaceSwitcherReducer,
  workspaceEvents: workspaceEventsReducer,
  palette: paletteReducer,
  releaseNotes: releaseNotesReducer,
  workspace: workspaceReducer,
  skills: skillsReducer,
  githubAuth: githubAuthReducer,
  githubRepos: githubReposReducer,
  githubRepoSearch: githubRepoSearchReducer,
  clonePreflight: clonePreflightReducer,
  linearAuth: linearAuthReducer,
  sentryAuth: sentryAuthReducer,
  browser: browserReducer,
  context: contextReducer,
  setupScripts: setupScriptsReducer,
  mcpServers: mcpServersReducer,
  mcpSettings: mcpSettingsReducer,
  comments: commentsReducer,
  lineChanges: lineChangesReducer,
  autoUpdate: autoUpdateReducer,
  sidebarNav: sidebarNavReducer,
  scripts: scriptsReducer,
  agentFollow: agentFollowReducer,
  git: gitReducer,
  agentOverview: agentOverviewReducer,
  fileTracking: fileTrackingReducer,
  agentLock: agentLockReducer,
  panelLayout: panelLayoutReducer,
  streamingConfig: streamingConfigReducer,
  unreadTracking: unreadTrackingReducer,
  prStatus: prStatusReducer,
  bgExecutor: backgroundAgentExecutorReducer,
  chatState: chatStateReducer,
  fileExplorer: fileExplorerReducer,
  agentSessions: agentSessionReducer,
  agentSubscriptionUI: agentSubscriptionUIReducer,
  onboarding: onboardingReducer,
  agentAvailability: agentAvailabilityReducer,
} as const;

