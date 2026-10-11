// Svelte binding of the shared read owner; remove this facade when the Svelte renderer retires.
import { selectActiveProviderId } from '../../provider-settings/provider-settings-selectors';
import { providerModelsSaga } from '../../provider-models/sagas/provider-models-saga';
import { selectModelBootContext } from '../model-selectors';
import { loadModelCatalog } from './model-catalog-request';
import { createModelReloadSaga } from './model-reload-saga-factory';

export const { reloadModelsWorker, modelReloadSaga } = createModelReloadSaga({
  selectActiveProviderId,
  selectModelBootContext,
  providerModelsSaga,
  loadModelCatalog,
});
