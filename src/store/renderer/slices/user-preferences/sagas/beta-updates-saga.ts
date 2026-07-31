import { buffers } from 'redux-saga';
import { actionChannel, call, fork, put, take } from 'typed-redux-saga';

import { autoUpdateClient } from '$features/auto-update/auto-update.client';
import type { UpdateChannel } from '$features/auto-update/types';
import { createLogger } from '$lib/utils/client-logger';
import { selectBetaUpdatesEnabled } from '../user-preferences-selectors';
import { setBetaUpdatesEnabled, toggleBetaUpdates } from '../user-preferences-slice';

const logger = createLogger('BetaUpdatesSaga');

type BetaUpdatesAction =
  ReturnType<typeof setBetaUpdatesEnabled> | ReturnType<typeof toggleBetaUpdates>;

export function* hydrateBetaUpdatesWorker(suppressedActions?: WeakSet<object>) {
  try {
    const state = yield* call([autoUpdateClient, autoUpdateClient.getState]);
    const action = setBetaUpdatesEnabled(state.channel === 'beta');
    suppressedActions?.add(action);
    yield* put(action);
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

function* watchBetaUpdateWrites(suppressedActions: WeakSet<object>) {
  const channel = yield* actionChannel(
    [setBetaUpdatesEnabled, toggleBetaUpdates],
    buffers.sliding(1),
  );
  try {
    while (true) {
      const action = (yield* take(channel)) as BetaUpdatesAction;
      if (suppressedActions.delete(action)) continue;
      yield* call(persistBetaUpdatesWorker);
    }
  } finally {
    channel.close();
  }
}

/** Unregistered until the S20 middleware cutover. */
export function* betaUpdatesSaga() {
  const suppressedActions = new WeakSet<object>();
  yield* fork(watchBetaUpdateWrites, suppressedActions);
  yield* call(hydrateBetaUpdatesWorker, suppressedActions);
}
