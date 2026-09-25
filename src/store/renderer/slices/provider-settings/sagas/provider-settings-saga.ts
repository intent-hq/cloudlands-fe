import { buffers, channel, type Channel } from 'redux-saga';
import { all, call, cancelled, delay, put, race, take, takeEvery } from 'typed-redux-saga';

import { appClient, type AppSettingChange } from '$lib/client';
import { isDaemonErrorResponse } from '$lib/client/live/backend-transport-types';
import { createLogger } from '$lib/utils/client-logger';
import { resolveProviderEnabled } from '$shared/provider-catalog';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import { selectActiveBackendId } from '../../../utils/backend-storage-namespace';
import {
  selectProviderCatalogEntry,
  selectProviderDisplayName,
} from '../../provider-catalog/provider-catalog-selectors';
import {
  selectEnabledProviders,
  selectProviderSettingsSessionActive,
  selectProviderWriteRevision,
} from '../provider-settings-selectors';
import type { ProviderSettingsRequestContext } from '../provider-settings-types';
import { checkAllProvidersRequested } from '../../agent-availability/agent-availability-slice';
import { reloadModelsForProvider, setSelectedModel } from '../../model/model-slice';
import {
  persistSelectedModelsWorker,
  PROVIDER_DEFAULTS_RETRY_DELAYS_MS,
} from '../../model/sagas/model-selection-saga';
import { m } from '$shared/paraglide/messages.js';
import { providerSettingsReadSaga } from './provider-settings-read-saga';
import {
  activeProviderPersistRejected,
  enablementPersistRejected,
  ensureEnabledIfUnset,
  setActiveProvider,
  setProviderEnabled,
  toggleProvider,
  providerEnablementSeedRequested,
  providerPathSaveRequested,
  providerPathSaved,
  providerSettingsRequestSettled,
  providerSettingsStopped,
  setAtomicDefaultModel,
} from '../provider-settings-slice';

const logger = createLogger('ProviderSettingsSaga');

type ProviderSettingsUpdate = {
  modelPick?: { providerId: string; model: string; atomic: boolean };
  superseded?: boolean;
  request?: ProviderSettingsRequestContext;
  resource?: string;
  revision?: number;
  enabledSeed?: Record<string, boolean>;
  path?: { providerId: string; value: string };
  activeProviderId?: string;
  /**
   * Enablement is queued as the click's `{providerId, enabled}` delta, not a
   * map snapshot: `providers.enabled` is written as a full map, so the delta
   * is merged over the live map at write time. A boot settings hydration that
   * replaces the map between dispatch and write therefore cannot drop the
   * click's entry from the persisted value (monorepo#1986).
   *
   * This closes the single-window hydration race only. Because the wire value
   * is still a full map, cross-writer last-writer-wins races remain (and
   * predate this delta): two windows toggling different providers
   * concurrently can each persist a map missing the other's entry, and a
   * delta queued behind a slow prior write can re-impose an older click over
   * a newer remote change for the same provider once its override was retired
   * by a confirming hydration. Resolving those needs a per-key wire write,
   * not a client-side change.
   */
  enabledProviderDelta?: { providerId: string; enabled: boolean };
};

type ModelQueue = {
  latest?: ProviderSettingsUpdate;
  changed: Channel<boolean>;
};

function* queueModelWorker(
  updates: Channel<ProviderSettingsUpdate>,
  models: ModelQueue,
  action: ReturnType<typeof setAtomicDefaultModel> | ReturnType<typeof setSelectedModel>,
) {
  if (models.latest) models.latest.superseded = true;
  const update: ProviderSettingsUpdate = {
    modelPick: { ...action.payload[0], atomic: action.type === setAtomicDefaultModel.type },
    revision: yield* selectProviderWriteRevision.effect('default'),
  };
  models.latest = update;
  yield* put(models.changed, true);
  yield* put(updates, update);
}

function* persistModelUpdate(
  update: ProviderSettingsUpdate,
  models: ModelQueue,
  sessionPicks: Record<string, string>,
) {
  const pick = update.modelPick;
  if (!pick) return;
  sessionPicks[pick.providerId] = pick.model;
  if (update.superseded) return;
  models.latest = undefined;
  let attempt = 0;
  while (true) {
    const result = yield* call(
      persistSelectedModelsWorker,
      { ...sessionPicks },
      pick.atomic ? pick.providerId : undefined,
      update.revision,
    );
    if (result === 'rejected') {
      for (const id of Object.keys(sessionPicks)) delete sessionPicks[id];
    }
    if (result !== 'retry' || models.latest) return;
    const { next } = yield* race({
      next: take(models.changed),
      retry: delay(
        PROVIDER_DEFAULTS_RETRY_DELAYS_MS[
          Math.min(attempt, PROVIDER_DEFAULTS_RETRY_DELAYS_MS.length - 1)
        ],
      ),
    });
    if (next) return;
    attempt += 1;
  }
}

