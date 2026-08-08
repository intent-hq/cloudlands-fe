import { buffers } from 'redux-saga';
import { actionChannel, call, fork, put, take } from 'typed-redux-saga';

import { autoUpdateClient } from '$features/auto-update/auto-update.client';
import type { UpdateChannel } from '$features/auto-update/types';
import { createLogger } from '$lib/utils/client-logger';
import { selectBetaUpdatesEnabled } from '../user-preferences-selectors';
import {
  loadBetaUpdatesSettings,
  setBetaUpdatesEnabled,
  toggleBetaUpdates,
} from '../user-preferences-slice';

const logger = createLogger('BetaUpdatesSaga');

export function* hydrateBetaUpdatesWorker() {
  try {
    const state = yield* call([autoUpdateClient, autoUpdateClient.getState]);
    yield* put(loadBetaUpdatesSettings(state.channel === 'beta'));
  } catch (error) {
    logger.warn('Failed to hydrate betaUpdatesEnabled from main process', { error });
  }
}

export function* persistBetaUpdatesWorker() {
  const enabled = yield* selectBetaUpdatesEnabled.effect();
  const channel: UpdateChannel = enabled ? 'beta' : 'stable';
  try {
    yield* call([autoUpdateClient, autoUpdateClient.setChannel], channel);
  } catch (error) {
    logger.warn('Failed to apply update channel', { enabled, error });
  }
}

function* watchBetaUpdateWrites() {
  const channel = yield* actionChannel(
    [setBetaUpdatesEnabled, toggleBetaUpdates],
    buffers.sliding(1),
  );
  try {
    while (true) {
      yield* take(channel);
      yield* call(persistBetaUpdatesWorker);
    }
  } finally {
    channel.close();
  }
}

export function* betaUpdatesSaga() {
  yield* fork(watchBetaUpdateWrites);
  yield* call(hydrateBetaUpdatesWorker);
}
