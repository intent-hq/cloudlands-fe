import { settleBackgroundSettings } from './settle-background-settings';
import { settingsChangesReceived } from '../../settings-events/settings-events-slice';
import { backgroundSettingsWriteLock } from './background-settings-write-lock';
import { buffers } from 'redux-saga';
import { actionChannel, call, put, take, takeEvery } from 'typed-redux-saga';

import { m } from '$shared/paraglide/messages.js';
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { selectBgSettings } from '../background-agent-settings-selectors';
import { backgroundSettingsChanges } from '../background-agent-settings-persistence';
import {
  clearTypeOverride,
  setDefaultReasoningEffort,
  setTypeReasoningEffortOverride,
  setTypeReasoningEffortOverrides,
  backgroundProviderSwitchBlocked,
  resetTypeOverride,
  resetSettings,
  setDefaultModel,
  setTypeOverride,
} from '../background-agent-settings-slice';

const logger = createLogger('BackgroundAgentSettingsSaga');

function* persistBackgroundAgentSettingsWorker() {
  yield* take(backgroundSettingsWriteLock);
  const settings = yield* selectBgSettings.effect();
  try {
    const changes = backgroundSettingsChanges(settings);
    if (settings.providerId)
      changes.unshift({ path: 'model.defaultProvider', value: settings.providerId });
    const result = appClient.settings.updateSnapshot
      ? yield* call([appClient.settings, appClient.settings.updateSnapshot], changes)
      : {
          applied: yield* call([appClient.settings, appClient.settings.update], changes),
          revision: 0,
        };
    yield* call(
      settleBackgroundSettings,
      {
        revision: result.revision,
        generation: settings.persistenceGeneration ?? 0,
        providerId: settings.providerId,
      },
      settings,
      result.applied,
    );
    if (appClient.settings.updateSnapshot)
      yield* put(
        settingsChangesReceived(
          [
            ...changes.filter((change) => !result.applied.some(({ path }) => path === change.path)),
            ...result.applied,
          ],
          result.revision,
        ),
      );
  } catch (error) {
    logger.error('Failed to persist background agent settings:', error);
    yield* call(settleBackgroundSettings, {
      generation: settings.persistenceGeneration ?? 0,
      providerId: settings.providerId,
    });
  } finally {
    yield* put(backgroundSettingsWriteLock, true);
  }
}

async function showProviderSwitchBlocked(
  action: ReturnType<typeof backgroundProviderSwitchBlocked>,
) {
  try {
    const { notify } = await import('$lib/components/patterns/notify');
    notify.error(m.settings_backgroundAgent_legacySwitch_error({ provider: action.payload[0] }));
  } catch (error) {
    logger.error('Failed to show blocked provider switch:', error);
  }
}

/** Unregistered until the S20 middleware cutover. */
export function* backgroundAgentSettingsSaga() {
  yield* takeEvery(backgroundProviderSwitchBlocked, showProviderSwitchBlocked);
  const channel = yield* actionChannel(
    [
      setDefaultModel,
      setTypeOverride,
      clearTypeOverride,
      resetSettings,
      setDefaultReasoningEffort,
      setTypeReasoningEffortOverride,
      setTypeReasoningEffortOverrides,
      resetTypeOverride,
    ],
    buffers.sliding(1),
  );
  try {
    while (true) {
      yield* take(channel);
      yield* call(persistBackgroundAgentSettingsWorker);
    }
  } finally {
    channel.close();
  }
}
