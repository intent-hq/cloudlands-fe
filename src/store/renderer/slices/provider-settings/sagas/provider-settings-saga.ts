import { call } from 'typed-redux-saga';
import { takeLatestFromSelector } from '@themislib/themis/saga';
import { appClient } from '$lib/client';
import { notify } from '$lib/components/patterns/notify';
import { backgroundSettingsWriteLock } from '../../background-agent-settings/sagas/background-settings-write-lock';
import { selectBgSettings } from '../../background-agent-settings/background-agent-settings-selectors';
import { selectActiveBackendId } from '../../../utils/backend-storage-namespace';
import {
  selectProviderCatalogEntry,
  selectProviderDisplayName,
} from '../../provider-catalog/provider-catalog-selectors';
import {
  selectEnabledProviders,
  selectProviderSettingsSessionActive,
  selectProviderWriteRevision,
} from '../provider-settings-selectors';
import { selectModelSelectionState } from '../../model/model-selectors';
import { persistSelectedModelsWorker } from '../../model/sagas/model-selection-saga';
import {
  selectHostAdministrationContext,
  selectCanAdministerHost,
} from '../../principal/principal-selectors';
import { providerSettingsReadSaga } from './provider-settings-read-saga';
import { providerFastModeSaga } from './provider-fast-mode-saga';
import { createProviderSettingsSaga } from './provider-settings-saga-factory';
export { PROVIDER_SETTINGS_RETRY_DELAYS_MS } from './provider-settings-saga-factory';

// Svelte compatibility composition keeps settings-panel workflows in their original lifetime.
const bound = createProviderSettingsSaga({
  settings: appClient.settings,
  selectCanAdministerHost,
  backgroundSettingsWriteLock,
  selectBgSettings,
  selectActiveBackendId,
  selectProviderCatalogEntry,
  selectProviderDisplayName,
  selectEnabledProviders,
  selectProviderSettingsSessionActive,
  selectProviderWriteRevision,
  selectModelSelectionState,
  persistSelectedModelsWorker,
  notify,
  additionalSagas: [providerFastModeSaga, providerSettingsReadSaga],
});
export function* providerSettingsSaga() {
  yield* takeLatestFromSelector(selectHostAdministrationContext, function* ({ payload }) {
    if (payload) yield* call(bound);
  });
}
