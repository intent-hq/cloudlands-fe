import { selectActiveProviderId } from '../../provider-settings/provider-settings-selectors';
import { providerModelsSaga } from '../../provider-models/sagas/provider-models-saga';
import { selectModelBootContext } from '../model-selectors';
import { loadModelCatalog } from './model-catalog-request';
import { createModelReloadSaga } from '../../../../../../src/store/renderer/slices/model/sagas/model-reload-saga-factory';

export const { reloadModelsWorker, modelReloadSaga } = createModelReloadSaga({
  selectActiveProviderId,
  selectModelBootContext,
  providerModelsSaga,
  loadModelCatalog,
});