/** Map a queued partial update to its §5.12 wire changes (PROTOCOL paths). */
function* changesFor(update: ProviderSettingsUpdate) {
  const changes: AppSettingChange[] = [];
  if (update.path) {
    const entry = yield* call([appClient.settings, appClient.settings.get], 'providers.paths');
    const existing =
      entry?.value && typeof entry.value === 'object' && !Array.isArray(entry.value)
        ? entry.value
        : {};
    changes.push({
      path: 'providers.paths',
      value: { ...existing, [update.path.providerId]: update.path.value },
    });
  }
  if (update.enabledSeed) {
    if ((yield* selectActiveBackendId()) !== LOCAL_CONNECTION_ID) return changes;
    const current = yield* selectEnabledProviders.effect();
    if (Object.keys(update.enabledSeed).every((id) => current[id] !== undefined)) return changes;
    changes.push({ path: 'providers.enabled', value: { ...update.enabledSeed, ...current } });
  }
  if (update.activeProviderId !== undefined) {
    // Provider leg of the default model triple — `providers.active` is
    // deprecated (unread by the daemon).
    changes.push({ path: 'model.defaultProvider', value: update.activeProviderId });
  }
  if (update.enabledProviderDelta !== undefined) {
    const { providerId, enabled } = update.enabledProviderDelta;
    const enabledProviders = yield* selectEnabledProviders.effect();
    changes.push({
      path: 'providers.enabled',
      value: { ...enabledProviders, [providerId]: enabled },
    });
  }
  return changes;
}

function* queueActiveProviderWorker(
  updates: Channel<ProviderSettingsUpdate>,
  action: ReturnType<typeof setActiveProvider>,
) {
  const providerId = action.payload[0];
  if (providerId)
    yield* put(updates, {
      activeProviderId: providerId,
      request: action.payload[1],
      resource: 'default',
      revision: yield* selectProviderWriteRevision.effect('default'),
    });
}

function* queueEnabledProviders(
  updates: Channel<ProviderSettingsUpdate>,
  providerId: string,
  enabled: boolean,
  request?: ProviderSettingsRequestContext,
) {
  const provider = yield* selectProviderCatalogEntry.effect(providerId);
  if (provider && !provider.canBeDisabled) return;
  const resource = `enabled:${providerId}`;
  yield* put(updates, {
    enabledProviderDelta: { providerId, enabled },
    request,
    resource,
    revision: yield* selectProviderWriteRevision.effect(resource),
  });
}

function* queueToggleProviderWorker(
  updates: Channel<ProviderSettingsUpdate>,
  action: ReturnType<typeof toggleProvider>,
) {
  const providerId = action.payload[0];
  // The toggle's intent is the post-reducer resolved value.
  const enabledProviders = yield* selectEnabledProviders.effect();
  yield* call(
    queueEnabledProviders,
    updates,
    providerId,
    resolveProviderEnabled(enabledProviders, providerId),
  );
}

function* queueSetProviderEnabledWorker(
  updates: Channel<ProviderSettingsUpdate>,
  action: ReturnType<typeof setProviderEnabled>,
) {
  const { providerId, enabled } = action.payload[0];
  yield* call(queueEnabledProviders, updates, providerId, enabled, action.payload[1]);
}

function* queuePathWorker(
  updates: Channel<ProviderSettingsUpdate>,
  action: ReturnType<typeof providerPathSaveRequested>,
) {
  const [providerId, value, request] = action.payload;
  const resource = `path:${providerId}`;
  yield* put(updates, {
    path: { providerId, value },
    request,
    resource,
    revision: yield* selectProviderWriteRevision.effect(resource),
  });
}

function* queueSeedWorker(
  updates: Channel<ProviderSettingsUpdate>,
  action: ReturnType<typeof providerEnablementSeedRequested>,
) {
  yield* put(updates, { enabledSeed: action.payload[0] });
}

function* notifyOutcome(update: ProviderSettingsUpdate, success: boolean) {
  if (
    !update.request ||
    !(yield* selectProviderSettingsSessionActive.effect(update.request.sessionId))
  )
    return;
  if (
    update.resource &&
    update.revision !== (yield* selectProviderWriteRevision.effect(update.resource))
  )
    return;
  const { notify } = yield* call(() => import('$lib/components/patterns/notify'));
  if (update.path) {
    if (success) yield* call(notify.success, m.settings_providerPath_saved());
    else yield* call(notify.error, m.settings_providerPath_saveError());
  } else if (success && update.activeProviderId) {
    const name = yield* selectProviderDisplayName.effect(update.activeProviderId);
    yield* call(notify.success, m.settings_providers_switchedTo({ name }));
  }
}

