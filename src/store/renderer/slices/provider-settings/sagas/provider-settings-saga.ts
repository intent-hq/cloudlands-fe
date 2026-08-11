import { buffers, channel, type Channel } from 'redux-saga';
import { all, call, delay, put, take, takeEvery } from 'typed-redux-saga';

import { appClient, type AppSettingChange } from '$lib/client';
import { isDaemonErrorResponse } from '$lib/client/live/backend-transport-types';
import { createLogger } from '$lib/utils/client-logger';
import { resolveProviderEnabled } from '$shared/provider-catalog';
import { selectProviderCatalogEntry } from '../../provider-catalog/provider-catalog-selectors';
import { selectEnabledProviders } from '../provider-settings-selectors';
import { setActiveProvider, setProviderEnabled, toggleProvider } from '../provider-settings-slice';

const logger = createLogger('ProviderSettingsSaga');

type ProviderSettingsUpdate = {
  activeProviderId?: string;
  /**
   * Enablement is queued as the click's `{providerId, enabled}` delta, not a
   * map snapshot: `providers.enabled` is written as a full map, so the delta
   * is merged over the live map at write time. A boot settings hydration that
   * replaces the map between dispatch and write therefore cannot drop the
   * click's entry from the persisted value (monorepo#1986).
   */
  enabledProviderDelta?: { providerId: string; enabled: boolean };
};

/** Map a queued partial update to its §5.12 wire changes (PROTOCOL paths). */
function* changesFor(update: ProviderSettingsUpdate) {
  const changes: AppSettingChange[] = [];
  if (update.activeProviderId !== undefined) {
    changes.push({ path: 'providers.active', value: update.activeProviderId });
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
  if (providerId) yield* put(updates, { activeProviderId: providerId });
}

function* queueEnabledProviders(
  updates: Channel<ProviderSettingsUpdate>,
  providerId: string,
  enabled: boolean,
) {
  const provider = yield* selectProviderCatalogEntry.effect(providerId);
  if (provider && !provider.canBeDisabled) return;
  yield* put(updates, { enabledProviderDelta: { providerId, enabled } });
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
  yield* call(queueEnabledProviders, updates, providerId, enabled);
}

/**
 * Retry backoff for a provider-settings write that failed in transport.
 * During onboarding on a fresh install the daemon connection may still be
 * cycling, so dropping the write would leave `providers.active` stale on the
 * daemon — the onboarding model pick then resolves under the wrong provider
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

function* persistProviderSettingsQueue(updates: Channel<ProviderSettingsUpdate>) {
  while (true) {
    const update = yield* take(updates);
    const changes = yield* call(changesFor, update);
    if (changes.length === 0) continue;
    let attempt = 0;
    while (true) {
      try {
        yield* call([appClient.settings, appClient.settings.update], changes);
        break;
      } catch (error) {
        if (isDaemonErrorResponse(error)) {
          logger.warn('Daemon rejected provider settings write:', error);
          break;
        }
        logger.error('Failed to persist provider settings:', error);
      }
      yield* delay(
        PROVIDER_SETTINGS_RETRY_DELAYS_MS[
          Math.min(attempt, PROVIDER_SETTINGS_RETRY_DELAYS_MS.length - 1)
        ],
      );
      attempt += 1;
    }
  }
}

/** Unregistered until the S20 middleware cutover. */
export function* providerSettingsSaga() {
  const updates = channel<ProviderSettingsUpdate>(buffers.expanding());
  try {
    yield* all([
      call(persistProviderSettingsQueue, updates),
      takeEvery(setActiveProvider, queueActiveProviderWorker, updates),
      takeEvery(toggleProvider, queueToggleProviderWorker, updates),
      takeEvery(setProviderEnabled, queueSetProviderEnabledWorker, updates),
    ]);
  } finally {
    updates.close();
  }
}
