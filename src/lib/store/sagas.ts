/**
 * Root sagas registry.
 * Each saga is registered here and managed by the saga manager.
 * Sagas are started/stopped via initStore() or the RunSaga component.
 */

import { providerSettingsSaga } from "./slices/provider-settings/sagas/provider-settings-saga";
import { backgroundAgentSettingsSaga } from "./slices/background-agent-settings/sagas/background-agent-settings-saga";
import { externalEditorsSaga } from "./slices/external-editors/sagas/external-editors-saga";
import { tabStateSaga } from "./slices/tab-state/sagas/tab-state-saga";
import { terminalsSaga } from "./slices/terminals/sagas/terminals-saga";
import { userPreferencesSaga } from "./slices/user-preferences/sagas/user-preferences-saga";
import { workspaceSettingsSaga } from "./slices/workspace-settings/sagas/workspace-settings-saga";
import { noteReadTrackingSaga } from "./slices/note-read-tracking/sagas/note-read-tracking-saga";
import { permissionSaga } from "./slices/permission/sagas/permission-saga";
import { pipSaga } from "./slices/pip/sagas/pip-saga";
import { featureCodesSaga } from "./slices/feature-codes/sagas/feature-codes-saga";
import { gitOperationsSaga } from "./slices/git/sagas/git-operations-saga";
import { knownReposSaga } from "./slices/known-repos/sagas/known-repos-saga";
import { deepLinksSaga } from "./slices/deep-links/sagas/deep-links-saga";
import { modelSaga } from "./slices/model/sagas/model-saga";
import { specialistsSaga } from "./slices/specialists/sagas/specialists-saga";
import { systemStatusSaga } from "./slices/system-status/sagas/system-status-saga";
import { uiLayoutSaga } from "./slices/ui-layout/sagas/ui-layout-saga";
import { themeSaga } from "./slices/theme/sagas/theme-saga";
import { uiSaga } from "./slices/ui-notifications/sagas/ui-notifications-saga";
import { workspaceOperationsSaga } from "./slices/workspace-operations/sagas/workspace-operations-saga";
import { workspaceSaga } from "./slices/workspace/sagas/workspace-saga";
import { workspaceAgentsSaga } from "./slices/workspace-agents/sagas/workspace-agents-saga";
import { workspaceNotesSaga } from "./slices/workspace-notes/sagas/workspace-notes-saga";
import { workspaceEventsSaga as workspaceEventsRendererSaga } from "./slices/workspace-events/sagas/workspace-events-saga";
import { paletteSaga } from "./slices/palette/sagas/palette-saga";
import { authSaga } from "./slices/auth/sagas/auth-saga";
import { autoUpdateSaga } from "./slices/auto-update/sagas/auto-update-saga";
import { appLayoutSaga } from "./slices/app-layout/sagas/app-layout-saga";
import { workspaceNavigationSaga } from "./slices/workspace-navigation/sagas/workspace-navigation-saga";
import { workspaceSwitcherSaga } from "./slices/workspace-switcher/sagas/workspace-switcher-saga";
import { releaseNotesSaga } from "./slices/release-notes/sagas/release-notes-saga";
import { transientUiSaga } from "./slices/transient-ui/sagas/transient-ui-saga";
import { acceptChangesStatusSaga } from "./slices/transient-ui/sagas/accept-changes-status-saga";
import { executorResultSaga } from "./slices/transient-ui/sagas/executor-result-saga";
import { skillsSaga } from "./slices/skills/sagas/skills-saga";
import { linearAuthSaga } from "./slices/linear-auth/sagas/linear-auth-saga";
import { githubAuthSaga } from "./slices/github-auth/sagas/github-auth-saga";
import { githubReposSaga } from "./slices/github-repos/sagas/github-repos-saga";
import { githubRepoSearchSaga } from "./slices/github-repo-search/sagas/github-repo-search-saga";
import { clonePreflightSaga } from "./slices/clone-preflight/sagas/clone-preflight-saga";
import { sentryAuthSaga } from "./slices/sentry-auth/sagas/sentry-auth-saga";
import { contextSaga } from "./slices/context/sagas/context-saga";
import { browserSaga } from "./slices/browser/sagas/browser-saga";
import { setupScriptsSaga } from "./slices/setup-scripts/sagas/setup-scripts-saga";
import { mcpServersSaga } from "./slices/mcp-servers/sagas/mcp-servers-saga";
import { mcpSettingsSaga } from "./slices/mcp-settings/sagas/mcp-settings-saga";
import { commentsSaga } from "./slices/comments/sagas/comments-saga";
import { workspaceInitializerSaga } from "./slices/workspace-initializer/sagas/workspace-initializer-saga";
import { taskAgentAssociationsSaga } from "./slices/task-agent-associations/sagas/task-agent-associations-saga";

