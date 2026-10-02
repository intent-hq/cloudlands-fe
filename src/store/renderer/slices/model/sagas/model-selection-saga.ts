import { settleBackgroundSettings } from '../../background-agent-settings/sagas/settle-background-settings';
import { backgroundSettingsWriteLock } from '../../background-agent-settings/sagas/background-settings-write-lock';
import { selectBgSettings } from '../../background-agent-settings/background-agent-settings-selectors';
import { backgroundSettingsChanges } from '../../background-agent-settings/background-agent-settings-persistence';
import { buffers } from 'redux-saga';
import { actionChannel, call, put, take, takeEvery } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import type { AppSettingChange, SettingsUpdateResult } from '$lib/client/app-client';
import { isDaemonErrorResponse } from '$lib/client/live/backend-transport-types';
import { createLogger } from '$lib/utils/client-logger';
import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
import {
  selectProviderCatalogEntry,
  selectProviderCatalogLoaded,
} from '../../provider-catalog/provider-catalog-selectors';
import {
  selectActiveProviderId,
  selectProviderWriteRevision,
} from '../../provider-settings/provider-settings-selectors';
import {
  activeProviderPersistRejected,
  setAtomicDefaultModel,
} from '../../provider-settings/provider-settings-slice';
import { selectProviderModels } from '../model-selectors';
import {
  providerModelsPersistRejected,
  selectModel,
  setDefaultReasoningEffort,
} from '../model-slice';
import { settingsChangesReceived } from '../../settings-events/settings-events-slice';

const logger = createLogger('ModelSelectionSaga');

export function* handleSelectModel(action: ReturnType<typeof selectModel>) {
  const [rawModel, explicitProviderId] = action.payload;
  if (!rawModel) return;

  const activeProviderId = yield* selectActiveProviderId.effect();
  // Explicit providerId from the pick wins; a legacy compound prefix in the
  // model string is honored as a fallback for old callers/persisted echoes.
  const { providerId: legacyPrefix, modelId: model } = splitLegacyCompoundId(rawModel);
  const providerId = explicitProviderId || legacyPrefix || activeProviderId;

  if (providerId && providerId !== activeProviderId) {
    const provider = yield* selectProviderCatalogEntry.effect(providerId);
    const catalogLoaded = yield* selectProviderCatalogLoaded.effect();
    // Before the catalog hydrates (fresh install, onboarding racing the boot
    // reads — intent-hq/monorepo#1924) the pick's provider is adopted
    // optimistically, mirroring the model slice's pre-hydration handling
    // (`validatedDefaultProviderId`): the picker only offers real providers,
    // and the mirrored id is re-validated at `providerCatalogLoaded`. Once
    // the catalog is loaded, unknown providers are still rejected.
    if (!provider && catalogLoaded) {
      logger.warn('Ignoring model selection for unknown provider', { model, providerId });
      return;
    }
  }

  // The provider owner validates the quick-action bundle, accepts this pair,
  // then requests the new provider's reload and queues its atomic persistence.
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
  atomicRevision?: number,
) {
  yield* take(backgroundSettingsWriteLock);
  try {
    const background = yield* selectBgSettings.effect();
    // Keep the provider's model preference, but do not replay a provider switch
    // superseded through the other settings control while this writer waited.
    const currentProviderId =
      !background?.providerId || background.providerId === atomicProviderId
        ? atomicProviderId
        : undefined;
    const providerModels = yield* selectProviderModels.effect();
    // Store values and session picks are bare model ids keyed by provider —
    // persisted as-is; the daemon rejects compound ids on the wire (-32602).
    const value = { ...providerModels };
    for (const [providerId, model] of Object.entries(sessionPicks)) {
      value[providerId] = splitLegacyCompoundId(model).modelId;
    }
    try {
      const changes: AppSettingChange[] = currentProviderId
        ? [
            { path: 'model.defaultProvider', value: currentProviderId },
            { path: 'model.providerDefaults', value },
          ]
        : [{ path: 'model.providerDefaults', value }];
      if (currentProviderId) {
        if (background?.providerSwitchPending)
          changes.push(...backgroundSettingsChanges(background, currentProviderId));
      }
      const updateSnapshot = appClient.settings.updateSnapshot?.bind(appClient.settings);
      const hasRevisionClient = updateSnapshot !== undefined;
      const result: SettingsUpdateResult = updateSnapshot
        ? yield* call(updateSnapshot, changes)
        : {
            applied: yield* call([appClient.settings, appClient.settings.update], changes),
            revision: 0,
          };
      if (currentProviderId && background?.providerSwitchPending)
        yield* call(
          settleBackgroundSettings,
          {
            revision: result.revision,
            generation: background.persistenceGeneration ?? 0,
            providerId: currentProviderId,
          },
          background,
          result.applied,
        );
      // A successful update acknowledges the batch. `applied` contains only
      // changed paths, possibly including a daemon-resolved model.default;
      // its length does not indicate rejection (structured errors do).
      if (hasRevisionClient) {
        const acknowledged = [
          ...changes.filter((change) => !result.applied.some(({ path }) => path === change.path)),
          ...result.applied,
        ];
        yield* put(settingsChangesReceived(acknowledged, result.revision));
      }
      return 'persisted' satisfies PersistenceResult;
    } catch (error) {
      if (isDaemonErrorResponse(error)) {
        logger.warn('Daemon rejected model.providerDefaults write', { error });
        yield* put(providerModelsPersistRejected({ ...sessionPicks }));
        if (currentProviderId) {
          if (
            atomicRevision === undefined ||
            atomicRevision === (yield* selectProviderWriteRevision.effect('default'))
          )
            yield* put(activeProviderPersistRejected(currentProviderId));
          if (background?.providerSwitchPending)
            yield* call(settleBackgroundSettings, {
              generation: background.persistenceGeneration ?? 0,
              providerId: currentProviderId,
            });
        }
        return 'rejected' satisfies PersistenceResult;
      }
      logger.error('Failed to persist model.providerDefaults', { error });
      return 'retry' satisfies PersistenceResult;
    }
  } finally {
    yield* put(backgroundSettingsWriteLock, true);
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
  // Atomic defaults share providerSettingsSaga's ordered default-provider queue.
  yield* call(watchDefaultReasoningEffortPersistence);
}
