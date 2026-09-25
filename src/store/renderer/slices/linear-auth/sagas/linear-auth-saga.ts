import { linearAuthClient } from '$features/linear-auth/renderer/linear-auth.client';
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { buffers } from 'redux-saga';
import {
  actionChannel,
  call,
  cancelled,
  fork,
  put,
  race,
  take,
  takeLatest,
  type SagaGenerator,
} from 'typed-redux-saga';
import { selectLinearAuthOperation } from '../linear-auth-selectors';

import {
  connectLinear,
  cancelLinearAuth,
  consumeLinearAuth,
  initializeLinearAuth,
  logoutLinear,
  setLinearAuthState,
  setLinearError,
  settleLinearAuth,
  startLinearAuth,
} from '../linear-auth-slice';

const logger = createLogger('LinearAuthSaga');
const LINEAR_TOKEN_SETTING_PATH = 'linear.token';

function* probe(): SagaGenerator<void> {
  try {
    const state: Awaited<ReturnType<typeof linearAuthClient.getAuthState>> = yield* call(
      [linearAuthClient, linearAuthClient.getAuthState],
      true,
    );
    yield* put(setLinearAuthState(state.isAuthenticated, state.requiresDaemonAuth, null));
  } catch (error) {
    logger.error('Failed to initialize Linear auth', error);
  }
}

function* isCurrent(requestId: string): SagaGenerator<boolean> {
  const operation = yield* selectLinearAuthOperation.effect();
  return operation?.requestId === requestId && operation.status === 'pending';
}

function* connect(apiKey: string, requestId: string): SagaGenerator<boolean> {
  const key = apiKey.trim();
  if (!key) {
    yield* put(setLinearError(m.linearAuth_service_enterApiKey_error()));
    return false;
  }
  try {
    yield* call(
      [appClient.settings, appClient.settings.update],
      [{ path: LINEAR_TOKEN_SETTING_PATH, value: key }],
    );
    const state: Awaited<ReturnType<typeof linearAuthClient.getAuthState>> = yield* call(
      [linearAuthClient, linearAuthClient.getAuthState],
      true,
    );
    yield* put(setLinearAuthState(state.isAuthenticated, false, null));
    if (!state.isAuthenticated && (yield* call(isCurrent, requestId)))
      yield* put(setLinearError(m.linearAuth_service_keyRejected_error()));
    return state.isAuthenticated;
  } catch (error) {
    if (yield* call(isCurrent, requestId))
      yield* put(
        setLinearError(
          error instanceof Error ? error.message : m.linearAuth_service_storeKeyFailed_error(),
        ),
      );
    logger.error('Failed to connect Linear auth', error);
    return false;
  }
}

function* logout(requestId: string): SagaGenerator<boolean> {
  try {
    yield* call([appClient.settings, appClient.settings.reset], LINEAR_TOKEN_SETTING_PATH);
  } catch (error) {
    if (yield* call(isCurrent, requestId))
      yield* put(
        setLinearError(
          error instanceof Error ? error.message : m.linearAuth_service_clearKeyFailed_error(),
        ),
      );
    logger.error('Failed to clear Linear auth', error);
    return false;
  }
  try {
    const state: Awaited<ReturnType<typeof linearAuthClient.getAuthState>> = yield* call(
      [linearAuthClient, linearAuthClient.getAuthState],
      true,
    );
    yield* put(setLinearAuthState(state.isAuthenticated, state.requiresDaemonAuth, null));
    if (state.isAuthenticated && (yield* call(isCurrent, requestId)))
      yield* put(setLinearError(m.linearAuth_service_envKeyStillActive_error()));
    return !state.isAuthenticated;
  } catch {
    yield* put(setLinearAuthState(false, false, null));
    return true;
  }
}

function* probeWorker(): SagaGenerator<void> {
  const operation = yield* selectLinearAuthOperation.effect();
  if (operation?.status === 'pending') return;
  yield* race({
    probe: call(probe),
    // Consumption can allow another probe while the physical write still runs.
    // Its settlement invalidates that read even when no consumer remains.
    invalidated: take([
      connectLinear,
      logoutLinear,
      cancelLinearAuth,
      consumeLinearAuth,
      settleLinearAuth,
    ]),
  });
}

function* mutations(): SagaGenerator<void> {
  // Credential writes cannot be aborted on the wire. Drain each write before
  // starting its successor and reconcile shared auth even if its consumer left.
  // Only errors and operation outcomes belong to the still-current request.
  const requests = yield* actionChannel([connectLinear, logoutLinear], buffers.expanding());
  try {
    while (true) {
      const action: ReturnType<typeof connectLinear> | ReturnType<typeof logoutLinear> =
        yield* take(requests);
      const { requestId } = action.payload.request;
      if (!(yield* call(isCurrent, requestId))) continue;
      try {
        const connectRequest =
          'apiKey' in action.payload ? (action as ReturnType<typeof connectLinear>).payload : null;
        const success = connectRequest
          ? yield* call(connect, connectRequest.apiKey, requestId)
          : yield* call(logout, requestId);
        yield* put(settleLinearAuth(requestId, success ? 'succeeded' : 'failed'));
      } finally {
        if (yield* cancelled()) yield* put(settleLinearAuth(requestId, 'cancelled'));
      }
    }
  } finally {
    requests.close();
    const operation = yield* selectLinearAuthOperation.effect();
    if (operation?.status === 'pending')
      yield* put(settleLinearAuth(operation.requestId, 'cancelled'));
  }
}

export function* linearAuthSaga(): SagaGenerator<void> {
  yield* fork(mutations);
  yield* takeLatest([initializeLinearAuth, startLinearAuth], probeWorker);
}
