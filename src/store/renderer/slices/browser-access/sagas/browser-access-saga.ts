/**
 * Browser access requests: each action invokes the matching main-process
 * channel and settles with main's new state.
 */
import {
  all,
  call,
  cancelled,
  delay,
  put,
  take,
  takeEvery,
  type SagaGenerator,
} from 'typed-redux-saga';

import { canManageBrowserAccess } from '$lib/browser-access';

import {
  createBrowserAccessSignInCode,
  getBrowserAccessState,
  resetBrowserAccessKey,
  setBrowserAccessEnabled,
  setBrowserAccessPort,
} from '$lib/browser-access-ipc';
import type { BrowserAccessSignInCode, BrowserAccessState } from '$shared/types/browser-access';
import {
  createBrowserAccessSignInCodeRequested,
  loadBrowserAccessRequested,
  resetBrowserAccessKeyRequested,
  setBrowserAccessEnabledRequested,
  setBrowserAccessPortRequested,
} from '../browser-access-slice';
import {
  selectLabsBrowserAccessEnabled,
  selectUserPreferencesHydrated,
} from '../../user-preferences/user-preferences-selectors';
import { userPreferencesHydrated } from '../../user-preferences/user-preferences-slice';

/** Main registers its handlers shortly after the first window opens; retry briefly. */
const GATE_ATTEMPTS = 10;
const GATE_RETRY_MS = 1_000;

type RequestAction =
  | ReturnType<typeof loadBrowserAccessRequested>
  | ReturnType<typeof setBrowserAccessEnabledRequested>
  | ReturnType<typeof setBrowserAccessPortRequested>
  | ReturnType<typeof resetBrowserAccessKeyRequested>;

function* settle(
  action: RequestAction,
  request: () => Promise<BrowserAccessState>,
): SagaGenerator<void> {
  let settled = false;
  try {
    const result: BrowserAccessState = yield* call(request);
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

/**
 * Browser access is a Labs experiment. A server left on while the flag is off
 * (for example, enabled before the flag existed) would run where nobody can
 * see it, so once preferences load, turn it off.
 */
export function* enforceBrowserAccessLabsGate(): SagaGenerator<void> {
  if (!canManageBrowserAccess()) return;
  if (!(yield* selectUserPreferencesHydrated.effect())) yield* take(userPreferencesHydrated);
  if (yield* selectLabsBrowserAccessEnabled.effect()) return;
  for (let attempt = 0; attempt < GATE_ATTEMPTS; attempt++) {
    try {
      const state: BrowserAccessState = yield* call(getBrowserAccessState);
      if (state.enabled) yield* put(setBrowserAccessEnabledRequested(false));
      return;
    } catch {
      yield* delay(GATE_RETRY_MS);
    }
  }
}

function* createSignInCode(
  action: ReturnType<typeof createBrowserAccessSignInCodeRequested>,
): SagaGenerator<void> {
  try {
    const result: BrowserAccessSignInCode = yield* call(createBrowserAccessSignInCode);
    yield* put(action.success(result));
  } catch (error) {
    yield* put(action.failure(error instanceof Error ? error : new Error(String(error))));
  }
}

export function* browserAccessSaga(): SagaGenerator<void> {
  yield* all([
    call(enforceBrowserAccessLabsGate),
    takeEvery(loadBrowserAccessRequested, (action) => settle(action, getBrowserAccessState)),
    takeEvery(setBrowserAccessEnabledRequested, (action) =>
      settle(action, () => setBrowserAccessEnabled(action.payload[0])),
    ),
    takeEvery(setBrowserAccessPortRequested, (action) =>
      settle(action, () => setBrowserAccessPort(action.payload[0])),
    ),
    takeEvery(resetBrowserAccessKeyRequested, (action) => settle(action, resetBrowserAccessKey)),
    takeEvery(createBrowserAccessSignInCodeRequested, createSignInCode),
  ]);
}
