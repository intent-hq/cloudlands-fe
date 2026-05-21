/**
 * Root app saga registry.
 * Each saga is listed in startup order and started/stopped via Store.runSaga.
 */

import type { Store } from "svelte-redux-toolkit/store";

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
import { panelContextSaga } from "./slices/workspace-navigation/sagas/panel-context-saga";
import {
  retroactiveNavigationMountCheckSaga,
  watchWorkspaceNavigationLifecycleSaga,
  watchWorkspaceNavigationPersistenceSaga,
} from "./slices/workspace-navigation/sagas/workspace-navigation-saga";
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
import { agentQueueSaga } from "./slices/agent-queue/sagas/agent-queue-saga";
import { agentIpcSaga } from "./slices/workspace-agents/sagas/agent-ipc-saga";
import { agentChatEffectsSaga } from "./slices/agent-session/sagas/agent-chat-effects-saga";
import { agentStreamSaga } from "./slices/agent-session/sagas/agent-stream-saga";
import { agentSubscriptionUISaga } from "./slices/agent-subscription-ui/sagas/agent-subscription-ui-saga";
import { agentAvailabilitySaga } from "./slices/agent-availability/sagas/agent-availability-saga";
import { sessionStatsSaga } from "./slices/session-stats/sagas/session-stats-saga";
import { sagaCrashSentrySaga } from "./slices/saga-crash-sentry/sagas/saga-crash-sentry-saga";
import type { SagaName } from "./types";

type AppSaga = Parameters<Store<any, any>["runSaga"]>[0];

type AppSagaRegistryEntry = {
  readonly name: SagaName;
  readonly saga: AppSaga;
};

/**
 * All app-owned sagas in startup order. Add new sagas here as slices are migrated.
 */
