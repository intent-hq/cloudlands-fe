import { put } from 'typed-redux-saga';
import { createSettingsHydrationSaga } from './settings-hydration-saga-factory';
import { readSettingsSnapshot } from './read-settings-snapshot';
import { applySettingsChanges } from '$features/settings/settings-hydration-service';
import {
  selectCanAdministerHost,
  selectHostAdministrationContext,
} from '../../principal/principal-selectors';
import { selectModelSelectionState } from '../../model/model-selectors';
import { notificationVolumeHydrationStarted } from '../../user-preferences/user-preferences-slice';
import {
  fastModeHydrationStarted,
  fastModeSupportReceived,
} from '../../provider-settings/provider-settings-slice';
import { settingsFormSaga } from './settings-form-saga';
import { settingsMigrationsSaga } from './settings-migrations-saga';
import { websocketApiSaga } from '../../websocket-api/sagas/websocket-api-saga';
import { rtkSettingsSaga } from '../../rtk-settings/sagas/rtk-settings-saga';
export { SETTINGS_HYDRATION_RETRY_DELAYS_MS } from './settings-hydration-saga-factory';

// Svelte compatibility composition. React does not start these unrelated settings workflows.
export const { settingsHydrationSaga, hydrateSettingsOnceSaga } = createSettingsHydrationSaga({
  readSettingsSnapshot,
  applySettingsChanges,
  selectCanAdministerHost,
  selectHostAdministrationContext,
  selectModelSelectionState,
  hydrationStarted: function* () {
    yield* put(notificationVolumeHydrationStarted());
    yield* put(fastModeHydrationStarted());
  },
  snapshotReceived: function* (supported) {
    yield* put(fastModeSupportReceived(supported));
  },
  additionalSagas: [settingsMigrationsSaga, settingsFormSaga, websocketApiSaga, rtkSettingsSaga],
});
