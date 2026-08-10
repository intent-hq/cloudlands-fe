import type { Task } from 'redux-saga';
import { githubAuthClient } from '$features/github-auth/renderer/github-auth.client';
import type { GitHubDeviceFlow, GitHubUser } from '$features/github-auth/types';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import {
  call,
  cancel,
  delay,
  fork,
  put,
  take,
  type SagaGenerator,
} from 'typed-redux-saga';

import { selectGitHubAuthDeviceFlow } from '../github-auth-selectors';
import {
  authCancelled,
  authCompleted,
  cancelGitHubAuth,
  checkGitHubAuthStatus,
  githubAuthChanged,
  initializeGitHubAuth,
  logoutCompleted,
  logoutGitHub,
  refreshGitHubAuth,
  setAuthenticating,
  setDeviceFlowInfo,
  setGitHubAuthError,
  setGitHubAuthState,
  setOAuthInfo,
  startGitHubAuth,
} from '../github-auth-slice';

const logger = createLogger('GitHubAuthSaga');
export const AUTH_POLL_INTERVAL_MS = 5_000;
export const AUTH_POLL_TIMEOUT_MS = 900_000;
type PollSlot = { task?: Task; token?: symbol };

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

function* cancelPoll(slot: PollSlot): SagaGenerator<void> {
  const task = slot.task;
  slot.task = undefined;
  slot.token = undefined;
  if (task) yield* cancel(task);
}

function* startPoll(slot: PollSlot, intervalMs: number): SagaGenerator<void> {
  yield* call(cancelPoll, slot);
  const token = Symbol('github-auth-poll');
  slot.token = token;
  const task = yield* fork(function* () {
    try {
      yield* call(pollForCompletion, intervalMs);
    } finally {
      if (slot.token === token) {
        slot.task = undefined;
        slot.token = undefined;
      }
    }
  });
  if (slot.token === token) slot.task = task;
}

function* initialize(slot: PollSlot): SagaGenerator<void> {
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
      yield* call(
        startPoll,
        slot,
        Math.max(state.deviceFlow.interval * 1_000, AUTH_POLL_INTERVAL_MS),
      );
      return;
    }
    const currentFlow = yield* selectGitHubAuthDeviceFlow.effect();
    if (currentFlow !== null) {
      yield* call(cancelPoll, slot);
      yield* put(setDeviceFlowInfo(null));
      yield* put(setAuthenticating(false));
    }
  } catch (error) {
    logger.error('Failed to initialize GitHub auth', error);
  }
}

function* start(slot: PollSlot): SagaGenerator<void> {
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
    yield* call(startPoll, slot, Math.max(interval * 1_000, AUTH_POLL_INTERVAL_MS));
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
  slot: PollSlot,
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
    if (user === null) yield* call(initialize, slot);
    return;
  }
  if (status === 'revoked') yield* put(logoutCompleted());
  else if (status === 'expired') yield* put(setGitHubAuthError(m.githubAuth_service_codeExpired_error()));
  else if (status === 'denied') yield* put(setGitHubAuthError(m.githubAuth_service_denied_error()));
  else yield* put(setGitHubAuthError(m.githubAuth_service_failed_error()));
}

function* handleAuthChanged(slot: PollSlot, action: ReturnType<typeof githubAuthChanged>): SagaGenerator<void> {
  const [status] = action.payload;
  yield* call(authChanged, slot, status);
}

function* command(slot: PollSlot, action: { type: string; payload: unknown }): SagaGenerator<void> {
  if (action.type === initializeGitHubAuth.type || action.type === refreshGitHubAuth.type) {
    yield* call(initialize, slot);
  } else if (action.type === startGitHubAuth.type) {
    yield* call(start, slot);
  } else if (action.type === checkGitHubAuthStatus.type) {
    yield* call(checkAuthComplete);
  } else if (action.type === cancelGitHubAuth.type) {
    yield* call(cancelAuth);
  } else if (action.type === logoutGitHub.type) {
    yield* call(logout);
  } else {
    yield* call(handleAuthChanged, slot, action as ReturnType<typeof githubAuthChanged>);
  }
}

export function* githubAuthSaga(): SagaGenerator<void> {
  const slot: PollSlot = {};
  try {
    while (true) {
      const action: { type: string; payload: unknown } = yield* take([
        initializeGitHubAuth,
        refreshGitHubAuth,
        startGitHubAuth,
        checkGitHubAuthStatus,
        cancelGitHubAuth,
        logoutGitHub,
        githubAuthChanged,
      ]);
      if (
        action.type === cancelGitHubAuth.type
        || action.type === logoutGitHub.type
        || action.type === githubAuthChanged.type
      ) {
        yield* call(cancelPoll, slot);
      }
      yield* fork(command, slot, action);
    }
  } finally {
    yield* call(cancelPoll, slot);
  }
}