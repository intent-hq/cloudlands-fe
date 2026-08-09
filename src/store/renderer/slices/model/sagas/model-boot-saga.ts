import { call, put } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { selectActiveProviderId } from '../../provider-settings/provider-settings-selectors';
import { setAvailableModels, setLoadingStateForProvider } from '../model-slice';

const logger = createLogger('ModelBootSaga');

/**
 * Boot-time model catalog load for the active provider (the v2.19.0
 * misc-ui-events-seeder "Models" block, dropped in #584 without a saga
 * replacement). Without it `state.model.availableModels` stays empty until
 * the first provider switch dispatches `reloadModelsForProvider`, starving
 * catalog consumers such as `selectModelEffortLevels` / EffortSelect.
 *
 * The active provider is read from the slice when settings hydration has
 * already landed, otherwise from the daemon (`settings.getProviderSettings`)
 * so the load does not race the hydration saga. Seeder semantics are kept:
 * dispatch only on a non-empty catalog and stay silent on failure — the
 * reload saga owns loading/error transitions for explicit provider switches.
 */
export function* loadModelsOnBootWorker() {
  try {
    let providerId = yield* selectActiveProviderId.effect();
    if (!providerId) {
      const providerSettings: Awaited<
        ReturnType<typeof appClient.settings.getProviderSettings>
      > = yield* call([appClient.settings, appClient.settings.getProviderSettings]);
      providerId = providerSettings?.activeProviderId ?? '';
    }
    if (!providerId) return;

    const models: Awaited<ReturnType<typeof appClient.models.list>> = yield* call([
      appClient.models,
      appClient.models.list,
    ]);

    // Provider mismatch guard: if the active provider changed while the list
    // was in flight, the reload saga owns that provider's load — drop ours.
    const activeProviderId = yield* selectActiveProviderId.effect();
    if (activeProviderId && activeProviderId !== providerId) return;
    if (models.length === 0) return;

    yield* put(setAvailableModels(models, providerId));
    yield* put(setLoadingStateForProvider({ providerId, status: 'success', retryAttempt: 0 }));
  } catch (error) {
    logger.warn('boot model catalog load failed; pickers will retry on demand', { error });
  }
}

/** One-shot boot-time load of the active provider's model catalog. */
export function* modelBootSaga() {
  yield* call(loadModelsOnBootWorker);
}
