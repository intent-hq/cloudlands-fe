import { call, cancelled, delay, put, takeLatest, type SagaGenerator } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { agentClient } from '$features/agent/agent.client';
import { reconcileAgentReasoningEffort } from '$features/agent/reasoning-effort';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { selectActiveProviderId } from '../../provider-settings/provider-settings-selectors';
import { getModelsForProviderForLoadingState } from '../model-utils';
import {
  loadProviderModelsRequested,
  providerModelsLoaded,
} from '../../provider-models/provider-models-slice';
import { selectProviderModelsClearEpoch } from '../../provider-models/provider-models-selectors';
import { takeLatestInContext } from '../../../utils/context-saga-effects';
import {
  reloadModelsForProvider,
  setAgentModelRequested,
  setAvailableModels,
  setLoadingStateForProvider,
} from '../model-slice';
import { selectAgentReasoningEffort } from '../../agent-session/agent-session-selectors';

const logger = createLogger('ModelReloadSaga');

export function* reloadModelsWorker() {
  const providerId = yield* selectActiveProviderId.effect();
  if (!providerId) return;

  yield* put(setLoadingStateForProvider({ providerId, status: 'loading' }));
  yield* put(setAvailableModels([], providerId));

  try {
    const models: Awaited<ReturnType<typeof appClient.models.list>> = yield* call(
      [appClient.models, appClient.models.list],
      providerId,
    );
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

function* loadProviderModelsWorker(
  action: ReturnType<typeof loadProviderModelsRequested>,
): SagaGenerator<void> {
  const [providerId, forceRefresh = false, debounce = false] = action.payload;
  action.promise.catch(() => {});
  let settled = false;
  try {
    yield* put(setLoadingStateForProvider({ providerId, status: 'loading' }));
    if (debounce) yield* delay(50);
    const epoch = yield* selectProviderModelsClearEpoch.effect();
    const result = yield* call(getModelsForProviderForLoadingState, providerId, { forceRefresh });
    if ((yield* selectProviderModelsClearEpoch.effect()) !== epoch) {
      throw new Error('Provider model request superseded by reconnect');
    }
    yield* put(providerModelsLoaded(providerId, result, epoch));
    yield* put(
      setLoadingStateForProvider({
        providerId,
        status: 'success',
        warning: result.warning,
        stale: result.stale,
      }),
    );
    yield* put(action.success(result));
    settled = true;
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    yield* put(setLoadingStateForProvider({ providerId, status: 'error', error: failure.message }));
    yield* put(action.failure(failure));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error('Provider model request superseded')));
    }
  }
}

function* setAgentModelWorker(
  action: ReturnType<typeof setAgentModelRequested>,
): SagaGenerator<void> {
  const [, agentId, workspaceId, model, providerId, supportedEfforts] = action.payload;
  action.promise.catch(() => {});
  let settled = false;
  try {
    const result = yield* call(
      [agentClient, agentClient.setModel],
      agentId,
      model,
      workspaceId,
      providerId,
    );
    if (!result.ok || !result.data.success) {
      throw new Error(result.ok ? result.data.error : result.error);
    }
    const currentEffort = yield* selectAgentReasoningEffort.effect(agentId);
    yield* call(
      reconcileAgentReasoningEffort,
      agentId,
      workspaceId,
      currentEffort,
      supportedEfforts,
    );
    yield* put(action.success(undefined as void));
    settled = true;
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    const { toast } = yield* call(() => import('svelte-sonner'));
    yield* call(toast.error, failure.message, { duration: 6000 });
    yield* put(action.failure(failure));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error('Agent model update superseded')));
    }
  }
}

export function* modelReloadSaga() {
  yield* takeLatestInContext(
    setAgentModelRequested,
    (action) => action.payload[1],
    setAgentModelWorker,
  );
  yield* takeLatestInContext(
    loadProviderModelsRequested,
    (action) => action.payload[0],
    loadProviderModelsWorker,
  );
  yield* takeLatest(reloadModelsForProvider, reloadModelsWorker);
}
