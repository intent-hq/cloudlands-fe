import { providerSettingsReducer } from "./slices/provider-settings/provider-settings-slice";
import { backgroundAgentSettingsReducer } from "./slices/background-agent-settings/background-agent-settings-slice";
import { externalEditorsReducer } from "./slices/external-editors/external-editors-slice";
import { uiLayoutReducer } from "./slices/ui-layout/ui-layout-slice";
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
import { workspaceTasksReducer } from "./slices/workspace-tasks/workspace-tasks-slice";
import { workspaceSummariesReducer } from "./slices/workspace-summaries/workspace-summaries-slice";
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
import { mcpSettingsReducer } from "./slices/mcp-settings/mcp-settings-slice";
import { commentsReducer } from "./slices/comments/comments-slice";
import { taskAgentAssociationsReducer } from "./slices/task-agent-associations/task-agent-associations-slice";

import { autoUpdateReducer } from "./slices/auto-update/auto-update-slice";
import { sidebarNavReducer } from "./slices/sidebar-nav/sidebar-nav-slice";
import { scriptsReducer } from "./slices/scripts/scripts-slice";
import { agentFollowReducer } from "./slices/agent-follow/agent-follow-slice";
import { gitReducer } from "./slices/git/git-slice";
import { fileTrackingReducer } from "./slices/changes/changes-slice";
import { agentLockReducer } from "./slices/agent-lock/agent-lock-slice";
import { panelLayoutReducer } from "./slices/panel-layout/panel-layout-slice";
import { streamingConfigReducer } from "./slices/streaming-config/streaming-config-slice";
import { unreadTrackingReducer } from "./slices/unread-tracking/unread-tracking-slice";
import { prStatusReducer } from "./slices/pr-status/pr-status-slice";
import { backgroundAgentExecutorReducer } from "./slices/background-agent-executor/background-agent-executor-slice";
import { chatStateReducer } from "./slices/chat-state/chat-state-slice";
import { chatChangesReducer } from "./slices/chat-changes/chat-changes-slice";
import { fileExplorerReducer } from "./slices/file-explorer/file-explorer-slice";
import { filesReducer } from "./slices/files/files-slice";
import { agentSessionReducer } from "./slices/agent-session/agent-session-slice";
import { agentQueueReducer } from "./slices/agent-queue/agent-queue-slice";
import { agentSubscriptionUIReducer } from "./slices/agent-subscription-ui/agent-subscription-ui-slice";
import { onboardingReducer } from "./slices/onboarding/onboarding-slice";
import { agentAvailabilityReducer } from "./slices/agent-availability/agent-availability-slice";
import { appLayoutReducer } from "./slices/app-layout/app-layout-slice";
import { sessionStatsReducer } from "./slices/session-stats/session-stats-slice";
import { tokenUsageReducer } from "./slices/token-usage/token-usage-slice";
import { workspaceInitializerReducer } from "./slices/workspace-initializer/workspace-initializer-slice";
import { themeReducer } from "./slices/theme/theme-slice";
import { websocketApiReducer } from "./slices/websocket-api/websocket-api-slice";
import { uiHighlightReducer } from "./slices/ui-highlight/ui-highlight-slice";
import { settingsProposalHistoryReducer } from "./slices/settings-proposal-history/settings-proposal-history-slice";
import { specialistProposalHistoryReducer } from "./slices/specialist-proposal-history/specialist-proposal-history-slice";
import { proposalLifecycleReducer } from "./slices/proposal-lifecycle/proposal-lifecycle-slice";
import { prBranchLookupReducer } from "./slices/pr-branch-lookup/pr-branch-lookup-slice";

export const reducers = {
  providerSettings: providerSettingsReducer,
  backgroundAgentSettings: backgroundAgentSettingsReducer,
  externalEditors: externalEditorsReducer,
  uiLayout: uiLayoutReducer,
  shortcutsCheatSheet: shortcutsCheatSheetReducer,
  tabState: tabStateReducer,
  terminals: terminalsReducer,
  noteReadTracking: noteReadTrackingReducer,
  multiPanelContext: multiPanelContextReducer,
  permission: permissionReducer,
  featureCodes: featureCodesReducer,
  globalModals: globalModalsReducer,
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
  workspaceTasks: workspaceTasksReducer,
  workspaceSummaries: workspaceSummariesReducer,
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
  mcpSettings: mcpSettingsReducer,
  comments: commentsReducer,
  taskAgentAssociations: taskAgentAssociationsReducer,

  autoUpdate: autoUpdateReducer,
  sidebarNav: sidebarNavReducer,
  scripts: scriptsReducer,
  agentFollow: agentFollowReducer,
  git: gitReducer,
  changes: fileTrackingReducer,
  agentLock: agentLockReducer,
  panelLayout: panelLayoutReducer,
  streamingConfig: streamingConfigReducer,
  unreadTracking: unreadTrackingReducer,
  prStatus: prStatusReducer,
  bgExecutor: backgroundAgentExecutorReducer,
  chatState: chatStateReducer,
  chatChanges: chatChangesReducer,
  fileExplorer: fileExplorerReducer,
  files: filesReducer,
  agentSessions: agentSessionReducer,
  agentQueue: agentQueueReducer,
  agentSubscriptionUI: agentSubscriptionUIReducer,
  onboarding: onboardingReducer,
  workspaceInitializer: workspaceInitializerReducer,
  agentAvailability: agentAvailabilityReducer,
  appLayout: appLayoutReducer,
  sessionStats: sessionStatsReducer,
  tokenUsage: tokenUsageReducer,
  theme: themeReducer,
  websocketApi: websocketApiReducer,
  uiHighlight: uiHighlightReducer,
  settingsProposalHistory: settingsProposalHistoryReducer,
  specialistProposalHistory: specialistProposalHistoryReducer,
  proposalLifecycle: proposalLifecycleReducer,
  prBranchLookup: prBranchLookupReducer,
} as const;
