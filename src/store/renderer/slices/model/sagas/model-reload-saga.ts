import { call, fork, takeLatest } from 'typed-redux-saga';
import { selectActiveProviderId } from '../../provider-settings/provider-settings-selectors';
import { providerModelsSaga } from '../../provider-models/sagas/provider-models-saga';
import { reloadModelsForProvider } from '../model-slice';
import { selectModelBootContext } from '../model-selectors';
import { loadModelCatalog } from './model-catalog-request';

export function* reloadModelsWorker() {
  const context = yield* selectModelBootContext.effect();
  const providerId = yield* selectActiveProviderId.effect();
  if (!context || !providerId) return;
  yield* call(loadModelCatalog, providerId, context, true);
}

export function* modelReloadSaga() {
  yield* fork(providerModelsSaga);
  yield* takeLatest(reloadModelsForProvider, reloadModelsWorker);
}