import { sidebarNavSaga } from "./slices/sidebar-nav/sagas/sidebar-nav-saga";
import { scriptsSaga } from "./slices/scripts/sagas/scripts-saga";
import { agentFollowSaga } from "./slices/agent-follow/sagas/agent-follow-saga";
import { gitSaga as gitStatusSaga } from "./slices/git/sagas/git-saga";
import { agentOverviewSaga } from "./slices/agent-overview/sagas/agent-overview-saga";
import { changesSaga } from "./slices/changes/sagas/changes-saga";
import { agentLockSaga } from "./slices/agent-lock/sagas/agent-lock-saga";
import { panelLayoutSaga } from "./slices/panel-layout/sagas/panel-layout-saga";
import { streamingConfigSaga } from "./slices/streaming-config/sagas/streaming-config-saga";
import { unreadTrackingSaga } from "./slices/unread-tracking/sagas/unread-tracking-saga";
import { prStatusSaga } from "./slices/pr-status/sagas/pr-status-saga";
import { backgroundAgentExecutorSaga } from "./slices/background-agent-executor/sagas/background-agent-executor-saga";
import { chatChangesSaga } from "./slices/chat-changes/sagas/chat-changes-saga";
import { chatStateSaga } from "./slices/chat-state/sagas/chat-state-saga";
import { chatStreamSaga } from "./slices/chat-state/sagas/chat-stream-saga";
import { fileExplorerSaga } from "./slices/file-explorer/sagas/file-explorer-saga";
import { filesSaga } from "./slices/files/sagas/files-saga";
import { agentIpcSaga } from "./slices/workspace-agents/sagas/agent-ipc-saga";
import { agentStreamSaga } from "./slices/workspace-agents/sagas/agent-stream-saga";
import { agentSubscriptionUISaga } from "./slices/agent-subscription-ui/sagas/agent-subscription-ui-saga";
import { agentAvailabilitySaga } from "./slices/agent-availability/sagas/agent-availability-saga";
import { sessionStatsSaga } from "./slices/session-stats/sagas/session-stats-saga";

/**
 * All registered sagas.
 * Add new sagas here as slices are migrated.
 *
 * All sagas are started synchronously by initStore() during store initialization.
 */
export const sagas = {
  providerSettingsSaga,
  backgroundAgentSettingsSaga,
  externalEditorsSaga,
  uiLayoutSaga,
  themeSaga,
  tabStateSaga,
  terminalsSaga,
  noteReadTrackingSaga,
  permissionSaga,
  featureCodesSaga,
  knownReposSaga,
  deepLinksSaga,
  modelSaga,
  specialistsSaga,
  systemStatusSaga,
  pipSaga,
  userPreferencesSaga,
  workspaceOperationsSaga,
  workspaceSettingsSaga,
  streamingSaga: streamingConfigSaga,
  workspaceSaga,
  gitSaga: gitOperationsSaga,
  changesSaga,
  notesSaga: workspaceNotesSaga,
  workspaceEventsSaga: workspaceEventsRendererSaga,
  paletteSaga,
  agentsSaga: workspaceAgentsSaga,
  contextSaga,
  browserSaga,
  mcpSaga: mcpServersSaga,
  authSaga,
  uiSaga,
  layoutSaga: appLayoutSaga,
  autoUpdateSaga,
  workspaceNavigationSaga,
  workspaceSwitcherSaga,
  releaseNotesSaga,
  transientUiSaga,
  acceptChangesStatusSaga,
  executorResultSaga,
  skillsSaga,
  githubAuthSaga,
  githubReposSaga,
  githubRepoSearchSaga,
  clonePreflightSaga,
  linearAuthSaga,
  sentryAuthSaga,
  setupScriptsSaga,
  mcpSettingsSaga,
  commentsSaga,
  taskAgentAssociationsSaga,
  workspaceInitializerSaga,

  sidebarNavSaga,
  scriptsSaga,
  agentFollowSaga,
  gitStatusSaga,
  agentOverviewSaga,
  agentLockSaga,
  panelLayoutSaga,
  unreadTrackingSaga,
  prStatusSaga,
  bgExecutorSaga: backgroundAgentExecutorSaga,
  chatChangesSaga,
  chatStateSaga,
  chatStreamSaga,
  fileExplorerSaga,
  filesSaga,
  agentIpcSaga,
  agentStreamSaga,
  agentSubscriptionUISaga,
  agentAvailabilitySaga,
  sessionStatsSaga,
} as const;

// SagaName is defined in ./types.ts as an explicit string literal union to
// avoid a transitive import chain that pulls renderer-only modules into the
// main-process typecheck.  Re-export it here for backward compatibility.
export type { SagaName } from './types';

// Compile-time assertion: ensure the keys of `sagas` match `SagaName` exactly.
// If a saga is added/removed from the object above without updating the
// SagaName union in types.ts, one of these lines will produce a type error.
import type { SagaName as _SagaName } from './types';
type _AssertSagasExtendsName = Record<_SagaName, unknown> extends Record<keyof typeof sagas, unknown> ? true : never;
type _AssertNameExtendsSagas = Record<keyof typeof sagas, unknown> extends Record<_SagaName, unknown> ? true : never;
 
const _assertSync: _AssertSagasExtendsName & _AssertNameExtendsSagas = true;

/** All registered saga names, for use by initStore to start all sagas synchronously. */
export const sagaNames = Object.keys(sagas) as _SagaName[];

