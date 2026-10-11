import { all, call } from 'typed-redux-saga';
import { takeLatestFromSelector } from '@themislib/themis/saga';
import { store } from '@/store';
import { notify } from '@/components/patterns/notify';
import { m } from '$shared/paraglide/messages.js';
import { settingsClient } from '@/features/settings/settings-client';
import { createSettingsHydrator } from '../../../../../../src/features/settings/settings-hydrator';
import { createSettingsSnapshotReader } from '../../../../../../src/store/renderer/slices/settings-events/sagas/settings-snapshot-reader';
import { createSettingsHydrationSaga } from '../../../../../../src/store/renderer/slices/settings-events/sagas/settings-hydration-saga-factory';
import { createModelSelectionSaga } from '../../../../../../src/store/renderer/slices/model/sagas/model-selection-saga-factory';
import { createProviderSettingsSaga } from '../../../../../../src/store/renderer/slices/provider-settings/sagas/provider-settings-saga-factory';
import { createBackgroundAgentSettingsSaga } from '../../../../../../src/store/renderer/slices/background-agent-settings/sagas/background-agent-settings-saga-factory';
import { createBackgroundSettingsWriteLock } from '../../../../../../src/store/renderer/slices/background-agent-settings/sagas/background-settings-write-lock';
import { selectBgSettings } from '../../background-agent-settings/background-agent-settings-selectors';
import { selectModelSelectionState } from '../../model/model-selectors';
import {
  selectHostAdministrationContext,
  selectCanAdministerHost,
} from '../../principal/principal-selectors';
import {
  selectProviderCatalogEntry,
  selectProviderCatalogLoaded,
  selectProviderDisplayName,
} from '../../provider-catalog/provider-catalog-selectors';
import {
  selectActiveProviderId,
  selectEnabledProviders,
  selectProviderSettingsSessionActive,
  selectProviderWriteRevision,
} from '../../provider-settings/provider-settings-selectors';
import { selectWindowBackendId } from '../../connections/connections-selectors';

/** One root lifetime for accepted global defaults and Quick Action writes, never agent writes. */
export function* settingsSaga() {
  const backgroundSettingsWriteLock = createBackgroundSettingsWriteLock();
  const readSettingsSnapshot = createSettingsSnapshotReader(settingsClient);
  const applySettingsChanges = createSettingsHydrator({
    dispatch: store.dispatch,
    getState: () => store.state,
  });
  const model = createModelSelectionSaga({
    settings: settingsClient,
    selectCanAdministerHost,
    readSettingsSnapshot,
    backgroundSettingsWriteLock,
    selectBgSettings,
    selectActiveProviderId,
    selectProviderCatalogEntry,
    selectProviderCatalogLoaded,
    selectModelSelectionState,
  });
  const provider = createProviderSettingsSaga({
    settings: settingsClient,
    selectCanAdministerHost,
    backgroundSettingsWriteLock,
    selectBgSettings,
    selectActiveBackendId: selectWindowBackendId.effect,
    selectProviderCatalogEntry,
    selectProviderDisplayName,
    selectEnabledProviders,
    selectProviderSettingsSessionActive,
    selectProviderWriteRevision,
    selectModelSelectionState,
    persistSelectedModelsWorker: model.persistSelectedModelsWorker,
    notify,
  });
  const background = createBackgroundAgentSettingsSaga({
    settingsClient,
    selectCanAdministerHost,
    selectModelSelectionState,
    readSettingsSnapshot,
    backgroundSettingsWriteLock,
    selectBgSettings,
    showProviderSwitchBlocked: (action) => {
      notify.error(m.settings_backgroundAgent_legacySwitch_error({ provider: action.payload[0] }));
    },
  });
  const hydration = createSettingsHydrationSaga({
    readSettingsSnapshot,
    applySettingsChanges,
    selectCanAdministerHost,
    selectHostAdministrationContext,
    selectModelSelectionState,
  });
  try {
    yield* all([
      call(hydration.settingsHydrationSaga),
      takeLatestFromSelector(selectHostAdministrationContext, function* ({ payload }) {
        if (!payload) return;
        yield* all([call(model.modelSelectionSaga), call(provider), call(background)]);
      }),
    ]);
  } finally {
    backgroundSettingsWriteLock.close();
  }
}
