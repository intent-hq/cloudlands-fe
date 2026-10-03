import { invitationAccountSearchSaga } from './slices/invitation-account-search/sagas/invitation-account-search-saga';
import { personalDevicesSaga } from '$features/devices/personal-devices-saga';
import { hostMembershipSaga } from './slices/host-membership/sagas/host-membership-saga';
import { hostOwnerServicesSaga } from './slices/principal/sagas/host-owner-services-saga';
import { hostExecutionSaga } from './slices/host-execution/sagas/host-execution-saga';
/**
 * Root app saga registry.
 *
 * Themis starts its package-owned saga manager during Store.init(). App-owned
 * sagas are deliberately registered separately and started explicitly after
 * initialization so their lifetime belongs to the renderer root.
 */

import type { Store } from '@themislib/themis/svelte-store';

import { backgroundExecutorSaga } from '../../features/agent/background-executor-service';
import { providerAvailabilitySaga } from './slices/agent-availability/sagas/provider-availability-saga';
import { agentEventsIpcSaga } from './slices/agent-events/sagas/agent-events-ipc-saga';
import { agentFailureToastSaga } from './slices/agent-session/sagas/agent-failure-toast-saga';
import { agentMutationSaga } from './slices/agent-session/sagas/agent-mutation-saga';
import { agentModelSaga } from './slices/agent-model/sagas/agent-model-saga';
import { agentStreamSaga } from './slices/agent-session/sagas/agent-stream-saga';
import { editRegenerateSaga } from './slices/agent-session/sagas/edit-regenerate-saga';
import { regenerateFromMessageSaga } from './slices/agent-session/sagas/regenerate-from-message-saga';
import { agentSubscriptionReadSaga } from './slices/agent-subscription-ui/sagas/agent-subscription-read-saga';
import { appLayoutNavigationSaga } from './slices/app-layout/sagas/app-layout-navigation-saga';
import { browserIpcSaga } from './slices/app-layout/sagas/browser-ipc-saga';
import { menuIpcSaga } from './slices/app-layout/sagas/menu-ipc-saga';
import { autoUpdateSaga } from './slices/auto-update/sagas/auto-update-saga';
import { backgroundAgentSettingsSaga } from './slices/background-agent-settings/sagas/background-agent-settings-saga';
import { backgroundHooksSaga } from './slices/background-hooks/sagas/background-hooks-saga';
import { browserPersistenceSaga } from './slices/browser/sagas/browser-persistence-saga';
import { browserClientsSaga } from './slices/browser-clients/sagas/browser-clients-saga';
import { chatReadSaga } from './slices/chat-state/sagas/chat-read-saga';
import { chatScrollbackSaga } from './slices/chat-state/sagas/chat-scrollback-saga';
import { chatSendSaga } from './slices/chat-state/sagas/chat-send-saga';
import { chatSubscribeSaga } from './slices/chat-state/sagas/chat-subscribe-saga';
import { switchTimingSaga } from './slices/chat-state/sagas/switch-timing-saga';
import { connectionsSaga } from './slices/connections/sagas/connections-saga';
import { guestSessionsSaga } from './slices/guest-sessions/sagas/guest-sessions-saga';
import { principalSaga } from './slices/principal/sagas/principal-saga';
import { presenceSaga } from './slices/presence/sagas/presence-saga';
import { contextSaga } from './slices/context/sagas/context-saga';
import { daemonHealthSaga } from './slices/daemon-health/sagas/daemon-health-saga';
import { directoryPickerSaga } from './slices/directory-picker/sagas/directory-picker-saga';
import { externalEditorsPersistenceSaga } from './slices/external-editors/sagas/external-editors-persistence-saga';
import { fileExplorerSaga } from './slices/file-explorer/sagas/file-explorer-saga';
import { fileContentPruneSaga } from './slices/file-prune/sagas/file-content-prune-saga';
import { pdfPreviewSaga } from './slices/pdf-preview/sagas/pdf-preview-saga';
import { filesReadSaga } from './slices/files/sagas/files-read-saga';
import { filesWriteSaga } from './slices/files/sagas/files-write-saga';
import { gitEventsIpcSaga } from './slices/git-events/sagas/git-events-ipc-saga';
import { gitReadSaga } from './slices/git/sagas/git-read-saga';
import { gitWriteSaga } from './slices/git/sagas/git-write-saga';
import { acceptWorkflowSaga } from './slices/accept-workflow/sagas/accept-workflow-saga';
import { acceptWorkflowObserverSaga } from './slices/accept-workflow/sagas/accept-workflow-observer-saga';
import { prWorkflowSaga } from './slices/pr-workflow/sagas/pr-workflow-saga';
import { chatChangesSaga } from './slices/chat-changes/sagas/chat-changes-saga';
import { acceptChangesStatusSaga } from './slices/git/sagas/accept-changes-status-saga';
import { gitRootsSaga } from './slices/git-roots/sagas/git-roots-saga';
import { githubRepoSearchSaga } from './slices/github-repo-search/sagas/github-repo-search-saga';
import { githubUserSearchSaga } from './slices/github-user-search/sagas/github-user-search-saga';
import { legacyImportSaga } from './slices/legacy-import/sagas/legacy-import-saga';
import { linearAuthSaga } from './slices/linear-auth/sagas/linear-auth-saga';
import { collaborationAuthSaga } from '$features/collaboration-auth/renderer/collaboration-auth-saga';
import { identitySaga } from './slices/identity/sagas/identity-saga';
import { mcpSettingsSaga } from './slices/mcp-settings/sagas/mcp-settings-saga';
import { modelBootSaga } from './slices/model/sagas/model-boot-saga';
import { modelReloadSaga } from './slices/model/sagas/model-reload-saga';
import { modelSelectionSaga } from './slices/model/sagas/model-selection-saga';
import { noteReadTrackingSaga } from './slices/note-read-tracking/sagas/note-read-tracking-saga';
import {
  notificationIpcSaga,
  webNotificationSaga,
} from './slices/notifications/sagas/notifications-saga';
import { browserTabRegistrySaga } from './slices/panel-layout/sagas/browser-tab-registry-saga';
import { panelLayoutSaga } from './slices/panel-layout/sagas/panel-layout-saga';
import { permissionResponseSaga } from './slices/permission/sagas/permission-response-saga';
import { powerSaga } from './slices/power/sagas/power-saga';
import { proposalLifecycleSaga } from './slices/proposal-lifecycle/sagas/proposal-lifecycle-saga';
import { providerSettingsSaga } from './slices/provider-settings/sagas/provider-settings-saga';
import { antigravitySetupSaga } from './slices/antigravity-setup/sagas/antigravity-setup-saga';
import { scriptMonitorSaga } from './slices/script-monitor/sagas/script-monitor-saga';
import { prMonitorSaga } from './slices/pr-monitor/sagas/pr-monitor-saga';
import { releaseNotesSaga } from './slices/release-notes/sagas/release-notes-saga';
import { sentryAuthSaga } from './slices/sentry-auth/sagas/sentry-auth-saga';
import { scriptsOperationSaga } from './slices/scripts/sagas/scripts-operation-saga';
import { settingsHydrationSaga } from './slices/settings-events/sagas/settings-hydration-saga';
import { settingsProposalHistorySaga } from './slices/settings-proposal-history/sagas/settings-proposal-history-saga';
import { setupPromptSaga } from './slices/setup-prompt/sagas/setup-prompt-saga';
import { sidebarNavSaga } from './slices/sidebar-nav/sagas/sidebar-nav-saga';
import { specialistProposalHistorySaga } from './slices/specialist-proposal-history/sagas/specialist-proposal-history-saga';
import { workspaceCatalogSaga } from './slices/provider-catalog/workspace-catalog-saga';
import { specialistsSaga } from './slices/specialists/sagas/specialists-saga';
import { statsReadSaga } from './slices/stats/sagas/stats-read-saga';
import { tabStateSaga } from './slices/tab-state/sagas/tab-state-saga';
import { workspaceTabReconciliationSaga } from './slices/tab-state/sagas/workspace-tab-reconciliation-saga';
import { workspaceTabCleanupSaga } from './slices/workspace-lifecycle/sagas/workspace-tab-cleanup-saga';
import { workspaceLoadSaga } from './slices/workspace-lifecycle/sagas/workspace-load-saga';
import { workspaceReconnectSaga } from './slices/workspace-lifecycle/sagas/workspace-reconnect-saga';
import { taskAgentAssociationsSaga } from './slices/task-agent-associations/sagas/task-agent-associations-saga';
import { terminalCommandsSaga } from './slices/terminals/sagas/terminal-commands-saga';
import { terminalCreationSaga } from './slices/terminals/sagas/terminal-creation-saga';
import { terminalPersistenceSaga } from './slices/terminals/sagas/terminal-persistence-saga';
import { themeSaga } from './slices/theme/sagas/theme-saga';
import { uiLayoutPersistenceSaga } from './slices/ui-layout/sagas/ui-layout-persistence-saga';
import { unreadTrackingSaga } from './slices/unread-tracking/sagas/unread-tracking-saga';
import { updateChannelSaga } from './slices/user-preferences/sagas/update-channel-saga';
import { userPreferencesPersistenceSaga } from './slices/user-preferences/sagas/user-preferences-persistence-saga';
import { zoomIpcSaga } from './slices/user-preferences/sagas/zoom-ipc-saga';
import { activeStreamsSaga } from './slices/workspace-agents/sagas/active-streams-saga';
import { agentCreationSaga } from './slices/workspace-agents/sagas/agent-creation-saga';
import { agentReadSaga } from './slices/workspace-agents/sagas/agent-read-saga';
import { daemonEventsSaga } from './slices/workspace-events/sagas/daemon-events-saga';
import { workspaceInitializerSaga } from './slices/workspace-initializer/sagas/workspace-initializer-saga';
import { lifecycleIpcReadSaga } from './slices/workspace-lifecycle/sagas/lifecycle-ipc-read-saga';
import { lifecycleReadSaga } from './slices/workspace-lifecycle/sagas/lifecycle-read-saga';
import { workspaceNavigationLayoutSaga } from './slices/workspace-navigation/sagas/workspace-navigation-layout-saga';
import { workspaceNavigationTabSaga } from './slices/workspace-navigation/sagas/workspace-navigation-tab-saga';
import { workspaceNotesSaga } from './slices/workspace-notes/sagas/workspace-notes-saga';
import { workspaceOperationsSaga } from './slices/workspace-operations/sagas/workspace-operations-saga';
import { workspaceSettingsSaga } from './slices/workspace-settings/sagas/workspace-settings-saga';
import { workspaceTransferSaga } from './slices/workspace-transfer/sagas/workspace-transfer-saga';
import { workspaceShareSaga } from './slices/workspace-share/sagas/workspace-share-saga';
import { workspaceImportSaga } from './slices/workspace-import/sagas/workspace-import-saga';

