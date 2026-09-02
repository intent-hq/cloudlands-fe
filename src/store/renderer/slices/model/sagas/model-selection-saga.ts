import { buffers } from 'redux-saga';
import { actionChannel, all, call, delay, put, race, take, takeEvery } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import type { SettingsUpdateResult } from '$lib/client/app-client';
import { isDaemonErrorResponse } from '$lib/client/live/backend-transport-types';
import { createLogger } from '$lib/utils/client-logger';
import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
import {
  selectProviderCatalogEntry,
  selectProviderCatalogLoaded,
} from '../../provider-catalog/provider-catalog-selectors';
import { selectActiveProviderId } from '../../provider-settings/provider-settings-selectors';
import {
  activeProviderPersistRejected,
  setAtomicDefaultModel,
} from '../../provider-settings/provider-settings-slice';
import { selectDefaultProviderId, selectProviderModels } from '../model-selectors';
import { normalizeModelForProvider } from '../model-selection-utils';
import {
  providerModelsPersistRejected,
  reloadModelsForProvider,
  selectModel,
  setDefaultReasoningEffort,
  setSelectedModel,
} from '../model-slice';
import { settingsChangesReceived } from '../../settings-events/settings-events-slice';

const logger = createLogger('ModelSelectionSaga');

export function* handleSelectModel(action: ReturnType<typeof selectModel>) {
  const model = action.payload[0];
  if (!model) return;

  const activeProviderId = yield* selectActiveProviderId.effect();
  const compoundProviderId = model.includes(':')
    ? (splitLegacyCompoundId(model).providerId ?? '')
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
      yield* put(reloadModelsForProvider());
    } else {
      logger.warn('Ignoring model selection for unknown provider', {
        model,
        providerId: compoundProviderId,
      });
      return;
    }
  }

  yield* put(setAtomicDefaultModel({ providerId, model }));
}

/**
 * Retry backoff for a failed `model.providerDefaults` write. During onboarding
 * on a fresh install the daemon connection may still be cycling (sidecar
 * download/start), so a fire-and-forget write would silently drop the user's
 * pick (intent-hq/monorepo#1924). The last delay repeats until the write lands
 * or a newer pick supersedes it.
 */
export const PROVIDER_DEFAULTS_RETRY_DELAYS_MS = [1_000, 5_000, 15_000] as const;

type PersistenceResult = 'persisted' | 'rejected' | 'retry';

/**
 * Persist the session's picks to `model.providerDefaults` (PROTOCOL §5.12).
 * The payload is the current provider map with EVERY pick made this session
 * (`sessionPicks`, newest per provider) overlaid using the same normalization
 * the reducer applies. Overlaying only the latest action would not be enough:
 * `model.providerDefaults` is one shared map across providers, so when picks
 * for providers A and then B queue behind an in-flight write and a stale
 * hydration echo resets the map in between, a B-only overlay would spread the
 * stale map and silently drop A's pick. Returns the write outcome so a
 * structured daemon rejection is not retried and its session overlay can be
 * retired before the next valid pick.
 */
export function* persistSelectedModelsWorker(
  sessionPicks: Record<string, string>,
  atomicProviderId?: string,
) {
  const providerModels = yield* selectProviderModels.effect();
  const defaultProviderId = yield* selectDefaultProviderId.effect();
  const value = { ...providerModels };
  for (const [providerId, model] of Object.entries(sessionPicks)) {
    value[providerId] = normalizeModelForProvider(providerId, model, defaultProviderId);
  }
  try {
    const changes = atomicProviderId
      ? [
          { path: 'model.defaultProvider', value: atomicProviderId },
          { path: 'model.providerDefaults', value },
        ]
      : [{ path: 'model.providerDefaults', value }];
    const updateSnapshot = appClient.settings.updateSnapshot?.bind(appClient.settings);
    const hasRevisionClient = updateSnapshot !== undefined;
    const result: SettingsUpdateResult = updateSnapshot
      ? yield* call(updateSnapshot, changes)
      : {
          applied: yield* call([appClient.settings, appClient.settings.update], changes),
          revision: 0,
        };
    if (atomicProviderId && hasRevisionClient && result.applied.length !== 2) {
      yield* put(providerModelsPersistRejected({ ...sessionPicks }));
      yield* put(activeProviderPersistRejected(atomicProviderId));
      return 'rejected' satisfies PersistenceResult;
    }
    if (hasRevisionClient) yield* put(settingsChangesReceived(result.applied, result.revision));
    return 'persisted' satisfies PersistenceResult;
  } catch (error) {
    if (isDaemonErrorResponse(error)) {
      logger.warn('Daemon rejected model.providerDefaults write', { error });
      yield* put(providerModelsPersistRejected({ ...sessionPicks }));
      if (atomicProviderId) yield* put(activeProviderPersistRejected(atomicProviderId));
      return 'rejected' satisfies PersistenceResult;
    }
    logger.error('Failed to persist model.providerDefaults', { error });
    return 'retry' satisfies PersistenceResult;
  }
}

function* watchSelectedModelPersistence() {
  const channel = yield* actionChannel(
    [setAtomicDefaultModel, setSelectedModel],
    buffers.sliding(1),
  );
  // Newest pick per provider made this session. Session-scoped on purpose:
  // an entry only exists for a provider the user explicitly picked here, and
  // re-overlaying it on every write keeps the user's in-session intent from
  // being displaced by stale snapshot echoes (intent-hq/monorepo#1924).
  const sessionPicks: Record<string, string> = {};
  try {
    let action = yield* take(channel);
    let attempt = 0;
    while (true) {
      const { providerId, model } = action.payload[0];
      sessionPicks[providerId] = model;
      const result = yield* call(
        persistSelectedModelsWorker,
        sessionPicks,
        action.type === setAtomicDefaultModel.type ? providerId : undefined,
      );
      if (result !== 'retry') {
        if (result === 'rejected') {
          for (const rejectedProviderId of Object.keys(sessionPicks)) {
            delete sessionPicks[rejectedProviderId];
          }
        }
        action = yield* take(channel);
        attempt = 0;
        continue;
      }
      // Failed write: back off and retry the SAME picks, unless a newer pick
      // arrives first — it joins the overlay and supersedes the backoff.
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
  yield* all([call(watchSelectedModelPersistence), call(watchDefaultReasoningEffortPersistence)]);
}
