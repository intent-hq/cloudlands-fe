import { forgeAuthClient } from '$features/forge-auth/renderer/forge-auth.client';
import type {
  ForgeAuthStatus,
  ForgeConnectParams,
  ForgeDeviceFlow,
  ForgeProvider,
} from '$features/forge-auth/types';
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

import { selectGitLabAuthDeviceFlow, selectGitLabAuthHost } from '../gitlab-auth-selectors';
import {
  cancelGitLabAuth,
  checkGitLabAuthStatus,
  clearGitLabAuthError,
  connectGitLabWithToken,
  gitlabAuthCancelled,
  gitlabAuthChanged,
  gitlabAuthCompleted,
  gitlabDeviceGrantUnsupported,
  gitlabLogoutCompleted,
  initializeGitLabAuth,
  logoutGitLab,
  setGitLabAuthenticating,
  setGitLabAuthError,
  setGitLabAuthStatus,
  setGitLabDeviceFlowInfo,
  setGitLabHost,
  startGitLabDeviceAuth,
} from '../gitlab-auth-slice';

const logger = createLogger('GitLabAuthSaga');
const PROVIDER: ForgeProvider = 'gitlab';
const AUTH_POLL_INTERVAL_MS = 5_000;
const AUTH_POLL_TIMEOUT_MS = 900_000;

function validPendingFlow(value: ForgeDeviceFlow | null | undefined): value is ForgeDeviceFlow {
  return (
    value?.status === 'pending' &&
    Boolean(value.userCode) &&
    Boolean(value.verificationUri) &&
    Number.isFinite(value.expiresIn) &&
    Number.isFinite(value.interval)
  );
}

/** Field-by-field copy of the wire status into the slice's hydrate payload. */
function statusPayload(status: ForgeAuthStatus, fallbackHost: string) {
  const user = status.user;
  return {
    host: typeof status.host === 'string' && status.host ? status.host : fallbackHost,
    isConfigured: status.isConfigured === true,
    deviceGrantSupported: status.deviceGrantSupported === true,
    user:
      user && typeof user.login === 'string'
        ? {
            id: user.id,
            login: user.login,
            ...(user.displayName !== undefined ? { displayName: user.displayName } : {}),
            ...(user.avatarUrl !== undefined ? { avatarUrl: user.avatarUrl } : {}),
          }
        : null,
    method:
      status.method === 'device' || status.method === 'pat' || status.method === 'env'
        ? status.method
        : null,
  };
}

