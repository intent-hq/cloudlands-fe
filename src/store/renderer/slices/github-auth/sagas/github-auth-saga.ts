import { githubAuthClient } from '$features/github-auth/renderer/github-auth.client';
import type { GitHubDeviceFlow, GitHubUser } from '$features/github-auth/types';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import {
  call,
  delay,
  put,
  race,
  take,
  takeEvery,
  takeLatest,
  type SagaGenerator,
} from 'typed-redux-saga';

import { selectGitHubAuthDeviceFlow } from '../github-auth-selectors';
import { authCancelled, authCompleted, cancelGitHubAuth, checkGitHubAuthStatus, githubAuthChanged, initializeGitHubAuth, logoutCompleted, logoutGitHub, setAuthenticating, setDeviceFlowInfo, setGitHubAuthError, setGitHubAuthState, setOAuthInfo, startGitHubAuth } from '../github-auth-slice';

const logger = createLogger('GitHubAuthSaga');
export const AUTH_POLL_INTERVAL_MS = 5_000;
export const AUTH_POLL_TIMEOUT_MS = 900_000;

function validPendingFlow(value: GitHubDeviceFlow | null | undefined): value is GitHubDeviceFlow {
  return value?.status === 'pending' && Boolean(value.userCode) && Boolean(value.verificationUri)
    && Number.isFinite(value.expiresIn) && Number.isFinite(value.interval);
}

function mapUser(source: GitHubUser | null): GitHubUser | null {
  if (source === null) return null;
  return {
    login: source.login,
    name: source.name,
    email: source.email,
    avatar_url: source.avatar_url,
  };
}

function* checkAuthComplete(): SagaGenerator<boolean> {
  try {
    const result: Awaited<ReturnType<typeof githubAuthClient.checkAuthComplete>> = yield* call(
      [githubAuthClient, githubAuthClient.checkAuthComplete],
    );
    if (result.success && result.data?.isComplete) {
      yield* put(authCompleted(mapUser(result.data.user ?? null)));
      return true;
    }
  } catch (error) {
    logger.error('Auth completion check failed', error);
  }
  return false;
}

function* pollForCompletion(intervalMs: number): SagaGenerator<void> {
  const startedAt = Date.now();
  if (yield* call(checkAuthComplete)) return;
  while (true) {
    yield* delay(intervalMs);
    if (Date.now() - startedAt > AUTH_POLL_TIMEOUT_MS) {
      yield* put(setGitHubAuthError(m.githubAuth_service_timedOut_error()));
      return;
    }
    if (yield* call(checkAuthComplete)) return;
  }
}

function* pollDeviceFlowWorker(
  action: ReturnType<typeof setDeviceFlowInfo>,
): SagaGenerator<void> {
  const [flow] = action.payload;
  if (flow === null) return;
  yield* race({
    completed: call(
      pollForCompletion,
      Math.max(flow.interval * 1_000, AUTH_POLL_INTERVAL_MS),
    ),
    cancelled: take([cancelGitHubAuth, logoutGitHub, githubAuthChanged]),
  });
}

function* initialize(): SagaGenerator<void> {
  try {
    const state: Awaited<ReturnType<typeof githubAuthClient.getAuthState>> = yield* call(
      [githubAuthClient, githubAuthClient.getAuthState],
    );
    yield* put(setGitHubAuthState({
      isAuthenticated: state.isAuthenticated,
      requiresDaemonAuth: state.requiresDaemonAuth,
      user: mapUser(state.user),
      needsScopeUpdate: state.needsScopeUpdate ?? false,
      oauthUrl: state.oauthUrl ?? null,
    }));
    if (!state.isAuthenticated && validPendingFlow(state.deviceFlow)) {
      yield* put(setAuthenticating(true));
      yield* put(setDeviceFlowInfo({
        userCode: state.deviceFlow.userCode,
        verificationUri: state.deviceFlow.verificationUri,
        expiresIn: state.deviceFlow.expiresIn,
        interval: state.deviceFlow.interval,
      }));
      return;
    }
    const currentFlow = yield* selectGitHubAuthDeviceFlow.effect();
    if (currentFlow !== null) {
      yield* put(setDeviceFlowInfo(null));
      yield* put(setAuthenticating(false));
    }
  } catch (error) {
    logger.error('Failed to initialize GitHub auth', error);
  }
}

