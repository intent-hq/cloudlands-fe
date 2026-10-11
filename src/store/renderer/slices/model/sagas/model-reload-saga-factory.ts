import { call, fork, takeLatest } from 'typed-redux-saga';
import { reloadModelsForProvider } from '../model-slice';
import type * as projections0 from '../../provider-settings/provider-settings-projections';
import type * as projections1 from '../model-projections';

import type { ReadSelector, ProviderReadState } from '../../provider-catalog/provider-read-types';

export function createModelReloadSaga<State extends ProviderReadState>({
  selectActiveProviderId,
  selectModelBootContext,
  providerModelsSaga,
  loadModelCatalog,
}: {
  selectActiveProviderId: ReadSelector<typeof projections0.getActiveProviderId, State>;
  selectModelBootContext: ReadSelector<typeof projections1.getModelBootContext, State>;
  providerModelsSaga: () => import('typed-redux-saga').SagaGenerator<void>;
  loadModelCatalog: (
    providerId: string,
    context: string,
    explicit: boolean,
    force?: boolean,
  ) => import('typed-redux-saga').SagaGenerator<boolean>;
}) {
  function* reloadModelsWorker() {
    const context = yield* selectModelBootContext.effect();
    const providerId = yield* selectActiveProviderId.effect();
    if (!context || !providerId) return;
    yield* call(loadModelCatalog, providerId, context, true);
  }

  function* modelReloadSaga() {
    yield* fork(providerModelsSaga);
    yield* takeLatest(reloadModelsForProvider, reloadModelsWorker);
  }

  return { reloadModelsWorker, modelReloadSaga };
}
