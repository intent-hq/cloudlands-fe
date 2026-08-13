import { buffers } from 'redux-saga';
import { actionChannel, call, fork, put, take } from 'typed-redux-saga';

import { autoUpdateClient } from '$features/auto-update/auto-update.client';
import { createLogger } from '$lib/utils/client-logger';
import { selectUpdateChannel } from '../user-preferences-selectors';
import { setUpdateChannel } from '../user-preferences-slice';

const logger = createLogger('UpdateChannelSaga');

export function* hydrateUpdateChannelWorker(suppressedActions?: WeakSet<object>) {
  try {
    const state = yield* call([autoUpdateClient, autoUpdateClient.getState]);
    const action = setUpdateChannel(state.channel);
    suppressedActions?.add(action);
    yield* put(action);
  } catch (error) {
    logger.warn('Failed to hydrate updateChannel from main process', { error });
  }
}

export function* persistUpdateChannelWorker() {
  const channel = yield* selectUpdateChannel.effect();
  try {
    yield* call([autoUpdateClient, autoUpdateClient.setChannel], channel);
  } catch (error) {
    logger.warn('Failed to apply update channel', { channel, error });
  }
}

function* watchUpdateChannelWrites(suppressedActions: WeakSet<object>) {
  const channel = yield* actionChannel([setUpdateChannel], buffers.sliding(1));
  try {
    while (true) {
      const action = (yield* take(channel)) as ReturnType<typeof setUpdateChannel>;
      if (suppressedActions.delete(action)) continue;
      yield* call(persistUpdateChannelWorker);
    }
  } finally {
    channel.close();
  }
}

/** Unregistered until the S20 middleware cutover. */
export function* updateChannelSaga() {
  const suppressedActions = new WeakSet<object>();
  yield* fork(watchUpdateChannelWrites, suppressedActions);
  yield* call(hydrateUpdateChannelWorker, suppressedActions);
}