function* start(): SagaGenerator<void> {
  yield* put(setAuthenticating(true));
  try {
    const result: Awaited<ReturnType<typeof githubAuthClient.startAuth>> = yield* call(
      [githubAuthClient, githubAuthClient.startAuth],
    );
    if (!result.success) {
      yield* put(setGitHubAuthError(result.error || m.githubAuth_service_startFailed_error()));
      return;
    }
    if (result.alreadyAuthenticated) {
      yield* put(setOAuthInfo(null, result.needsScopeUpdate ?? false));
      yield* put(authCompleted(null));
      return;
    }
    const { userCode, verificationUri, expiresIn, interval } = result;
    if (!userCode || !verificationUri || typeof expiresIn !== 'number' || typeof interval !== 'number') {
      yield* put(setGitHubAuthError(m.githubAuth_service_deviceFlowFailed_error()));
      return;
    }
    yield* put(setOAuthInfo(result.oauthUrl ?? null, result.needsScopeUpdate ?? false));
    yield* put(setDeviceFlowInfo({ userCode, verificationUri, expiresIn, interval }));
  } catch (error) {
    const message = error instanceof Error ? error.message : m.githubAuth_service_unknown_error();
    yield* put(setGitHubAuthError(message.includes('Unauthorized channel')
      ? m.githubAuth_service_ipcBlocked_error()
      : message));
  }
}

function* cancelAuth(): SagaGenerator<void> {
  try {
    const result: Awaited<ReturnType<typeof githubAuthClient.cancelAuth>> = yield* call(
      [githubAuthClient, githubAuthClient.cancelAuth],
    );
    if (result.success) yield* put(authCancelled());
    else yield* put(setGitHubAuthError(result.error || m.githubAuth_service_cancelFailed_error()));
  } catch (error) {
    logger.error('Failed to cancel GitHub auth', error);
    yield* put(setGitHubAuthError(m.githubAuth_service_cancelFailed_error()));
  }
}

function* logout(): SagaGenerator<void> {
  try {
    const result: Awaited<ReturnType<typeof githubAuthClient.logout>> = yield* call(
      [githubAuthClient, githubAuthClient.logout],
    );
    if (result.success) yield* put(logoutCompleted());
    else yield* put(setGitHubAuthError(result.error || m.githubAuth_service_logoutFailed_error()));
  } catch (error) {
    logger.error('Failed to log out of GitHub', error);
    yield* put(setGitHubAuthError(m.githubAuth_service_logoutFailed_error()));
  }
}

function* authChanged(
  status: ReturnType<typeof githubAuthChanged>['payload'][0],
): SagaGenerator<void> {
  if (status === 'authorized') {
    let user: GitHubUser | null = null;
    try {
      const source: GitHubUser | null = yield* call([githubAuthClient, githubAuthClient.getUser]);
      user = mapUser(source);
    } catch (error) {
      logger.error('Failed to read GitHub user after authorization', error);
    }
    yield* put(authCompleted(user));
    if (user === null) yield* call(initialize);
    return;
  }
  if (status === 'revoked') yield* put(logoutCompleted());
  else if (status === 'expired') yield* put(setGitHubAuthError(m.githubAuth_service_codeExpired_error()));
  else if (status === 'denied') yield* put(setGitHubAuthError(m.githubAuth_service_denied_error()));
  else yield* put(setGitHubAuthError(m.githubAuth_service_failed_error()));
}

function* initializeGitHubAuthWorker(
  _action: ReturnType<typeof initializeGitHubAuth>,
): SagaGenerator<void> {
  yield* call(initialize);
}

function* startGitHubAuthWorker(
  _action: ReturnType<typeof startGitHubAuth>,
): SagaGenerator<void> {
  yield* call(start);
}

function* checkGitHubAuthStatusWorker(
  _action: ReturnType<typeof checkGitHubAuthStatus>,
): SagaGenerator<void> {
  yield* call(checkAuthComplete);
}

function* cancelGitHubAuthWorker(
  _action: ReturnType<typeof cancelGitHubAuth>,
): SagaGenerator<void> {
  yield* call(cancelAuth);
}

function* logoutGitHubWorker(
  _action: ReturnType<typeof logoutGitHub>,
): SagaGenerator<void> {
  yield* call(logout);
}

function* githubAuthChangedWorker(
  action: ReturnType<typeof githubAuthChanged>,
): SagaGenerator<void> {
  yield* call(authChanged, action.payload[0]);
}

export function* githubAuthSaga(): SagaGenerator<void> {
  yield* takeEvery(initializeGitHubAuth, initializeGitHubAuthWorker);
  yield* takeEvery(startGitHubAuth, startGitHubAuthWorker);
  yield* takeEvery(checkGitHubAuthStatus, checkGitHubAuthStatusWorker);
  yield* takeEvery(cancelGitHubAuth, cancelGitHubAuthWorker);
  yield* takeEvery(logoutGitHub, logoutGitHubWorker);
  yield* takeEvery(githubAuthChanged, githubAuthChangedWorker);
  yield* takeLatest(setDeviceFlowInfo, pollDeviceFlowWorker);
}