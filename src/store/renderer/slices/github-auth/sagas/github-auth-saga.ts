import { githubAuthClient } from '$features/github-auth/renderer/github-auth.client';
import type {
  GitHubDeviceFlow,
  GitHubUser,
  StartAuthOptions,
  StartAuthResult,
} from '$features/github-auth/types';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { buffers } from 'redux-saga';
import {
  actionChannel,
  call,
  cancelled,
  delay,
  fork,
  put,
  race,
  take,
  takeLatest,
  takeLeading,
  type SagaGenerator,
} from 'typed-redux-saga';

import {
  selectGitHubAuthCallbacksCancelled,
  selectGitHubAuthDeviceFlow,
  selectGitHubAuthIsAuthenticating,
  selectGitHubAuthMutationRequestId,
} from '../github-auth-selectors';
import { takeEveryFromWindowEvent } from '../../../utils/ipc-channel';
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
  setGitHubDisconnecting,
  setDeviceFlowInfo,
  setGitHubAuthError,
  setGitHubAuthState,
  setOAuthInfo,
  settleGitHubAuthMutation,
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
    yield* race({ elapsed: delay(intervalMs), focused: take(checkGitHubAuthStatus) });
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
    cancelled: take([startGitHubAuth, cancelGitHubAuth, logoutGitHub, githubAuthChanged]),
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

function* isCurrentMutation(requestId: string): SagaGenerator<boolean> {
  return (yield* selectGitHubAuthMutationRequestId.effect()) === requestId;
}

function* start(
  requestId: string,
  options?: StartAuthOptions,
): SagaGenerator<StartAuthResult | null | undefined> {
  yield* put(setAuthenticating(true));
  try {
    const result: Awaited<ReturnType<typeof githubAuthClient.startAuth>> = yield* call(
      [githubAuthClient, githubAuthClient.startAuth],
      options,
    );
    // Keep an obsolete response out of the UI, but retain its identity for
    // a queued cancel: the daemon call has settled and can now be scoped.
    if (!(yield* call(isCurrentMutation, requestId))) return result;
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
    if (!(yield* call(isCurrentMutation, requestId))) return null;
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

function* cancelAuth(interruptedStart?: StartAuthResult | null): SagaGenerator<void> {
  if (interruptedStart !== undefined) {
    if (interruptedStart?.success && !interruptedStart.alreadyAuthenticated) {
      yield* call(cancelFlow, interruptedStart.flowId);
    } else {
      yield* put(authCancelled());
    }
    return;
  }
  const deviceFlow = yield* selectGitHubAuthDeviceFlow.effect();
  yield* call(cancelFlow, deviceFlow?.flowId);
}

function* logout(): SagaGenerator<void> {
  yield* put(setGitHubDisconnecting(true));
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
  } finally {
    yield* put(setGitHubDisconnecting(false));
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
  if (yield* selectGitHubAuthMutationRequestId.effect()) return;
  yield* race({
    initialized: call(initialize),
    invalidated: take([startGitHubAuth, cancelGitHubAuth, logoutGitHub, githubAuthChanged]),
  });
}

function* checkGitHubAuthStatusWorker(
  _action: ReturnType<typeof checkGitHubAuthStatus>,
): SagaGenerator<void> {
  // The poll owns completion I/O while a device flow exists. Focus merely
  // wakes that poll, so compatibility callers cannot start a second request.
  if (yield* selectGitHubAuthMutationRequestId.effect()) return;
  if (yield* selectGitHubAuthDeviceFlow.effect()) return;
  if (yield* selectGitHubAuthCallbacksCancelled.effect()) return;
  yield* race({
    completed: call(checkAuthComplete),
    cancelled: take([startGitHubAuth, cancelGitHubAuth, logoutGitHub]),
  });
}

function* mutations(): SagaGenerator<void> {
  // These RPCs cannot be aborted. Drain each write before starting the next;
  // a new intent invalidates old start results, never a confirmed revocation.
  const requests = yield* actionChannel(
    [startGitHubAuth, cancelGitHubAuth, logoutGitHub],
    buffers.expanding(),
  );
  let interruptedStart: StartAuthResult | null | undefined;
  try {
    while (true) {
      const action:
        | ReturnType<typeof startGitHubAuth>
        | ReturnType<typeof cancelGitHubAuth>
        | ReturnType<typeof logoutGitHub> = yield* take(requests);
      const { requestId } = action.payload;
      if (action.type === startGitHubAuth.type) {
        if (!(yield* call(isCurrentMutation, requestId))) continue;
        interruptedStart = yield* call(
          start,
          requestId,
          (action as ReturnType<typeof startGitHubAuth>).payload.options,
        );
      } else if (action.type === cancelGitHubAuth.type) {
        yield* call(cancelAuth, interruptedStart);
        interruptedStart = undefined;
      } else {
        yield* call(logout);
        interruptedStart = undefined;
      }
      yield* put(settleGitHubAuthMutation(requestId));
    }
  } finally {
    requests.close();
    if (yield* cancelled()) {
      const requestId = yield* selectGitHubAuthMutationRequestId.effect();
      if (requestId !== null) {
        yield* put(settleGitHubAuthMutation(requestId));
        yield* put(setAuthenticating(false));
      }
    }
  }
}

function* authNotificationWorker(
  action: ReturnType<typeof githubAuthChanged>,
): SagaGenerator<void> {
  // The daemon callback has no request ID. A local cancellation closes the
  // current flow's callback window until a deliberate new start/hydration.
  const [status] = action.payload;
  if ((yield* selectGitHubAuthMutationRequestId.effect()) && status !== 'revoked') return;
  if ((yield* selectGitHubAuthCallbacksCancelled.effect()) && status !== 'revoked') return;
  yield* race({
    changed: call(authChanged, status),
    invalidated: take([startGitHubAuth, cancelGitHubAuth, logoutGitHub, initializeGitHubAuth]),
  });
}

function* windowFocused(): SagaGenerator<void> {
  if (
    (yield* selectGitHubAuthIsAuthenticating.effect()) &&
    (yield* selectGitHubAuthDeviceFlow.effect())
  ) {
    yield* put(checkGitHubAuthStatus());
  }
}

export function* githubAuthSaga(): SagaGenerator<void> {
  yield* fork(mutations);
  yield* takeLatest(initializeGitHubAuth, initializeGitHubAuthWorker);
  yield* takeLeading(checkGitHubAuthStatus, checkGitHubAuthStatusWorker);
  yield* takeLatest(githubAuthChanged, authNotificationWorker);
  yield* takeEveryFromWindowEvent('focus', windowFocused);
  yield* takeLatest(setDeviceFlowInfo, pollDeviceFlowWorker);
}
