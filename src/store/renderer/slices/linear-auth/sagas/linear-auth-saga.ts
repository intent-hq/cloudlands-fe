import { linearAuthClient } from '$features/linear-auth/renderer/linear-auth.client';
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { call, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import {
  connectLinear,
  initializeLinearAuth,
  logoutLinear,
  refreshLinearAuth,
  setLinearAuthState,
  setLinearError,
  setLinearIsAuthenticating,
  startLinearAuth,
} from '../linear-auth-slice';

const logger = createLogger('LinearAuthSaga');
export const LINEAR_TOKEN_SETTING_PATH = 'linear.token';

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

function* connect(apiKey: string): SagaGenerator<void> {
  const key = apiKey.trim();
  if (!key) {
    yield* put(setLinearError(m.linearAuth_service_enterApiKey_error()));
    return;
  }
  yield* put(setLinearError(null));
  yield* put(setLinearIsAuthenticating(true));
  try {
    yield* call([appClient.settings, appClient.settings.update], [
      { path: LINEAR_TOKEN_SETTING_PATH, value: key },
    ]);
    const state: Awaited<ReturnType<typeof linearAuthClient.getAuthState>> = yield* call(
      [linearAuthClient, linearAuthClient.getAuthState],
      true,
    );
    yield* put(setLinearAuthState(state.isAuthenticated, false, null));
    if (!state.isAuthenticated) yield* put(setLinearError(m.linearAuth_service_keyRejected_error()));
  } catch (error) {
    yield* put(setLinearError(
      error instanceof Error ? error.message : m.linearAuth_service_storeKeyFailed_error(),
    ));
    logger.error('Failed to connect Linear auth', error);
  } finally {
    yield* put(setLinearIsAuthenticating(false));
  }
}

function* logout(): SagaGenerator<void> {
  try {
    yield* call([appClient.settings, appClient.settings.reset], LINEAR_TOKEN_SETTING_PATH);
  } catch (error) {
    yield* put(setLinearError(
      error instanceof Error ? error.message : m.linearAuth_service_clearKeyFailed_error(),
    ));
    logger.error('Failed to clear Linear auth', error);
    return;
  }
  try {
    const state: Awaited<ReturnType<typeof linearAuthClient.getAuthState>> = yield* call(
      [linearAuthClient, linearAuthClient.getAuthState],
      true,
    );
    yield* put(setLinearAuthState(state.isAuthenticated, state.requiresDaemonAuth, null));
    if (state.isAuthenticated) yield* put(setLinearError(m.linearAuth_service_envKeyStillActive_error()));
  } catch {
    yield* put(setLinearAuthState(false, false, null));
  }
}

function* initializeLinearWorker(
  _action: ReturnType<typeof initializeLinearAuth>,
): SagaGenerator<void> {
  yield* call(probe);
}

function* refreshLinearWorker(
  _action: ReturnType<typeof refreshLinearAuth>,
): SagaGenerator<void> {
  yield* call(probe);
}

function* startLinearWorker(
  _action: ReturnType<typeof startLinearAuth>,
): SagaGenerator<void> {
  yield* call(probe);
}

function* connectLinearWorker(
  action: ReturnType<typeof connectLinear>,
): SagaGenerator<void> {
  yield* call(connect, action.payload[0]);
}

function* logoutLinearWorker(
  _action: ReturnType<typeof logoutLinear>,
): SagaGenerator<void> {
  yield* call(logout);
}

export function* linearAuthSaga(): SagaGenerator<void> {
  yield* takeEvery(initializeLinearAuth, initializeLinearWorker);
  yield* takeEvery(refreshLinearAuth, refreshLinearWorker);
  yield* takeEvery(startLinearAuth, startLinearWorker);
  yield* takeEvery(connectLinear, connectLinearWorker);
  yield* takeEvery(logoutLinear, logoutLinearWorker);
}