/**
 * Browser access requests: each action invokes the matching main-process
 * channel and settles with main's new state.
 */
import { all, call, cancelled, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { invokeBrowserAccess } from '$lib/browser-access-ipc';
import { BROWSER_ACCESS_CHANNELS } from '$shared/ipc/channels';
import type { BrowserAccessState } from '$shared/types/browser-access';
import {
  loadBrowserAccessRequested,
  resetBrowserAccessKeyRequested,
  setBrowserAccessEnabledRequested,
  setBrowserAccessPortRequested,
} from '../browser-access-slice';

type RequestAction =
  | ReturnType<typeof loadBrowserAccessRequested>
  | ReturnType<typeof setBrowserAccessEnabledRequested>
  | ReturnType<typeof setBrowserAccessPortRequested>
  | ReturnType<typeof resetBrowserAccessKeyRequested>;

function* settle(
  action: RequestAction,
  channel: string,
  payload: Record<string, unknown>,
): SagaGenerator<void> {
  let settled = false;
  try {
    const result: BrowserAccessState = yield* call(invokeBrowserAccess, channel, payload);
    yield* put(action.success(result));
    settled = true;
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error('Browser access request was cancelled')));
    }
  }
}

export function* browserAccessSaga(): SagaGenerator<void> {
  yield* all([
    takeEvery(loadBrowserAccessRequested, (action) =>
      settle(action, BROWSER_ACCESS_CHANNELS.GET_STATE, {}),
    ),
    takeEvery(setBrowserAccessEnabledRequested, (action) =>
      settle(action, BROWSER_ACCESS_CHANNELS.SET_ENABLED, { enabled: action.payload[0] }),
    ),
    takeEvery(setBrowserAccessPortRequested, (action) =>
      settle(action, BROWSER_ACCESS_CHANNELS.SET_PORT, { port: action.payload[0] }),
    ),
    takeEvery(resetBrowserAccessKeyRequested, (action) =>
      settle(action, BROWSER_ACCESS_CHANNELS.RESET_KEY, {}),
    ),
  ]);
}
