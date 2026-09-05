/**
 * Root app saga registry.
 *
 * Themis starts its package-owned saga manager during Store.init(). App-owned
 * sagas are deliberately registered separately and started explicitly after
 * initialization so their lifetime belongs to the renderer root.
 */

import type { Store } from '@augmentcode/themis/svelte-store';
import { all, call } from 'typed-redux-saga';

import { backgroundExecutorSaga } from '../../features/agent/background-executor-service';
import { providerAvailabilitySaga } from './slices/agent-availability/sagas/provider-availability-saga';
import { agentEventsIpcSaga } from './slices/agent-events/sagas/agent-events-ipc-saga';
import { agentFailureToastSaga } from './slices/agent-session/sagas/agent-failure-toast-saga';
import { agentMutationSaga } from './slices/agent-session/sagas/agent-mutation-saga';
import { agentStreamSaga } from './slices/agent-session/sagas/agent-stream-saga';
import { editRegenerateSaga } from './slices/agent-session/sagas/edit-regenerate-saga';
import { agentSubscriptionReadSaga } from './slices/agent-subscription-ui/sagas/agent-subscription-read-saga';
import { appLayoutNavigationSaga } from './slices/app-layout/sagas/app-layout-navigation-saga';
import { browserIpcSaga } from './slices/app-layout/sagas/browser-ipc-saga';
import { menuIpcSaga } from './slices/app-layout/sagas/menu-ipc-saga';
import { autoUpdateSaga } from './slices/auto-update/sagas/auto-update-saga';
import { backgroundAgentSettingsSaga } from './slices/background-agent-settings/sagas/background-agent-settings-saga';
import { backgroundHooksSaga } from './slices/background-hooks/sagas/background-hooks-saga';
import { browserPersistenceSaga } from './slices/browser/sagas/browser-persistence-saga';
import { chatReadSaga } from './slices/chat-state/sagas/chat-read-saga';
import { chatScrollbackSaga } from './slices/chat-state/sagas/chat-scrollback-saga';
import { chatSendSaga } from './slices/chat-state/sagas/chat-send-saga';
import { chatSubscribeSaga } from './slices/chat-state/sagas/chat-subscribe-saga';
import { switchTimingSaga } from './slices/chat-state/sagas/switch-timing-saga';
import { connectionsSaga } from './slices/connections/sagas/connections-saga';
import { contextSaga } from './slices/context/sagas/context-saga';
import { daemonHealthSaga } from './slices/daemon-health/sagas/daemon-health-saga';
import { directoryPickerSaga } from './slices/directory-picker/sagas/directory-picker-saga';
import { externalEditorsPersistenceSaga } from './slices/external-editors/sagas/external-editors-persistence-saga';
import { fileExplorerSaga } from './slices/file-explorer/sagas/file-explorer-saga';
import { fileContentPruneSaga } from './slices/file-prune/sagas/file-content-prune-saga';
import { filesReadSaga } from './slices/files/sagas/files-read-saga';
import { filesWriteSaga } from './slices/files/sagas/files-write-saga';
import { gitEventsIpcSaga } from './slices/git-events/sagas/git-events-ipc-saga';
import { gitReadSaga } from './slices/git/sagas/git-read-saga';
import { gitRootsSaga } from './slices/git-roots/sagas/git-roots-saga';
import { githubAuthSaga } from './slices/github-auth/sagas/github-auth-saga';
import { githubRepoSearchSaga } from './slices/github-repo-search/sagas/github-repo-search-saga';
import { actionKeySaga } from './slices/hardware-console/sagas/action-key-saga';
import { hardwareConsoleDeviceSaga } from './slices/hardware-console/sagas/hardware-console-device-saga';
import { keyPinPersistenceSaga } from './slices/hardware-console/sagas/key-pin-persistence-saga';
import { promptPickerSaga } from './slices/hardware-console/sagas/prompt-picker-saga';
import { voiceTranscriptionSaga } from './slices/hardware-console/sagas/voice-transcription-saga';
import { hostRequirementsSaga } from './slices/host-requirements/sagas/host-requirements-saga';
import { legacyImportSaga } from './slices/legacy-import/sagas/legacy-import-saga';
import { linearAuthSaga } from './slices/linear-auth/sagas/linear-auth-saga';
import { mcpSettingsSaga } from './slices/mcp-settings/sagas/mcp-settings-saga';
import { modelBootSaga } from './slices/model/sagas/model-boot-saga';
import { modelReloadSaga } from './slices/model/sagas/model-reload-saga';
import { modelSelectionSaga } from './slices/model/sagas/model-selection-saga';
import { noteReadTrackingSaga } from './slices/note-read-tracking/sagas/note-read-tracking-saga';
import {
  notificationIpcSaga,
  webNotificationSaga,
} from './slices/notifications/sagas/notifications-saga';
import { panelLayoutSaga } from './slices/panel-layout/sagas/panel-layout-saga';
import { permissionResponseSaga } from './slices/permission/sagas/permission-response-saga';
import { proposalLifecycleSaga } from './slices/proposal-lifecycle/sagas/proposal-lifecycle-saga';
import { providerSettingsSaga } from './slices/provider-settings/sagas/provider-settings-saga';
import { antigravitySetupSaga } from './slices/antigravity-setup/sagas/antigravity-setup-saga';
import { prMonitorSaga } from './slices/pr-monitor/sagas/pr-monitor-saga';
import { releaseNotesSaga } from './slices/release-notes/sagas/release-notes-saga';
import { sentryAuthSaga } from './slices/sentry-auth/sagas/sentry-auth-saga';
import { scriptsOperationSaga } from './slices/scripts/sagas/scripts-operation-saga';
import { settingsHydrationSaga } from './slices/settings-events/sagas/settings-hydration-saga';
import { settingsProposalHistorySaga } from './slices/settings-proposal-history/sagas/settings-proposal-history-saga';
import { setupPromptSaga } from './slices/setup-prompt/sagas/setup-prompt-saga';
import { sidebarNavSaga } from './slices/sidebar-nav/sagas/sidebar-nav-saga';
import { specialistProposalHistorySaga } from './slices/specialist-proposal-history/sagas/specialist-proposal-history-saga';
import { specialistsSaga } from './slices/specialists/sagas/specialists-saga';
import { statsReadSaga } from './slices/stats/sagas/stats-read-saga';
import { tabStateSaga } from './slices/tab-state/sagas/tab-state-saga';
import { workspaceTabReconciliationSaga } from './slices/tab-state/sagas/workspace-tab-reconciliation-saga';
import { workspaceTabCleanupSaga } from './slices/workspace-lifecycle/sagas/workspace-tab-cleanup-saga';
import { workspaceLoadSaga } from './slices/workspace-lifecycle/sagas/workspace-load-saga';
import { workspaceReconnectSaga } from './slices/workspace-lifecycle/sagas/workspace-reconnect-saga';
import { taskAgentAssociationsSaga } from './slices/task-agent-associations/sagas/task-agent-associations-saga';
import { terminalPersistenceSaga } from './slices/terminals/sagas/terminal-persistence-saga';
import { themeSaga } from './slices/theme/sagas/theme-saga';
import { uiLayoutPersistenceSaga } from './slices/ui-layout/sagas/ui-layout-persistence-saga';
import { unreadTrackingSaga } from './slices/unread-tracking/sagas/unread-tracking-saga';
import { updateChannelSaga } from './slices/user-preferences/sagas/update-channel-saga';
import { notificationSettingsSaga } from './slices/user-preferences/sagas/notification-settings-saga';
import { userPreferencesPersistenceSaga } from './slices/user-preferences/sagas/user-preferences-persistence-saga';
import { zoomIpcSaga } from './slices/user-preferences/sagas/zoom-ipc-saga';
import { voiceSettingsSaga } from './slices/voice-settings/sagas/voice-settings-saga';
import { activeStreamsSaga } from './slices/workspace-agents/sagas/active-streams-saga';
import { agentCreationSaga } from './slices/workspace-agents/sagas/agent-creation-saga';
import { agentReadSaga } from './slices/workspace-agents/sagas/agent-read-saga';
import { daemonEventsSaga } from './slices/workspace-events/sagas/daemon-events-saga';
import { workspaceCreationSettingsSaga } from './slices/workspace-creation-settings/sagas/workspace-creation-settings-saga';
import { lifecycleIpcReadSaga } from './slices/workspace-lifecycle/sagas/lifecycle-ipc-read-saga';
import { lifecycleReadSaga } from './slices/workspace-lifecycle/sagas/lifecycle-read-saga';
import { workspaceNavigationLayoutSaga } from './slices/workspace-navigation/sagas/workspace-navigation-layout-saga';
import { workspaceNavigationTabSaga } from './slices/workspace-navigation/sagas/workspace-navigation-tab-saga';
import { workspaceNotesSaga } from './slices/workspace-notes/sagas/workspace-notes-saga';
import { workspaceOperationsSaga } from './slices/workspace-operations/sagas/workspace-operations-saga';
import { workspaceSettingsSaga } from './slices/workspace-settings/sagas/workspace-settings-saga';
import { workspaceTransferSaga } from './slices/workspace-transfer/sagas/workspace-transfer-saga';
import { workspaceImportSaga } from './slices/workspace-import/sagas/workspace-import-saga';

