import { buffers } from 'redux-saga';
import { actionChannel, call, take } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import {
  selectBgDefaultModel,
  selectBgTypeOverrides,
} from '../background-agent-settings-selectors';
import {
  clearTypeOverride,
  resetSettings,
  setDefaultModel,
  setTypeOverride,
} from '../background-agent-settings-slice';

const logger = createLogger('BackgroundAgentSettingsSaga');

export function* persistBackgroundAgentSettingsWorker() {
  const defaultModel = yield* selectBgDefaultModel.effect();
  const typeOverrides = yield* selectBgTypeOverrides.effect();
  try {
    yield* call(
      [appClient.settings, appClient.settings.update],
      [
        { path: 'backgroundAgents.defaultModel', value: defaultModel },
        { path: 'backgroundAgents.typeOverrides', value: { ...typeOverrides } },
      ],
    );
  } catch (error) {
    logger.error('Failed to persist background agent settings:', error);
  }
}

/** Unregistered until the S20 middleware cutover. */
export function* backgroundAgentSettingsSaga() {
  const channel = yield* actionChannel(
    [setDefaultModel, setTypeOverride, clearTypeOverride, resetSettings],
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