export const sagas = [
  { name: "providerSettingsSaga", saga: providerSettingsSaga },
  { name: "backgroundAgentSettingsSaga", saga: backgroundAgentSettingsSaga },
  { name: "externalEditorsSaga", saga: externalEditorsSaga },
  { name: "uiLayoutSaga", saga: uiLayoutSaga },
  { name: "themeSaga", saga: themeSaga },
  { name: "tabStateSaga", saga: tabStateSaga },
  { name: "terminalsSaga", saga: terminalsSaga },
  { name: "noteReadTrackingSaga", saga: noteReadTrackingSaga },
  { name: "permissionSaga", saga: permissionSaga },
  { name: "featureCodesSaga", saga: featureCodesSaga },
  { name: "knownReposSaga", saga: knownReposSaga },
  { name: "deepLinksSaga", saga: deepLinksSaga },
  { name: "modelSaga", saga: modelSaga },
  { name: "specialistsSaga", saga: specialistsSaga },
  { name: "systemStatusSaga", saga: systemStatusSaga },
  { name: "pipSaga", saga: pipSaga },
  { name: "userPreferencesSaga", saga: userPreferencesSaga },
  { name: "workspaceOperationsSaga", saga: workspaceOperationsSaga },
  { name: "workspaceSettingsSaga", saga: workspaceSettingsSaga },
  { name: "streamingSaga", saga: streamingConfigSaga },
  { name: "workspaceSaga", saga: workspaceSaga },
  { name: "gitSaga", saga: gitOperationsSaga },
  { name: "changesSaga", saga: changesSaga },
  { name: "notesSaga", saga: workspaceNotesSaga },
  { name: "workspaceEventsSaga", saga: workspaceEventsRendererSaga },
  { name: "paletteSaga", saga: paletteSaga },
  { name: "agentsSaga", saga: workspaceAgentsSaga },
  { name: "contextSaga", saga: contextSaga },
  { name: "browserSaga", saga: browserSaga },
  { name: "authSaga", saga: authSaga },
  { name: "uiSaga", saga: uiSaga },
  { name: "layoutSaga", saga: appLayoutSaga },
  { name: "autoUpdateSaga", saga: autoUpdateSaga },
  {
    name: "workspaceNavigationLifecycleSaga",
    saga: watchWorkspaceNavigationLifecycleSaga,
  },
  {
    name: "retroactiveNavigationMountCheckSaga",
    saga: retroactiveNavigationMountCheckSaga,
  },
  {
    name: "workspaceNavigationPersistenceSaga",
    saga: watchWorkspaceNavigationPersistenceSaga,
  },
  { name: "panelContextSaga", saga: panelContextSaga },
  { name: "workspaceSwitcherSaga", saga: workspaceSwitcherSaga },
  { name: "releaseNotesSaga", saga: releaseNotesSaga },
  { name: "transientUiSaga", saga: transientUiSaga },
  { name: "acceptChangesStatusSaga", saga: acceptChangesStatusSaga },
  { name: "executorResultSaga", saga: executorResultSaga },
  { name: "skillsSaga", saga: skillsSaga },
  { name: "githubAuthSaga", saga: githubAuthSaga },
  { name: "githubReposSaga", saga: githubReposSaga },
  { name: "githubRepoSearchSaga", saga: githubRepoSearchSaga },
  { name: "clonePreflightSaga", saga: clonePreflightSaga },
  { name: "linearAuthSaga", saga: linearAuthSaga },
  { name: "sentryAuthSaga", saga: sentryAuthSaga },
  { name: "setupScriptsSaga", saga: setupScriptsSaga },
  { name: "mcpSettingsSaga", saga: mcpSettingsSaga },
  { name: "commentsSaga", saga: commentsSaga },
  { name: "taskAgentAssociationsSaga", saga: taskAgentAssociationsSaga },
  { name: "workspaceInitializerSaga", saga: workspaceInitializerSaga },

  { name: "sidebarNavSaga", saga: sidebarNavSaga },
  { name: "scriptsSaga", saga: scriptsSaga },
  { name: "agentFollowSaga", saga: agentFollowSaga },
  { name: "gitStatusSaga", saga: gitStatusSaga },
  { name: "agentOverviewSaga", saga: agentOverviewSaga },
  { name: "agentLockSaga", saga: agentLockSaga },
  { name: "panelLayoutSaga", saga: panelLayoutSaga },
  { name: "unreadTrackingSaga", saga: unreadTrackingSaga },
  { name: "prStatusSaga", saga: prStatusSaga },
  { name: "bgExecutorSaga", saga: backgroundAgentExecutorSaga },
  { name: "chatChangesSaga", saga: chatChangesSaga },
  { name: "chatStateSaga", saga: chatStateSaga },
  { name: "chatStreamSaga", saga: chatStreamSaga },
  { name: "fileExplorerSaga", saga: fileExplorerSaga },
  { name: "filesSaga", saga: filesSaga },
  { name: "agentQueueSaga", saga: agentQueueSaga },
  { name: "agentIpcSaga", saga: agentIpcSaga },
  { name: "agentChatEffectsSaga", saga: agentChatEffectsSaga },
  { name: "agentStreamSaga", saga: agentStreamSaga },
  { name: "agentSubscriptionUISaga", saga: agentSubscriptionUISaga },
  { name: "agentAvailabilitySaga", saga: agentAvailabilitySaga },
  { name: "sessionStatsSaga", saga: sessionStatsSaga },
  { name: "sagaCrashSentrySaga", saga: sagaCrashSentrySaga },
] as const satisfies readonly AppSagaRegistryEntry[];

// SagaName is defined in ./types.ts as an explicit string literal union to
// avoid a transitive import chain that pulls renderer-only modules into the
// main-process typecheck.  Re-export it here for backward compatibility.
export type { SagaName } from "./types";

export type RegisteredSagaName = (typeof sagas)[number]["name"];

// Compile-time assertion: ensure registry names match `SagaName` exactly.
// If a saga is added/removed from the registry above without updating the
// SagaName union in types.ts, one of these lines will produce a type error.
type _AssertSagasExtendsName = Record<SagaName, unknown> extends Record<
  RegisteredSagaName,
  unknown
> ? true : never;
type _AssertNameExtendsSagas = Record<RegisteredSagaName, unknown> extends Record<
  SagaName,
  unknown
> ? true : never;

const _assertSync: _AssertSagasExtendsName & _AssertNameExtendsSagas = true;

/** All registered saga names, for use by initStore to start all sagas synchronously. */
export const sagaNames = sagas.map(({ name }) => name) as RegisteredSagaName[];

/** Compatibility alias for callers that distinguish declared names from registered names. */
export const registeredSagaNames: SagaName[] = sagaNames;

export function startAllAppSagas(
  store: Store<any, any>,
): Array<() => void> {
  return sagas.map(({ saga }) => store.runSaga(saga));
}
