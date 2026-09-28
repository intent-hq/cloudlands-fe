import { buffers } from 'redux-saga';
import { actionChannel, call, take } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { selectBgSettings } from '../background-agent-settings-selectors';
import { backgroundSettingsChanges } from '../background-agent-settings-persistence';
import {
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
  const settings = yield* selectBgSettings.effect();
  try {
    yield* call(
      [appClient.settings, appClient.settings.update],
      backgroundSettingsChanges(settings),
    );
  } catch (error) {
    logger.error('Failed to persist background agent settings:', error);
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
