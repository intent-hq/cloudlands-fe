import { hardwareConsoleSettingsHydrationStarted } from './slices/hardware-console/hardware-console-slice';
import { hardwareConsoleSaga } from './slices/principal/sagas/host-owner-services-saga';
import { publishWindowCyclePreferenceSaga } from './slices/hardware-console/sagas/shared-window-cycle-saga';
import { describe, expect, it, vi } from 'vitest';

import { actionKeySaga } from './slices/hardware-console/sagas/action-key-saga';
import { hardwareConsoleDeviceSaga } from './slices/hardware-console/sagas/hardware-console-device-saga';
import { encoderPreferenceSaga } from './slices/hardware-console/sagas/encoder-preference-saga';
import { keyPinPersistenceSaga } from './slices/hardware-console/sagas/key-pin-persistence-saga';
import { promptPickerSaga } from './slices/hardware-console/sagas/prompt-picker-saga';
import { voiceTranscriptionSaga } from './slices/hardware-console/sagas/voice-transcription-saga';
import { sagas, startAllAppSagas } from './sagas';

describe('renderer app saga registry', () => {
  function getAuditedSagaNames() {
    return [
      'modelNameCacheSaga',
      'pendingRetentionSaga',
      'daemonEventsSaga',
      'daemonHealthSaga',
      'connectionsSaga',
      'guestSessionsSaga',
      'presenceSaga',
      'presenceFollowSaga',
      'principalSaga',
      'hostExecutionSaga',
      'repositoryContextSaga',
      'repositoryCheckoutSaga',
      'settingsHydrationSaga',
      'activeStreamsSaga',
      'agentReadSaga',
      'agentSubscriptionReadSaga',
      'chatReadSaga',
      'chatSubscribeSaga',
      'chatSendSaga',
      'chatScrollbackSaga',
      'switchTimingSaga',
      'permissionResponseSaga',
      'agentStreamSaga',
      'agentCreationSaga',
      'backgroundExecutorSaga',
      'agentMutationSaga',
      'agentModelSaga',
      'editRegenerateSaga',
      'regenerateFromMessageSaga',
      'agentFailureToastSaga',
      'gitReadSaga',
      'gitWriteSaga',
      'acceptWorkflowSaga',
      'acceptWorkflowObserverSaga',
      'prWorkflowSaga',
      'chatChangesSaga',
      'acceptChangesStatusSaga',
      'fileExplorerSaga',
      'filesReadSaga',
      'pdfPreviewSaga',
      'filesWriteSaga',
      'workspaceNotesSaga',
      'noteReadTrackingSaga',
      'contextSaga',
      'taskAgentAssociationsSaga',
      'appLayoutNavigationSaga',
      'workspaceNavigationTabSaga',
      'workspaceNavigationLayoutSaga',
      'workspaceOperationsSaga',
      'workspaceTransferSaga',
      'workspaceShareSaga',
      'invitationAccountSearchSaga',
      'hostMembershipSaga',
      'hostUserPresenceSaga',
      'workspaceImportSaga',
      'scriptsOperationSaga',
      'lifecycleReadSaga',
      'lifecycleIpcReadSaga',
      'workspaceLoadSaga',
      'workspaceReconnectSaga',
      'modelSelectionSaga',
      'backgroundAgentSettingsSaga',
      'providerSettingsSaga',
      'antigravitySetupSaga',
      'modelBootSaga',
      'modelReloadSaga',
      'providerAvailabilitySaga',
      'providerAdapterPreparationSaga',
      'setupPromptSaga',
      'backgroundHooksSaga',
      'hostOwnerServicesSaga',
      'themeSaga',
      'powerSaga',
      'autoUpdateSaga',
      'specialistsSaga',
      'workspaceCatalogSaga',
      'proposalLifecycleSaga',
      'settingsProposalHistorySaga',
      'specialistProposalHistorySaga',
      'githubRepoSearchSaga',
      'githubUserSearchSaga',
      'sentryAuthSaga',
      'linearAuthSaga',
      'identitySaga',
      'collaborationAuthSaga',
      'mcpSettingsSaga',
      'directoryPickerSaga',
      'legacyImportSaga',
      'statsReadSaga',
      'prMonitorSaga',
      'scriptMonitorSaga',
      'gitRootsSaga',
      'uiLayoutPersistenceSaga',
      'tabStateSaga',
      'workspaceTabReconciliationSaga',
      'workspaceTabCleanupSaga',
      'sidebarNavSaga',
      'panelLayoutSaga',
      'browserTabRegistrySaga',
      'unreadTrackingSaga',
      'releaseNotesSaga',
      'browserPersistenceSaga',
      'browserClientsSaga',
      'personalDevicesSaga',
      'fileContentPruneSaga',
      'terminalCreationSaga',
      'terminalPersistenceSaga',
      'terminalCommandsSaga',
      'externalEditorsPersistenceSaga',
      'workspaceSettingsSaga',
      'updateChannelSaga',
      'userPreferencesPersistenceSaga',
      'workspaceInitializerSaga',
      'zoomIpcSaga',
      'menuIpcSaga',
      'browserIpcSaga',
      'notificationIpcSaga',
      'webNotificationSaga',
      'agentEventsIpcSaga',
      'gitEventsIpcSaga',
    ];
  }

  it('registers every audited root saga exactly once', () => {
    const auditedSagaNames = getAuditedSagaNames();
    const names = sagas.map((saga) => saga.name);

    expect(names).toEqual(auditedSagaNames);
    expect(new Set(sagas).size).toBe(auditedSagaNames.length);
  });

  it('returns one cancellation handler per registered saga', () => {
    const auditedSagaNames = getAuditedSagaNames();
    const cancel = vi.fn();
    const store = { runSaga: vi.fn((_saga: unknown) => cancel) };

    const handlers = startAllAppSagas(store as never);

    expect(store.runSaga).toHaveBeenCalledTimes(auditedSagaNames.length);
    expect(store.runSaga.mock.calls.map(([saga]) => saga)).toEqual(sagas);
    expect(handlers).toEqual(Array(auditedSagaNames.length).fill(cancel));
  });

  it('starts every hardware-console owner exactly once under one cancellable composition', () => {
    const iterator = hardwareConsoleSaga();
    expect(iterator.next().value).toMatchObject({
      type: 'PUT',
      payload: { action: hardwareConsoleSettingsHydrationStarted() },
    });
    const effect = iterator.next().value as {
      type: string;
      payload: Array<Generator>;
    };
    const childEffects = effect.payload.map(
      (child) =>
        child.next().value as {
          type: string;
          payload: { fn: unknown };
        },
    );

    expect(effect.type).toBe('ALL');
    expect(effect.payload).toHaveLength(7);
    expect(childEffects.map((child) => child.type)).toEqual(Array(7).fill('CALL'));
    expect(childEffects.map((child) => child.payload.fn)).toEqual([
      hardwareConsoleDeviceSaga,
      encoderPreferenceSaga,
      actionKeySaga,
      keyPinPersistenceSaga,
      promptPickerSaga,
      voiceTranscriptionSaga,
      publishWindowCyclePreferenceSaga,
    ]);
    expect(iterator.next().done).toBe(true);
  });
});
