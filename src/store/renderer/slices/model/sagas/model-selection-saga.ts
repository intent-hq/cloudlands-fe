import { buffers } from 'redux-saga';
import { actionChannel, all, call, put, take, takeEvery } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { splitCompoundModelId } from '$shared/utils/compound-model-id';
import { selectProviderCatalogEntry } from '../../provider-catalog/provider-catalog-selectors';
import { selectActiveProviderId } from '../../provider-settings/provider-settings-selectors';
import { setActiveProvider } from '../../provider-settings/provider-settings-slice';
import { selectProviderModels } from '../model-selectors';
import {
  reloadModelsForProvider,
  selectModel,
  setDefaultReasoningEffort,
  setSelectedModel,
} from '../model-slice';

const logger = createLogger('ModelSelectionSaga');

export function* handleSelectModel(action: ReturnType<typeof selectModel>) {
  const model = action.payload[0];
  if (!model) return;

  const activeProviderId = yield* selectActiveProviderId.effect();
  const compoundProviderId = model.includes(':')
    ? (splitCompoundModelId(model).providerId ?? '')
    : '';
  const providerId = compoundProviderId || activeProviderId;

  if (compoundProviderId && compoundProviderId !== activeProviderId) {
    const provider = yield* selectProviderCatalogEntry.effect(compoundProviderId);
    if (provider) {
      yield* put(setActiveProvider(compoundProviderId));
      yield* put(reloadModelsForProvider());
    }
  }

  yield* put(setSelectedModel({ providerId, model }));
}

export function* persistSelectedModelsWorker() {
  const providerModels = yield* selectProviderModels.effect();
  try {
    yield* call(
      [appClient.settings, appClient.settings.update],
      [{ path: 'model.providerDefaults', value: providerModels }],
    );
  } catch (error) {
    logger.error('Failed to persist model.providerDefaults', { error });
  }
}

function* watchSelectedModelPersistence() {
  const channel = yield* actionChannel(setSelectedModel, buffers.sliding(1));
  try {
    while (true) {
      yield* take(channel);
      yield* call(persistSelectedModelsWorker);
    }
  } finally {
    channel.close();
  }
}

/**
 * Persist a default reasoning-effort pick to the daemon settings catalog
 * (PROTOCOL §5.12). Fire-and-forget like `model.providerDefaults`; the daemon
 * echoes the write back via `settings:changed`, which hydration applies
 * through `loadDefaultReasoningEffortFromStorage` — deliberately NOT observed
 * here, so there is no write loop. The taken action's payload is persisted
 * (not a store snapshot read at worker time), so an interleaved hydration
 * echo of an older value can never displace a newer queued pick.
 */
export function* persistDefaultReasoningEffortWorker(effort: string) {
  try {
    yield* call(
      [appClient.settings, appClient.settings.update],
      [{ path: 'model.defaultReasoningEffort', value: effort }],
    );
  } catch (error) {
    logger.error('Failed to persist model.defaultReasoningEffort', { error });
  }
}

function* watchDefaultReasoningEffortPersistence() {
  const channel = yield* actionChannel(setDefaultReasoningEffort, buffers.sliding(1));
  try {
    while (true) {
      const action = yield* take(channel);
      yield* call(persistDefaultReasoningEffortWorker, action.payload[0]);
    }
  } finally {
    channel.close();
  }
}

export function* modelSelectionSaga() {
  yield* takeEvery(selectModel, handleSelectModel);
  yield* all([
    call(watchSelectedModelPersistence),
    call(watchDefaultReasoningEffortPersistence),
  ]);
}
