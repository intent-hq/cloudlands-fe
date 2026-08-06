import { describe, expect, it, vi } from 'vitest';

import { sagas, startAllAppSagas } from './sagas';

describe('renderer app saga registry', () => {
  it('registers every audited root saga exactly once', () => {
    const names = sagas.map((saga) => saga.name);

    expect(names).toEqual([
      'daemonEventsSaga',
      'daemonHealthSaga',
      'settingsHydrationSaga',
      'activeStreamsSaga',
      'agentReadSaga',
      'agentSubscriptionReadSaga',
      'chatReadSaga',
      'chatSubscribeSaga',
      'chatSendSaga',
      'permissionResponseSaga',
      'agentStreamSaga',
      'agentCreationSaga',
      'agentMutationSaga',
      'editRegenerateSaga',
      'agentFailureToastSaga',
      'gitReadSaga',
      'fileExplorerSaga',
      'filesReadSaga',
      'filesWriteSaga',
      'workspaceNotesSaga',
      'contextSaga',
      'taskAgentAssociationsSaga',
      'appLayoutNavigationSaga',
      'workspaceNavigationTabSaga',
      'workspaceNavigationLayoutSaga',
      'workspaceOperationsSaga',
      'lifecycleReadSaga',
      'lifecycleIpcReadSaga',
      'modelSelectionSaga',
      'backgroundAgentSettingsSaga',
      'providerSettingsSaga',
      'modelReloadSaga',
      'providerAvailabilitySaga',
      'hostRequirementsSaga',
      'hardwareConsoleDeviceSaga',
      'themeSaga',
      'autoUpdateSaga',
      'specialistsSaga',
      'githubAuthSaga',
      'sentryAuthSaga',
      'linearAuthSaga',
      'mcpSettingsSaga',
      'directoryPickerSaga',
      'legacyImportSaga',
      'statsReadSaga',
      'uiLayoutPersistenceSaga',
      'tabStateSaga',
      'sidebarNavSaga',
      'panelLayoutSaga',
      'unreadTrackingSaga',
      'releaseNotesSaga',
      'browserPersistenceSaga',
      'fileContentPruneSaga',
      'terminalPersistenceSaga',
      'externalEditorsPersistenceSaga',
      'workspaceSettingsSaga',
      'betaUpdatesSaga',
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
    expect(new Set(sagas).size).toBe(67);
  });

  it('returns one cancellation handler per registered saga', () => {
    const cancel = vi.fn();
    const store = { runSaga: vi.fn(() => cancel) };

    const handlers = startAllAppSagas(store as never);

    expect(store.runSaga).toHaveBeenCalledTimes(67);
    expect(store.runSaga.mock.calls.map(([saga]) => saga)).toEqual(sagas);
    expect(handlers).toEqual(Array(67).fill(cancel));
  });
});