export type AppSaga = Parameters<Store<any, any>['runSaga']>[0];
export type AppSagaCancel = ReturnType<Store<any, any>['runSaga']>;

/** Owns all hardware-console listeners and side effects under one root lifetime. */
export function* hardwareConsoleSaga() {
  yield* all([
    call(hardwareConsoleDeviceSaga),
    call(actionKeySaga),
    call(keyPinPersistenceSaga),
    call(promptPickerSaga),
    call(voiceTranscriptionSaga),
  ]);
}

/** App-owned sagas in audited startup order. Each production owner appears once. */
export const sagas = [
  daemonEventsSaga,
  daemonHealthSaga,
  connectionsSaga,
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
  editRegenerateSaga,
  agentFailureToastSaga,
  gitReadSaga,
  fileExplorerSaga,
  filesReadSaga,
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
  hostRequirementsSaga,
  backgroundHooksSaga,
  hardwareConsoleSaga,
  voiceSettingsSaga,
  themeSaga,
  autoUpdateSaga,
  specialistsSaga,
  proposalLifecycleSaga,
  settingsProposalHistorySaga,
  specialistProposalHistorySaga,
  githubAuthSaga,
  githubRepoSearchSaga,
  sentryAuthSaga,
  linearAuthSaga,
  mcpSettingsSaga,
  directoryPickerSaga,
  legacyImportSaga,
  statsReadSaga,
  prMonitorSaga,
  gitRootsSaga,
  uiLayoutPersistenceSaga,
  tabStateSaga,
  workspaceTabReconciliationSaga,
  workspaceTabCleanupSaga,
  sidebarNavSaga,
  panelLayoutSaga,
  unreadTrackingSaga,
  releaseNotesSaga,
  browserPersistenceSaga,
  fileContentPruneSaga,
  terminalPersistenceSaga,
  externalEditorsPersistenceSaga,
  workspaceSettingsSaga,
  updateChannelSaga,
  notificationSettingsSaga,
  userPreferencesPersistenceSaga,
  workspaceCreationSettingsSaga,
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
