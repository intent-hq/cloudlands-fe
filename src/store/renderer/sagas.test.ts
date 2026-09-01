import { describe, expect, it, vi } from 'vitest';

import { actionKeySaga } from './slices/hardware-console/sagas/action-key-saga';
import { hardwareConsoleDeviceSaga } from './slices/hardware-console/sagas/hardware-console-device-saga';
import { keyPinPersistenceSaga } from './slices/hardware-console/sagas/key-pin-persistence-saga';
import { promptPickerSaga } from './slices/hardware-console/sagas/prompt-picker-saga';
import { voiceTranscriptionSaga } from './slices/hardware-console/sagas/voice-transcription-saga';
import { hardwareConsoleSaga, sagas, startAllAppSagas } from './sagas';

describe('renderer app saga registry', () => {
  it('registers every audited root saga exactly once', () => {
    const names = sagas.map((saga) => saga.name);

    expect(names).toEqual([
      'daemonEventsSaga',
      'daemonHealthSaga',
      'connectionsSaga',
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
      'editRegenerateSaga',
      'agentFailureToastSaga',
      'gitReadSaga',
      'fileExplorerSaga',
      'filesReadSaga',
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
      'workspaceImportSaga',
      'scriptsOperationSaga',
      'lifecycleReadSaga',
      'lifecycleIpcReadSaga',
      'workspaceLoadSaga',
      'workspaceReconnectSaga',
      'modelSelectionSaga',
      'backgroundAgentSettingsSaga',
      'providerSettingsSaga',
      'modelBootSaga',
      'modelReloadSaga',
      'providerAvailabilitySaga',
      'setupPromptSaga',
      'hostRequirementsSaga',
      'backgroundHooksSaga',
      'hardwareConsoleSaga',
      'voiceSettingsSaga',
      'themeSaga',
      'autoUpdateSaga',
      'specialistsSaga',
      'proposalLifecycleSaga',
      'settingsProposalHistorySaga',
      'specialistProposalHistorySaga',
      'githubAuthSaga',
      'githubRepoSearchSaga',
      'sentryAuthSaga',
      'linearAuthSaga',
      'mcpSettingsSaga',
      'directoryPickerSaga',
      'statsReadSaga',
      'prMonitorSaga',
      'gitRootsSaga',
      'uiLayoutPersistenceSaga',
      'tabStateSaga',
      'workspaceTabReconciliationSaga',
      'workspaceTabCleanupSaga',
      'sidebarNavSaga',
      'panelLayoutSaga',
      'unreadTrackingSaga',
      'releaseNotesSaga',
      'browserPersistenceSaga',
      'fileContentPruneSaga',
      'terminalPersistenceSaga',
      'externalEditorsPersistenceSaga',
      'workspaceSettingsSaga',
      'updateChannelSaga',
      'notificationSettingsSaga',
      'userPreferencesPersistenceSaga',
      'workspaceInitializerSaga',
      'zoomIpcSaga',
      'menuIpcSaga',
      'browserIpcSaga',
      'notificationIpcSaga',
      'webNotificationSaga',
      'agentEventsIpcSaga',
      'gitEventsIpcSaga',
    ]);
    expect(new Set(sagas).size).toBe(88);
  });

  it('returns one cancellation handler per registered saga', () => {
    const cancel = vi.fn();
    const store = { runSaga: vi.fn(() => cancel) };

    const handlers = startAllAppSagas(store as never);

    expect(store.runSaga).toHaveBeenCalledTimes(88);
    expect(store.runSaga.mock.calls.map(([saga]) => saga)).toEqual(sagas);
    expect(handlers).toEqual(Array(88).fill(cancel));
  });

  it('starts every hardware-console owner exactly once under one cancellable composition', () => {
    const iterator = hardwareConsoleSaga();
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
    expect(effect.payload).toHaveLength(5);
    expect(childEffects.map((child) => child.type)).toEqual(Array(5).fill('CALL'));
    expect(childEffects.map((child) => child.payload.fn)).toEqual([
      hardwareConsoleDeviceSaga,
      actionKeySaga,
      keyPinPersistenceSaga,
      promptPickerSaga,
      voiceTranscriptionSaga,
    ]);
    expect(iterator.next().done).toBe(true);
  });
});
