import { settingsChangesReceived } from '../../settings-events/settings-events-slice';
import { backgroundSettingsWriteLock } from './background-settings-write-lock';
import { buffers } from 'redux-saga';
import { actionChannel, call, put, take } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { selectBgSettings } from '../background-agent-settings-selectors';
import { backgroundSettingsChanges } from '../background-agent-settings-persistence';
import {
  backgroundSettingsSaveSettled,
  clearTypeOverride,
  setDefaultReasoningEffort,
  setTypeReasoningEffortOverride,
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
    yield* put(
      backgroundSettingsSaveSettled({
        generation: settings.persistenceGeneration ?? 0,
        providerId: settings.providerId,
      }),
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
    yield* put(
      backgroundSettingsSaveSettled({
        generation: settings.persistenceGeneration ?? 0,
        providerId: settings.providerId,
      }),
    );
  } finally {
    yield* put(backgroundSettingsWriteLock, true);
  }
}

/** Unregistered until the S20 middleware cutover. */
export function* backgroundAgentSettingsSaga() {
  const channel = yield* actionChannel(
    [
      setDefaultModel,
      setTypeOverride,
      clearTypeOverride,
      resetSettings,
      setDefaultReasoningEffort,
      setTypeReasoningEffortOverride,
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