/**
 * Retry backoff for a provider-settings write that failed in transport.
 * During onboarding on a fresh install the daemon connection may still be
 * cycling, so dropping the write would leave `model.defaultProvider` stale on
 * the daemon — the onboarding model pick then resolves under the wrong provider
 * key after restart (intent-hq/monorepo#1924). Updates are partial patches
 * whose order matters, so the failed write is retried in place (never
 * superseded); the last delay repeats until the write lands.
 *
 * The write goes through `settings.update` directly (like the model-selection
 * saga's `model.providerDefaults` write) because it THROWS on transport
 * failure — `setProviderSettings`'s `runMutation` wrapper folds transport
 * failures into the same `{ success: false }` a daemon-side rejection
 * produces, which would make them indistinguishable here. A structured daemon
 * error response (`isDaemonErrorResponse`) is a rejection of the payload and
 * is not retried; everything else is transient transport failure and is.
 */
export const PROVIDER_SETTINGS_RETRY_DELAYS_MS = [1_000, 5_000, 15_000] as const;

function* persistProviderSettingsQueue(
  updates: Channel<ProviderSettingsUpdate>,
  models: ModelQueue,
) {
  const sessionPicks: Record<string, string> = {};
  while (true) {
    const update = yield* take(updates);
    if (update.modelPick) {
      yield* call(persistModelUpdate, update, models, sessionPicks);
      continue;
    }
    try {
      const changes = yield* call(changesFor, update);
      let attempt = 0;
      while (changes.length) {
        try {
          yield* call([appClient.settings, appClient.settings.update], changes);
          if (update.enabledSeed) {
            for (const [providerId, enabled] of Object.entries(update.enabledSeed)) {
              if (enabled) yield* put(ensureEnabledIfUnset(providerId));
            }
          }
          if (update.path) {
            yield* put(providerPathSaved(update.path.providerId, update.path.value));
            yield* put(checkAllProvidersRequested(true));
          } else if (update.activeProviderId && update.request) {
            yield* put(reloadModelsForProvider());
          }
          if (update.request) {
            const current =
              !update.resource ||
              update.revision === (yield* selectProviderWriteRevision.effect(update.resource));
            yield* put(
              providerSettingsRequestSettled(update.request.id, current ? 'success' : 'cancelled'),
            );
          }
          yield* call(notifyOutcome, update, true);
          break;
        } catch (error) {
          if (update.path || update.enabledSeed || isDaemonErrorResponse(error)) throw error;
          logger.error('Failed to persist provider settings; retrying');
        }
        yield* delay(
          PROVIDER_SETTINGS_RETRY_DELAYS_MS[
            Math.min(attempt, PROVIDER_SETTINGS_RETRY_DELAYS_MS.length - 1)
          ],
        );
        attempt += 1;
      }
    } catch {
      logger.warn('Provider settings write failed');
      if (
        update.activeProviderId !== undefined &&
        update.revision === (yield* selectProviderWriteRevision.effect('default'))
      )
        yield* put(activeProviderPersistRejected(update.activeProviderId));
      if (update.enabledProviderDelta !== undefined)
        yield* put(
          enablementPersistRejected(update.enabledProviderDelta.providerId, update.revision),
        );
      if (update.request) yield* put(providerSettingsRequestSettled(update.request.id, 'failure'));
      yield* call(notifyOutcome, update, false);
    } finally {
      if ((yield* cancelled()) && update.request)
        yield* put(providerSettingsRequestSettled(update.request.id, 'cancelled'));
    }
  }
}

/** Sole ordered owner of provider settings writes, including whole-map migrations. */
export function* providerSettingsSaga() {
  const updates = channel<ProviderSettingsUpdate>(buffers.expanding());
  const models: ModelQueue = { changed: channel<boolean>(buffers.none()) };
  try {
    yield* all([
      call(persistProviderSettingsQueue, updates, models),
      takeEvery([setAtomicDefaultModel, setSelectedModel], queueModelWorker, updates, models),
      takeEvery(setActiveProvider, queueActiveProviderWorker, updates),
      takeEvery(toggleProvider, queueToggleProviderWorker, updates),
      takeEvery(setProviderEnabled, queueSetProviderEnabledWorker, updates),
      takeEvery(providerEnablementSeedRequested, queueSeedWorker, updates),
      takeEvery(providerPathSaveRequested, queuePathWorker, updates),
      call(providerSettingsReadSaga),
    ]);
  } finally {
    updates.close();
    models.changed.close();
    yield* put(providerSettingsStopped());
  }
}
