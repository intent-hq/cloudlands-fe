import { buffers, channel, type Channel } from 'redux-saga';
import { all, call, delay, put, take, takeEvery } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { selectProviderCatalogEntry } from '../../provider-catalog/provider-catalog-selectors';
import { selectEnabledProviders } from '../provider-settings-selectors';
import { setActiveProvider, setProviderEnabled, toggleProvider } from '../provider-settings-slice';

const logger = createLogger('ProviderSettingsSaga');

type ProviderSettingsUpdate = Parameters<typeof appClient.settings.setProviderSettings>[0];

function* queueActiveProviderWorker(
  updates: Channel<ProviderSettingsUpdate>,
  action: ReturnType<typeof setActiveProvider>,
) {
  const providerId = action.payload[0];
  if (providerId) yield* put(updates, { activeProviderId: providerId });
}

function* queueEnabledProviders(updates: Channel<ProviderSettingsUpdate>, providerId: string) {
  const provider = yield* selectProviderCatalogEntry.effect(providerId);
  if (provider && !provider.canBeDisabled) return;
  const enabledProviders = yield* selectEnabledProviders.effect();
  yield* put(updates, { enabledProviders: { ...enabledProviders } });
}

function* queueToggleProviderWorker(
  updates: Channel<ProviderSettingsUpdate>,
  action: ReturnType<typeof toggleProvider>,
) {
  yield* call(queueEnabledProviders, updates, action.payload[0]);
}

function* queueSetProviderEnabledWorker(
  updates: Channel<ProviderSettingsUpdate>,
  action: ReturnType<typeof setProviderEnabled>,
) {
  yield* call(queueEnabledProviders, updates, action.payload[0].providerId);
}

/**
 * Retry backoff for a provider-settings write that failed in transport.
 * During onboarding on a fresh install the daemon connection may still be
 * cycling, so dropping the write would leave `providers.active` stale on the
 * daemon — the onboarding model pick then resolves under the wrong provider
 * key after restart (intent-hq/monorepo#1924). Updates are partial patches
 * whose order matters, so the failed write is retried in place (never
 * superseded); the last delay repeats until the write lands. A structured
 * `{ success: false }` is a daemon-side rejection and is not retried.
 */
export const PROVIDER_SETTINGS_RETRY_DELAYS_MS = [1_000, 5_000, 15_000] as const;

function* persistProviderSettingsQueue(updates: Channel<ProviderSettingsUpdate>) {
  while (true) {
    const update = yield* take(updates);
    let attempt = 0;
    while (true) {
      try {
        const result = yield* call([appClient.settings, appClient.settings.setProviderSettings], {
          ...update,
        });
        if (!result.success) logger.warn('Failed to persist provider settings:', result.error);
        break;
      } catch (error) {
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
