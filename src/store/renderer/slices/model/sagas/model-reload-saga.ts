import { call, put, takeLatest } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { selectActiveProviderId } from '../../provider-settings/provider-settings-selectors';
import {
  reloadModelsForProvider,
  setAvailableModels,
  setLoadingStateForProvider,
} from '../model-slice';

const logger = createLogger('ModelReloadSaga');

export function* reloadModelsWorker() {
  const providerId = yield* selectActiveProviderId.effect();
  if (!providerId) return;

  yield* put(setLoadingStateForProvider({ providerId, status: 'loading' }));
  yield* put(setAvailableModels([], providerId));

  try {
    const models: Awaited<ReturnType<typeof appClient.models.list>> = yield* call([
      appClient.models,
      appClient.models.list,
    ]);
    const activeProviderId = yield* selectActiveProviderId.effect();
    if (activeProviderId !== providerId) return;

    if (models.length === 0) {
      yield* put(
        setLoadingStateForProvider({
          providerId,
          status: 'error',
          error: m.settings_models_noneAvailable({ providerId }),
        }),
      );
      return;
    }

    yield* put(setAvailableModels(models, providerId));
    yield* put(setLoadingStateForProvider({ providerId, status: 'success', retryAttempt: 0 }));
  } catch (error) {
    const activeProviderId = yield* selectActiveProviderId.effect();
    if (activeProviderId !== providerId) return;
    const message =
      error instanceof Error && error.message ? error.message : m.settings_models_loadError();
    logger.error('reloadModelsForProvider failed', { providerId, error });
    yield* put(setLoadingStateForProvider({ providerId, status: 'error', error: message }));
  }
}

/** Unregistered until the S20 middleware cutover. */
export function* modelReloadSaga() {
  yield* takeLatest(reloadModelsForProvider, reloadModelsWorker);
}
