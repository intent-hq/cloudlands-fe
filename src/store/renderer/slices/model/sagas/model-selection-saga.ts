import { call } from 'typed-redux-saga';
import { takeLatestFromSelector } from '@themislib/themis/saga';
import { appClient } from '$lib/client';
import { createModelSelectionSaga } from './model-selection-saga-factory';
import { backgroundSettingsWriteLock } from '../../background-agent-settings/sagas/background-settings-write-lock';
import { selectBgSettings } from '../../background-agent-settings/background-agent-settings-selectors';
import { readSettingsSnapshot } from '../../settings-events/sagas/read-settings-snapshot';
import { selectActiveProviderId } from '../../provider-settings/provider-settings-selectors';
import {
  selectProviderCatalogEntry,
  selectProviderCatalogLoaded,
} from '../../provider-catalog/provider-catalog-selectors';
import { selectModelSelectionState } from '../model-selectors';
import {
  selectHostAdministrationContext,
  selectCanAdministerHost,
} from '../../principal/principal-selectors';

// Svelte compatibility binding; shared transaction bodies live in the factory until cutover.
const bound = createModelSelectionSaga({
  settings: appClient.settings,
  selectCanAdministerHost,
  readSettingsSnapshot,
  backgroundSettingsWriteLock,
  selectBgSettings,
  selectActiveProviderId,
  selectProviderCatalogEntry,
  selectProviderCatalogLoaded,
  selectModelSelectionState,
});
export const {
  handleSelectModel,
  persistSelectedModelsWorker,
  persistDefaultReasoningEffortWorker,
} = bound;
export function* modelSelectionSaga() {
  yield* takeLatestFromSelector(selectHostAdministrationContext, function* ({ payload }) {
    if (payload) yield* call(bound.modelSelectionSaga);
  });
}