/** Host names compare case-insensitively (`host[:port]`, no scheme). */
function sameHost(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Whether an auth-changed event concerns `host`. The daemon always sends the
 * host; an event without one is treated as ours rather than dropped.
 */
function eventForHost(eventHost: string | undefined, host: string): boolean {
  return eventHost === undefined || sameHost(eventHost, host);
}

function* readStatus(host?: string): SagaGenerator<ForgeAuthStatus | null> {
  return yield* call([forgeAuthClient, forgeAuthClient.getStatus], PROVIDER, host);
}

/**
 * Completes the flow when the daemon reports a configured credential and an
 * empty flow slot for `host`. The status is always read for the host the flow
 * targets: the daemon's default is its *persisted* host, which only follows a
 * successful connect, so an unscoped read during a grant against instance B
 * would report instance A's connection and complete the wrong flow.
 */
function* checkAuthComplete(host: string): SagaGenerator<boolean> {
  try {
    const status = yield* call(readStatus, host);
    if (status?.isConfigured === true && !status.deviceFlow) {
      const payload = statusPayload(status, host);
      yield* put(gitlabAuthCompleted({ user: payload.user, method: payload.method }));
      return true;
    }
  } catch (error) {
    logger.error('GitLab auth completion check failed', error);
  }
  return false;
}

function* pollForCompletion(intervalMs: number, host: string): SagaGenerator<void> {
  const startedAt = Date.now();
  if (yield* call(checkAuthComplete, host)) return;
  while (true) {
    yield* delay(intervalMs);
    if (Date.now() - startedAt > AUTH_POLL_TIMEOUT_MS) {
      yield* put(setGitLabAuthError(m.gitlabAuth_service_timedOut_error()));
      return;
    }
    if (yield* call(checkAuthComplete, host)) return;
  }
}

/**
 * Resolves on cancel/logout, or on a daemon transition for `host` only —
 * another instance's event must not tear down an in-flight grant.
 */
function* waitForPollEnd(host: string): SagaGenerator<void> {
  while (true) {
    const action = yield* take([cancelGitLabAuth, logoutGitLab, gitlabAuthChanged]);
    if (action.type !== gitlabAuthChanged.type) return;
    const [, eventHost] = action.payload as ReturnType<typeof gitlabAuthChanged>['payload'];
    if (eventForHost(eventHost, host)) return;
  }
}

function* pollDeviceFlowWorker(
  action: ReturnType<typeof setGitLabDeviceFlowInfo>,
): SagaGenerator<void> {
  const [flow] = action.payload;
  if (flow === null) return;
  const host = yield* selectGitLabAuthHost.effect();
  yield* race({
    completed: call(
      pollForCompletion,
      Math.max(flow.interval * 1_000, AUTH_POLL_INTERVAL_MS),
      host,
    ),
    cancelled: call(waitForPollEnd, host),
  });
}

function* initialize(host?: string): SagaGenerator<void> {
  try {
    const status = yield* call(readStatus, host);
    if (!status) return;
    const fallbackHost = host ?? (yield* selectGitLabAuthHost.effect());
    yield* put(setGitLabAuthStatus(statusPayload(status, fallbackHost)));
    // A pending grant is resumed so a settings remount or client refresh does
    // not drop the in-flight code.
    if (validPendingFlow(status.deviceFlow)) {
      yield* put(setGitLabAuthenticating(true));
      yield* put(
        setGitLabDeviceFlowInfo({
          userCode: status.deviceFlow.userCode,
          verificationUri: status.deviceFlow.verificationUri,
          expiresIn: status.deviceFlow.expiresIn,
          interval: status.deviceFlow.interval,
        }),
      );
      return;
    }
    const currentFlow = yield* selectGitLabAuthDeviceFlow.effect();
    if (currentFlow !== null) {
      yield* put(setGitLabDeviceFlowInfo(null));
      yield* put(setGitLabAuthenticating(false));
    }
  } catch (error) {
    logger.error('Failed to initialize GitLab auth', error);
  }
}

function* startDeviceAuth(host: string): SagaGenerator<void> {
  yield* put(setGitLabHost(host));
  yield* put(setGitLabAuthenticating(true));
  try {
    const params: ForgeConnectParams = { provider: PROVIDER, host, method: 'device' };
    const result = yield* call([forgeAuthClient, forgeAuthClient.connect], params);
    if (!result.success) {
      if (result.code === 'device-grant-unsupported') {
        yield* put(
          gitlabDeviceGrantUnsupported(m.gitlabAuth_service_deviceGrantUnsupported_error()),
        );
      } else {
        yield* put(setGitLabAuthError(result.error || m.gitlabAuth_service_startFailed_error()));
      }
      return;
    }
    const flow = result.deviceFlow;
    if (
      !flow ||
      !flow.userCode ||
      !flow.verificationUri ||
      typeof flow.expiresIn !== 'number' ||
      typeof flow.interval !== 'number'
    ) {
      yield* put(setGitLabAuthError(m.gitlabAuth_service_deviceFlowFailed_error()));
      return;
    }
    yield* put(
      setGitLabDeviceFlowInfo({
        userCode: flow.userCode,
        verificationUri: flow.verificationUri,
        expiresIn: flow.expiresIn,
        interval: flow.interval,
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : m.gitlabAuth_service_startFailed_error();
    yield* put(setGitLabAuthError(message));
  }
}

function* connectWithToken(host: string, token: string): SagaGenerator<void> {
  yield* put(setGitLabHost(host));
  yield* put(setGitLabAuthenticating(true));
  try {
    const params: ForgeConnectParams = { provider: PROVIDER, host, method: 'pat', token };
    const result = yield* call([forgeAuthClient, forgeAuthClient.connect], params);
    if (!result.success) {
      yield* put(setGitLabAuthError(result.error || m.gitlabAuth_service_tokenRejected_error()));
      return;
    }
    // The PAT never round-trips; the daemon's status is the only identity source.
    const status = yield* call(readStatus, host);
    const payload = status ? statusPayload(status, host) : null;
    yield* put(
      gitlabAuthCompleted({ user: payload?.user ?? null, method: payload?.method ?? 'pat' }),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : m.gitlabAuth_service_tokenRejected_error();
    yield* put(setGitLabAuthError(message));
  }
}

function* cancelAuth(): SagaGenerator<void> {
  try {
    const host = yield* selectGitLabAuthHost.effect();
    const result = yield* call([forgeAuthClient, forgeAuthClient.cancelAuth], PROVIDER, host);
    if (result.success) yield* put(gitlabAuthCancelled());
    else yield* put(setGitLabAuthError(result.error || m.gitlabAuth_service_cancelFailed_error()));
  } catch (error) {
    logger.error('Failed to cancel GitLab auth', error);
    yield* put(setGitLabAuthError(m.gitlabAuth_service_cancelFailed_error()));
  }
}

function* logout(): SagaGenerator<void> {
  try {
    const host = yield* selectGitLabAuthHost.effect();
    const result = yield* call([forgeAuthClient, forgeAuthClient.revoke], PROVIDER, host);
    if (result.success) yield* put(gitlabLogoutCompleted());
    else yield* put(setGitLabAuthError(result.error || m.gitlabAuth_service_logoutFailed_error()));
  } catch (error) {
    logger.error('Failed to disconnect GitLab', error);
    yield* put(setGitLabAuthError(m.gitlabAuth_service_logoutFailed_error()));
  }
}

function* authChanged(
  status: ReturnType<typeof gitlabAuthChanged>['payload'][0],
  eventHost: string | undefined,
): SagaGenerator<void> {
  const host = yield* selectGitLabAuthHost.effect();
  // The daemon emits for every instance; only the selected one is reflected here.
  if (!eventForHost(eventHost, host)) return;
  if (status === 'authorized') {
    yield* put(clearGitLabAuthError());
    if (!(yield* call(checkAuthComplete, host))) {
      // The status probe failed or lags the event: report completion without an
      // identity and let the next initialize reconcile.
      yield* put(gitlabAuthCompleted({ user: null, method: null }));
      yield* call(initialize, host);
    }
    return;
  }
  if (status === 'revoked') yield* put(gitlabLogoutCompleted());
  else if (status === 'expired')
    yield* put(setGitLabAuthError(m.gitlabAuth_service_codeExpired_error()));
  else if (status === 'denied') yield* put(setGitLabAuthError(m.gitlabAuth_service_denied_error()));
  else yield* put(setGitLabAuthError(m.gitlabAuth_service_failed_error()));
}

function* initializeGitLabAuthWorker(
  action: ReturnType<typeof initializeGitLabAuth>,
): SagaGenerator<void> {
  const [host] = action.payload ?? [];
  yield* call(initialize, host);
}

function* startGitLabDeviceAuthWorker(
  action: ReturnType<typeof startGitLabDeviceAuth>,
): SagaGenerator<void> {
  yield* call(startDeviceAuth, action.payload[0]);
}

function* connectGitLabWithTokenWorker(
  action: ReturnType<typeof connectGitLabWithToken>,
): SagaGenerator<void> {
  const [host, token] = action.payload;
  yield* call(connectWithToken, host, token);
}

function* checkGitLabAuthStatusWorker(
  _action: ReturnType<typeof checkGitLabAuthStatus>,
): SagaGenerator<void> {
  yield* call(checkAuthComplete, yield* selectGitLabAuthHost.effect());
}

function* cancelGitLabAuthWorker(
  _action: ReturnType<typeof cancelGitLabAuth>,
): SagaGenerator<void> {
  yield* call(cancelAuth);
}

function* logoutGitLabWorker(_action: ReturnType<typeof logoutGitLab>): SagaGenerator<void> {
  yield* call(logout);
}

function* gitlabAuthChangedWorker(
  action: ReturnType<typeof gitlabAuthChanged>,
): SagaGenerator<void> {
  const [status, host] = action.payload;
  yield* call(authChanged, status, host);
}

export function* gitlabAuthSaga(): SagaGenerator<void> {
  yield* takeEvery(initializeGitLabAuth, initializeGitLabAuthWorker);
  yield* takeEvery(startGitLabDeviceAuth, startGitLabDeviceAuthWorker);
  yield* takeEvery(connectGitLabWithToken, connectGitLabWithTokenWorker);
  yield* takeEvery(checkGitLabAuthStatus, checkGitLabAuthStatusWorker);
  yield* takeEvery(cancelGitLabAuth, cancelGitLabAuthWorker);
  yield* takeEvery(logoutGitLab, logoutGitLabWorker);
  yield* takeEvery(gitlabAuthChanged, gitlabAuthChangedWorker);
  yield* takeLatest(setGitLabDeviceFlowInfo, pollDeviceFlowWorker);
}
