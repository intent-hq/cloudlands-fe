import { buffers } from 'redux-saga';
import { actionChannel, call, take } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { selectProviderCatalogEntry } from '../../provider-catalog/provider-catalog-selectors';
import { selectEnabledProviders } from '../provider-settings-selectors';
import { setActiveProvider, setProviderEnabled, toggleProvider } from '../provider-settings-slice';

const logger = createLogger('ProviderSettingsSaga');

type ProviderSettingsAction =
  | ReturnType<typeof setActiveProvider>
  | ReturnType<typeof toggleProvider>
  | ReturnType<typeof setProviderEnabled>;

export function* persistProviderSettingsWorker(action: ProviderSettingsAction) {
  try {
    if (action.type === setActiveProvider.type) {
      const providerId = (action as ReturnType<typeof setActiveProvider>).payload[0];
      if (!providerId) return;
      const result = yield* call([appClient.settings, appClient.settings.setProviderSettings], {
        activeProviderId: providerId,
      });
      if (!result.success) logger.warn('Failed to persist active provider:', result.error);
      return;
    }

    const providerId =
      action.type === toggleProvider.type
        ? (action as ReturnType<typeof toggleProvider>).payload[0]
        : (action as ReturnType<typeof setProviderEnabled>).payload[0].providerId;
    const provider = yield* selectProviderCatalogEntry.effect(providerId);
    if (provider && !provider.canBeDisabled) return;

    const enabledProviders = yield* selectEnabledProviders.effect();
    const result = yield* call([appClient.settings, appClient.settings.setProviderSettings], {
      enabledProviders: { ...enabledProviders },
    });
    if (!result.success) logger.warn('Failed to persist enabled providers:', result.error);
  } catch (error) {
    logger.error('Failed to persist provider settings:', error);
  }
}

/** Unregistered until the S20 middleware cutover. */
export function* providerSettingsSaga() {
  const channel = yield* actionChannel(
    [setActiveProvider, toggleProvider, setProviderEnabled],
    buffers.expanding(),
  );
  try {
    while (true) {
      const action = (yield* take(channel)) as ProviderSettingsAction;
      yield* call(persistProviderSettingsWorker, action);
    }
  } finally {
    channel.close();
  }
}
