import { githubAuthClient } from '$features/github-auth/renderer/github-auth.client';
import type { GitHubDeviceFlow, GitHubUser, StartAuthOptions } from '$features/github-auth/types';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import {
  call,
  delay,
  fork,
  join,
  put,
  race,
  take,
  takeEvery,
  takeLatest,
  type SagaGenerator,
} from 'typed-redux-saga';

import {
  selectGitHubAuthDeviceFlow,
  selectGitHubAuthIsAuthenticating,
} from '../github-auth-selectors';
import {
  authCancelled,
  authCompleted,
  cancelGitHubAuth,
  checkGitHubAuthStatus,
  githubAuthChanged,
  initializeGitHubAuth,
  logoutCompleted,
  logoutGitHub,
  setAuthenticating,
  setDeviceFlowInfo,
  setGitHubAuthError,
  setGitHubAuthState,
  setOAuthInfo,
  startGitHubAuth,
} from '../github-auth-slice';

const logger = createLogger('GitHubAuthSaga');
const AUTH_POLL_INTERVAL_MS = 5_000;
const AUTH_POLL_TIMEOUT_MS = 900_000;

function validPendingFlow(value: GitHubDeviceFlow | null | undefined): value is GitHubDeviceFlow {
  return (
    value?.status === 'pending' &&
    Boolean(value.userCode) &&
    Boolean(value.verificationUri) &&
    Number.isFinite(value.expiresIn) &&
    Number.isFinite(value.interval)
  );
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
    const result: Awaited<ReturnType<typeof githubAuthClient.checkAuthComplete>> = yield* call([
      githubAuthClient,
      githubAuthClient.checkAuthComplete,
    ]);
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

function* pollDeviceFlowWorker(action: ReturnType<typeof setDeviceFlowInfo>): SagaGenerator<void> {
  const [flow] = action.payload;
  if (flow === null) return;
  yield* race({
    completed: call(pollForCompletion, Math.max(flow.interval * 1_000, AUTH_POLL_INTERVAL_MS)),
    cancelled: take([cancelGitHubAuth, logoutGitHub, githubAuthChanged]),
  });
}

function* initialize(): SagaGenerator<void> {
  try {
    const state: Awaited<ReturnType<typeof githubAuthClient.getAuthState>> = yield* call([
      githubAuthClient,
      githubAuthClient.getAuthState,
    ]);
    yield* put(
      setGitHubAuthState({
        isAuthenticated: state.isAuthenticated,
        requiresDaemonAuth: state.requiresDaemonAuth,
        user: mapUser(state.user),
        needsScopeUpdate: state.needsScopeUpdate ?? false,
        oauthUrl: state.oauthUrl ?? null,
      }),
    );
    // A pending flow is resumed whether or not a token is configured: a
    // reconnect (intent#5206) keeps the old token valid while the user
    // authorizes, and a settings remount must not drop the in-flight code.
    if (validPendingFlow(state.deviceFlow)) {
      // `authStatus.deviceFlow` carries no `flowId`; keep the one a local
      // `github.connect` returned for the same code so the cancel stays scoped
      // across a remount.
      const local = yield* selectGitHubAuthDeviceFlow.effect();
      const flowId = local?.userCode === state.deviceFlow.userCode ? local.flowId : undefined;
      yield* put(setAuthenticating(true));
      yield* put(
        setDeviceFlowInfo({
          ...(typeof flowId === 'string' ? { flowId } : {}),
          userCode: state.deviceFlow.userCode,
          verificationUri: state.deviceFlow.verificationUri,
          expiresIn: state.deviceFlow.expiresIn,
          interval: state.deviceFlow.interval,
        }),
      );
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

type StartAuthSettled =
  { result: Awaited<ReturnType<typeof githubAuthClient.startAuth>> } | { error: unknown };

/** `startAuth` as a joinable task whose failure settles instead of aborting the parent. */
function* requestStartAuth(options?: StartAuthOptions): SagaGenerator<StartAuthSettled> {
  try {
    return { result: yield* call([githubAuthClient, githubAuthClient.startAuth], options) };
  } catch (error) {
    return { error };
  }
}

function* start(options?: StartAuthOptions): SagaGenerator<void> {
  yield* put(setAuthenticating(true));
  // A cancel while `github.connect` is still awaiting has no id to scope to,
  // so it is recorded here and sent once the result names the flow.
  let cancelRequested = false;
  try {
    const pending = yield* fork(requestStartAuth, options);
    const raced = yield* race({
      settled: join(pending),
      cancelRequested: take(cancelGitHubAuth),
    });
    cancelRequested = raced.cancelRequested !== undefined;
    const settled = raced.settled ?? (yield* join(pending));
    if ('error' in settled) throw settled.error;
    const { result } = settled;
    if (cancelRequested && result.success && !result.alreadyAuthenticated) {
      yield* call(cancelFlow, result.flowId);
      return;
    }
    if (cancelRequested && !result.success) {
      yield* put(authCancelled());
      return;
    }
    if (!result.success) {
      yield* put(setGitHubAuthError(result.error || m.githubAuth_service_startFailed_error()));
      return;
    }
    if (result.alreadyAuthenticated) {
      yield* put(setOAuthInfo(null, result.needsScopeUpdate ?? false));
      yield* put(authCompleted(null));
      return;
    }
    const { flowId, userCode, verificationUri, expiresIn, interval } = result;
    if (
      !userCode ||
      !verificationUri ||
      typeof expiresIn !== 'number' ||
      typeof interval !== 'number'
    ) {
      yield* put(setGitHubAuthError(m.githubAuth_service_deviceFlowFailed_error()));
      return;
    }
    yield* put(setOAuthInfo(result.oauthUrl ?? null, result.needsScopeUpdate ?? false));
    yield* put(
      setDeviceFlowInfo({
        ...(typeof flowId === 'string' ? { flowId } : {}),
        userCode,
        verificationUri,
        expiresIn,
        interval,
      }),
    );
  } catch (error) {
    if (cancelRequested) {
      yield* put(authCancelled());
      return;
    }
    const message = error instanceof Error ? error.message : m.githubAuth_service_unknown_error();
    yield* put(
      setGitHubAuthError(
        message.includes('Unauthorized channel')
          ? m.githubAuth_service_ipcBlocked_error()
          : message,
      ),
    );
  }
}

/**
 * Send `github.cancelAuth`, scoped to `flowId` when `github.connect` returned
 * one (§5.27). The unscoped call is only the older-daemon fallback.
 */
function* cancelFlow(flowId: string | undefined): SagaGenerator<void> {
  try {
    const result: Awaited<ReturnType<typeof githubAuthClient.cancelAuth>> =
      typeof flowId === 'string'
        ? yield* call([githubAuthClient, githubAuthClient.cancelAuth], { flowId })
        : yield* call([githubAuthClient, githubAuthClient.cancelAuth]);
    if (result.success) yield* put(authCancelled());
    else yield* put(setGitHubAuthError(result.error || m.githubAuth_service_cancelFailed_error()));
  } catch (error) {
    logger.error('Failed to cancel GitHub auth', error);
    yield* put(setGitHubAuthError(m.githubAuth_service_cancelFailed_error()));
  }
}

function* cancelAuth(): SagaGenerator<void> {
  const deviceFlow = yield* selectGitHubAuthDeviceFlow.effect();
  // Authenticating with no codes yet: `start` is awaiting `github.connect` and
  // sends the cancel itself once the flow has an id.
  if (deviceFlow === null && (yield* selectGitHubAuthIsAuthenticating.effect())) return;
  yield* call(cancelFlow, deviceFlow?.flowId);
}

function* logout(): SagaGenerator<void> {
  try {
    const result: Awaited<ReturnType<typeof githubAuthClient.logout>> = yield* call([
      githubAuthClient,
      githubAuthClient.logout,
    ]);
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
  else if (status === 'expired')
    yield* put(setGitHubAuthError(m.githubAuth_service_codeExpired_error()));
  else if (status === 'denied') yield* put(setGitHubAuthError(m.githubAuth_service_denied_error()));
  else yield* put(setGitHubAuthError(m.githubAuth_service_failed_error()));
}

function* initializeGitHubAuthWorker(
  _action: ReturnType<typeof initializeGitHubAuth>,
): SagaGenerator<void> {
  yield* call(initialize);
}

function* startGitHubAuthWorker(action: ReturnType<typeof startGitHubAuth>): SagaGenerator<void> {
  const [options] = action.payload ?? [];
  yield* call(start, options);
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

function* logoutGitHubWorker(_action: ReturnType<typeof logoutGitHub>): SagaGenerator<void> {
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
