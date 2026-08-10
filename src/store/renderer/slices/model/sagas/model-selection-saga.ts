import { buffers } from 'redux-saga';
import { actionChannel, all, call, delay, put, race, take, takeEvery } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { splitCompoundModelId } from '$shared/utils/compound-model-id';
import {
  selectProviderCatalogEntry,
  selectProviderCatalogLoaded,
} from '../../provider-catalog/provider-catalog-selectors';
import { selectActiveProviderId } from '../../provider-settings/provider-settings-selectors';
import { setActiveProvider } from '../../provider-settings/provider-settings-slice';
import { selectDefaultProviderId, selectProviderModels } from '../model-selectors';
import { normalizeModelForProvider } from '../model-selection-utils';
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
    const catalogLoaded = yield* selectProviderCatalogLoaded.effect();
    // Before the catalog hydrates (fresh install, onboarding racing the boot
    // reads — intent-hq/monorepo#1924) the pick's provider is adopted
    // optimistically, mirroring the model slice's pre-hydration handling
    // (`validatedDefaultProviderId`): the picker only offers real providers,
    // and the mirrored id is re-validated at `providerCatalogLoaded`. Once
    // the catalog is loaded, unknown prefixes are still rejected.
    if (provider || !catalogLoaded) {
      yield* put(setActiveProvider(compoundProviderId));
      yield* put(reloadModelsForProvider());
    }
  }

  yield* put(setSelectedModel({ providerId, model }));
}

/**
 * Retry backoff for a failed `model.providerDefaults` write. During onboarding
 * on a fresh install the daemon connection may still be cycling (sidecar
 * download/start), so a fire-and-forget write would silently drop the user's
 * pick (intent-hq/monorepo#1924). The last delay repeats until the write lands
 * or a newer pick supersedes it.
 */
export const PROVIDER_DEFAULTS_RETRY_DELAYS_MS = [1_000, 5_000, 15_000] as const;

/**
 * Persist the taken pick to `model.providerDefaults` (PROTOCOL §5.12). The
 * payload is the current provider map with the ACTION's pick overlaid (same
 * normalization the reducer applies), so an interleaved hydration echo of an
 * older snapshot can never displace a newer queued pick — the same guard the
 * reasoning-effort worker below documents. Returns whether the write landed.
 */
export function* persistSelectedModelsWorker(action: ReturnType<typeof setSelectedModel>) {
  const { providerId, model } = action.payload[0];
  const providerModels = yield* selectProviderModels.effect();
  const defaultProviderId = yield* selectDefaultProviderId.effect();
  const value = {
    ...providerModels,
    [providerId]: normalizeModelForProvider(providerId, model, defaultProviderId),
  };
  try {
    yield* call(
      [appClient.settings, appClient.settings.update],
      [{ path: 'model.providerDefaults', value }],
    );
    return true;
  } catch (error) {
    logger.error('Failed to persist model.providerDefaults', { error });
    return false;
  }
}

function* watchSelectedModelPersistence() {
  const channel = yield* actionChannel(setSelectedModel, buffers.sliding(1));
  try {
    let action = yield* take(channel);
    let attempt = 0;
    while (true) {
      const persisted = yield* call(persistSelectedModelsWorker, action);
      if (persisted) {
        action = yield* take(channel);
        attempt = 0;
        continue;
      }
      // Failed write: back off and retry the SAME pick, unless a newer pick
      // arrives first — it supersedes both the payload and the backoff.
      const delayMs =
        PROVIDER_DEFAULTS_RETRY_DELAYS_MS[
          Math.min(attempt, PROVIDER_DEFAULTS_RETRY_DELAYS_MS.length - 1)
        ];
      attempt += 1;
      const { next } = yield* race({ next: take(channel), retry: delay(delayMs) });
      if (next) {
        action = next;
        attempt = 0;
      }
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