export type AppSaga = Parameters<Store<any, any>['runSaga']>[0];
export type AppSagaCancel = ReturnType<Store<any, any>['runSaga']>;

/** App-owned sagas in audited startup order. Each production owner appears once. */
export const sagas = [
  daemonEventsSaga,
  daemonHealthSaga,
  connectionsSaga,
  guestSessionsSaga,
  presenceSaga,
  principalSaga,
  hostExecutionSaga,
  settingsHydrationSaga,
  activeStreamsSaga,
  agentReadSaga,
  agentSubscriptionReadSaga,
  chatReadSaga,
  chatSubscribeSaga,
  chatSendSaga,
  chatScrollbackSaga,
  switchTimingSaga,
  permissionResponseSaga,
  agentStreamSaga,
  agentCreationSaga,
  backgroundExecutorSaga,
  agentMutationSaga,
  agentModelSaga,
  editRegenerateSaga,
  regenerateFromMessageSaga,
  agentFailureToastSaga,
  gitReadSaga,
  gitWriteSaga,
  acceptWorkflowSaga,
  acceptWorkflowObserverSaga,
  prWorkflowSaga,
  chatChangesSaga,
  acceptChangesStatusSaga,
  fileExplorerSaga,
  filesReadSaga,
  pdfPreviewSaga,
  filesWriteSaga,
  workspaceNotesSaga,
  noteReadTrackingSaga,
  contextSaga,
  taskAgentAssociationsSaga,
  appLayoutNavigationSaga,
  workspaceNavigationTabSaga,
  workspaceNavigationLayoutSaga,
  workspaceOperationsSaga,
  workspaceTransferSaga,
  workspaceShareSaga,
  invitationAccountSearchSaga,
  hostMembershipSaga,
  workspaceImportSaga,
  scriptsOperationSaga,
  lifecycleReadSaga,
  lifecycleIpcReadSaga,
  workspaceLoadSaga,
  workspaceReconnectSaga,
  modelSelectionSaga,
  backgroundAgentSettingsSaga,
  providerSettingsSaga,
  antigravitySetupSaga,
  modelBootSaga,
  modelReloadSaga,
  providerAvailabilitySaga,
  setupPromptSaga,
  backgroundHooksSaga,
  hostOwnerServicesSaga,
  themeSaga,
  powerSaga,
  autoUpdateSaga,
  specialistsSaga,
  workspaceCatalogSaga,
  proposalLifecycleSaga,
  settingsProposalHistorySaga,
  specialistProposalHistorySaga,
  githubRepoSearchSaga,
  githubUserSearchSaga,
  sentryAuthSaga,
  linearAuthSaga,
  identitySaga,
  collaborationAuthSaga,
  mcpSettingsSaga,
  directoryPickerSaga,
  legacyImportSaga,
  statsReadSaga,
  prMonitorSaga,
  scriptMonitorSaga,
  gitRootsSaga,
  uiLayoutPersistenceSaga,
  tabStateSaga,
  workspaceTabReconciliationSaga,
  workspaceTabCleanupSaga,
  sidebarNavSaga,
  panelLayoutSaga,
  browserTabRegistrySaga,
  unreadTrackingSaga,
  releaseNotesSaga,
  browserPersistenceSaga,
  browserClientsSaga,
  personalDevicesSaga,
  fileContentPruneSaga,
  terminalCreationSaga,
  terminalPersistenceSaga,
  terminalCommandsSaga,
  externalEditorsPersistenceSaga,
  workspaceSettingsSaga,
  updateChannelSaga,
  userPreferencesPersistenceSaga,
  workspaceInitializerSaga,
  zoomIpcSaga,
  menuIpcSaga,
  browserIpcSaga,
  notificationIpcSaga,
  webNotificationSaga,
  agentEventsIpcSaga,
  gitEventsIpcSaga,
] as const satisfies readonly AppSaga[];

export function startAllAppSagas(store: Store<any, any>): AppSagaCancel[] {
  return sagas.map((saga) => store.runSaga(saga));
}
