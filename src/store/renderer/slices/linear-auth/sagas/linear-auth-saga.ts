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

function* command(action: { type: string; payload: unknown }): SagaGenerator<void> {
  if (action.type === connectLinear.type) {
    const [apiKey] = action.payload as ReturnType<typeof connectLinear>['payload'];
    yield* call(connect, apiKey);
  } else if (action.type === logoutLinear.type) {
    yield* call(logout);
  } else {
    yield* call(probe);
  }
}

export function* linearAuthSaga(): SagaGenerator<void> {
  yield* takeEvery(initializeLinearAuth, command);
  yield* takeEvery(refreshLinearAuth, command);
  yield* takeEvery(startLinearAuth, command);
  yield* takeEvery(connectLinear, command);
  yield* takeEvery(logoutLinear, command);
}