import { forgeAuthClient } from '$features/forge-auth/renderer/forge-auth.client';
import type {
  ForgeAuthStatus,
  ForgeConnectParams,
  ForgeConnectResult,
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

import { selectLabsGitLabEnabled } from '../../user-preferences/user-preferences-selectors';
import {
  setLabsGitLabEnabled,
  toggleLabsGitLab,
} from '../../user-preferences/user-preferences-slice';
import {
  selectGitLabAuthIsAuthenticating,
  selectGitLabAuthDeviceFlow,
  selectGitLabAuthHost,
} from '../gitlab-auth-selectors';
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
  takeGitLabPatToken,
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
 * Monotonic marker of the latest intent the slice reflects: a host selection,
 * grant, PAT submit, cancel, logout, or a daemon transition for the selected
 * host. Every writer captures the generation before its daemon round trip and
 * drops its result when a newer intent has bumped it since — the slice then
 * belongs to that intent, and host comparison alone cannot tell a stale read
 * from a fresh one when both concern the same host.
 *
 * Invariant: the slice host is the *only* record of the instance the latest
 * intent targets, and every change of it bumps the generation. A writer that
 * targets a host publishes it with `setGitLabHost` before its daemon round
 * trip, in the same step that bumps, so no writer or daemon event can observe
 * a target host the slice has not learned yet; an unscoped read that learns a
 * different default host bumps before it hydrates, so a read begun for the
 * previous host cannot write onto the new one. A second copy of the target
 * (e.g. on the fence) would let an event for the target be accepted, and
 * complete on the slice's previous host, before the selection had been
 * published.
 */
type IntentFence = {
  generation: number;
  // Cleanup ownership for in-flight starts only, not the selected slice host.
  pendingDeviceStarts: Map<string, { generation: number; cancelled: boolean }>;
};

function bumpIntent(fence: IntentFence): number {
  fence.generation += 1;
  return fence.generation;
}

function superseded(fence: IntentFence, generation: number): boolean {
  return fence.generation !== generation;
}

type CompletionCheck = 'completed' | 'pending' | 'superseded';

/**
 * Completes the flow when the daemon reports a configured credential and an
 * empty flow slot for `host`. The status is always read for the host the flow
 * targets: the daemon's default is its *persisted* host, which only follows a
 * successful connect, so an unscoped read during a grant against instance B
 * would report instance A's connection and complete the wrong flow.
 */
function* checkAuthComplete(
  host: string,
  fence: IntentFence,
  generation: number,
): SagaGenerator<CompletionCheck> {
  try {
    const status = yield* call(readStatus, host);
    if (superseded(fence, generation)) return 'superseded';
    if (status?.isConfigured === true && !status.deviceFlow) {
      const payload = statusPayload(status, host);
      yield* put(gitlabAuthCompleted({ user: payload.user, method: payload.method }));
      return 'completed';
    }
  } catch (error) {
    logger.error('GitLab auth completion check failed', error);
    // A failed probe for a superseded intent must not trigger the caller's
    // completion fallback on behalf of the newer one.
    if (superseded(fence, generation)) return 'superseded';
  }
  return 'pending';
}

function* pollForCompletion(
  intervalMs: number,
  host: string,
  fence: IntentFence,
  generation: number,
): SagaGenerator<void> {
  const startedAt = Date.now();
  if ((yield* call(checkAuthComplete, host, fence, generation)) !== 'pending') return;
  while (true) {
    yield* delay(intervalMs);
    if (superseded(fence, generation)) return;
    if (Date.now() - startedAt > AUTH_POLL_TIMEOUT_MS) {
      yield* put(setGitLabAuthError(m.gitlabAuth_service_timedOut_error()));
      return;
    }
    if ((yield* call(checkAuthComplete, host, fence, generation)) !== 'pending') return;
  }
}

/**
 * Resolves on cancel/logout, or on a daemon transition for `host` only —
 * another instance's event must not tear down an in-flight grant.
 */
function* waitForPollEnd(host: string): SagaGenerator<void> {
  while (true) {
    const { changed } = yield* race({
      ended: take([cancelGitLabAuth, logoutGitLab]),
      changed: take(gitlabAuthChanged),
    });
    if (!changed) return;
    const [, eventHost] = changed.payload;
    if (eventForHost(eventHost, host)) return;
  }
}

function* pollDeviceFlowWorker(
  fence: IntentFence,
  action: ReturnType<typeof setGitLabDeviceFlowInfo>,
): SagaGenerator<void> {
  const [flow] = action.payload;
  if (flow === null) return;
  if (!(yield* selectLabsGitLabEnabled.effect())) {
    yield* put(cancelGitLabAuth());
    return;
  }
  // The poll belongs to the intent that produced the flow, not a new one.
  const generation = fence.generation;
  const host = yield* selectGitLabAuthHost.effect();
  yield* race({
    completed: call(
      pollForCompletion,
      Math.max(flow.interval * 1_000, AUTH_POLL_INTERVAL_MS),
      host,
      fence,
      generation,
    ),
    cancelled: call(waitForPollEnd, host),
  });
}

/**
 * Reads the status for `host` (the daemon's default when omitted) and hydrates
 * the slice. A requested host is published before the read so that daemon
 * events are filtered against it from the start: an event for the host being
 * left is dropped, and one for the requested host lands on a slice that
 * already shows it. The write is dropped when a newer intent landed while the
 * read was in flight: that intent's own read or connect owns the state now,
 * and a stale result must not put the previous host or identity back.
 *
 * An unscoped read learns the daemon's default host only when it resolves;
 * when that differs from the slice host, the hydration is a host change like
 * any other and bumps the generation first, so a read begun for the previous
 * host (a focus re-check) cannot complete on the new one.
 */
function* initialize(
  host: string | undefined,
  fence: IntentFence,
  generation: number,
): SagaGenerator<void> {
  try {
    if (host !== undefined) yield* put(setGitLabHost(host));
    const target = host ?? (yield* selectGitLabAuthHost.effect());
    const status = yield* call(readStatus, host);
    if (!status || superseded(fence, generation)) return;
    const payload = statusPayload(status, target);
    if (!sameHost(payload.host, target)) bumpIntent(fence);
    yield* put(setGitLabAuthStatus(payload));
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

function* startDeviceAuth(
  host: string,
  fence: IntentFence,
  generation: number,
): SagaGenerator<void> {
  const hostKey = host.trim().toLowerCase();
  const pendingStart = { generation, cancelled: false };
  fence.pendingDeviceStarts.set(hostKey, pendingStart);
  yield* put(setGitLabHost(host));
  yield* put(setGitLabAuthenticating(true));
  try {
    const params: ForgeConnectParams = { provider: PROVIDER, host, method: 'device' };
    const result = yield* call([forgeAuthClient, forgeAuthClient.connect], params);
    if (superseded(fence, generation)) {
      // An early cancel can precede the daemon installing its slot. Cancel
      // again after successful startup, unless a newer start owns this host.
      // cancelAuth never revokes an independently saved PAT or credential.
      if (
        result.success &&
        pendingStart.cancelled &&
        fence.pendingDeviceStarts.get(hostKey)?.generation === generation
      ) {
        try {
          const cancelled = yield* call(
            [forgeAuthClient, forgeAuthClient.cancelAuth],
            PROVIDER,
            host,
          );
          if (!cancelled.success)
            logger.error('Failed to cancel late GitLab device grant', cancelled.error);
        } catch (error) {
          logger.error('Failed to cancel late GitLab device grant', error);
        }
      }
      return;
    }
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
    if (superseded(fence, generation)) return;
    const message =
      error instanceof Error ? error.message : m.gitlabAuth_service_startFailed_error();
    yield* put(setGitLabAuthError(message));
  } finally {
    if (fence.pendingDeviceStarts.get(hostKey)?.generation === generation) {
      fence.pendingDeviceStarts.delete(hostKey);
    }
  }
}

/**
 * Resolves the staged PAT and sends it in one plain async step so no saga
 * effect (and hence no saga-monitor trace) ever carries the token.
 */
async function connectStagedToken(host: string, tokenRef: number): Promise<ForgeConnectResult> {
  const token = takeGitLabPatToken(tokenRef);
  if (token === null) return { success: false, error: m.gitlabAuth_service_tokenRejected_error() };
  const params: ForgeConnectParams = { provider: PROVIDER, host, method: 'pat', token };
  return await forgeAuthClient.connect(params);
}

function* connectWithToken(
  host: string,
  tokenRef: number,
  fence: IntentFence,
  generation: number,
): SagaGenerator<void> {
  yield* put(setGitLabHost(host));
  yield* put(setGitLabAuthenticating(true));
  try {
    const result = yield* call(connectStagedToken, host, tokenRef);
    if (superseded(fence, generation)) return;
    if (!result.success) {
      yield* put(setGitLabAuthError(result.error || m.gitlabAuth_service_tokenRejected_error()));
      return;
    }
    // The PAT never round-trips; the daemon's status is the only identity source.
    const status = yield* call(readStatus, host);
    if (superseded(fence, generation)) return;
    const payload = status ? statusPayload(status, host) : null;
    yield* put(
      gitlabAuthCompleted({ user: payload?.user ?? null, method: payload?.method ?? 'pat' }),
    );
  } catch (error) {
    if (superseded(fence, generation)) return;
    const message =
      error instanceof Error ? error.message : m.gitlabAuth_service_tokenRejected_error();
    yield* put(setGitLabAuthError(message));
  }
}

function* cancelAuth(fence: IntentFence, generation: number): SagaGenerator<void> {
  try {
    const host = yield* selectGitLabAuthHost.effect();
    const pendingStart = fence.pendingDeviceStarts.get(host.trim().toLowerCase());
    if (pendingStart) pendingStart.cancelled = true;
    const result = yield* call([forgeAuthClient, forgeAuthClient.cancelAuth], PROVIDER, host);
    if (superseded(fence, generation)) return;
    if (result.success) yield* put(gitlabAuthCancelled());
    else yield* put(setGitLabAuthError(result.error || m.gitlabAuth_service_cancelFailed_error()));
  } catch (error) {
    logger.error('Failed to cancel GitLab auth', error);
    if (superseded(fence, generation)) return;
    yield* put(setGitLabAuthError(m.gitlabAuth_service_cancelFailed_error()));
  }
}

function* logout(fence: IntentFence, generation: number): SagaGenerator<void> {
  try {
    const host = yield* selectGitLabAuthHost.effect();
    const result = yield* call([forgeAuthClient, forgeAuthClient.revoke], PROVIDER, host);
    if (superseded(fence, generation)) return;
    if (result.success) yield* put(gitlabLogoutCompleted());
    else yield* put(setGitLabAuthError(result.error || m.gitlabAuth_service_logoutFailed_error()));
  } catch (error) {
    logger.error('Failed to disconnect GitLab', error);
    if (superseded(fence, generation)) return;
    yield* put(setGitLabAuthError(m.gitlabAuth_service_logoutFailed_error()));
  }
}

/**
 * `expired` covers both a lapsed pending device code and a credential whose
 * refresh the daemon rejected (it then drops the token pair). Only the daemon
 * knows which, so the configured identity is re-read rather than cleared: an
 * expired code must not discard an independently valid credential.
 */
function* reconcileStatus(
  host: string,
  fence: IntentFence,
  generation: number,
): SagaGenerator<void> {
  try {
    const status = yield* call(readStatus, host);
    if (!status || superseded(fence, generation)) return;
    yield* put(setGitLabAuthStatus(statusPayload(status, host)));
  } catch (error) {
    logger.error('Failed to reconcile GitLab auth status', error);
  }
}

function* authChanged(
  fence: IntentFence,
  status: ReturnType<typeof gitlabAuthChanged>['payload'][0],
  eventHost: string | undefined,
): SagaGenerator<void> {
  const host = yield* selectGitLabAuthHost.effect();
  // The daemon emits for every instance; only the selected one is reflected
  // here — an event for the host being left must not cancel a pending
  // selection of the next one (which is already published, see IntentFence).
  if (!eventForHost(eventHost, host)) return;
  // A transition for the selected host outdates every read begun before it.
  const generation = bumpIntent(fence);
  if (status === 'authorized') {
    yield* put(clearGitLabAuthError());
    if ((yield* call(checkAuthComplete, host, fence, generation)) === 'pending') {
      // The status probe failed or lags the event: report completion without an
      // identity and let the next initialize reconcile.
      yield* put(gitlabAuthCompleted({ user: null, method: null }));
      yield* call(initialize, host, fence, generation);
    }
    return;
  }
  if (status === 'revoked') yield* put(gitlabLogoutCompleted());
  else if (status === 'expired') {
    yield* put(setGitLabAuthError(m.gitlabAuth_service_codeExpired_error()));
    yield* call(reconcileStatus, host, fence, generation);
  } else if (status === 'denied')
    yield* put(setGitLabAuthError(m.gitlabAuth_service_denied_error()));
  else yield* put(setGitLabAuthError(m.gitlabAuth_service_failed_error()));
}

function* initializeGitLabAuthWorker(
  fence: IntentFence,
  action: ReturnType<typeof initializeGitLabAuth>,
): SagaGenerator<void> {
  const [host] = action.payload ?? [];
  yield* call(initialize, host, fence, bumpIntent(fence));
}

function* startGitLabDeviceAuthWorker(
  fence: IntentFence,
  action: ReturnType<typeof startGitLabDeviceAuth>,
): SagaGenerator<void> {
  if (!(yield* selectLabsGitLabEnabled.effect())) return;
  yield* call(startDeviceAuth, action.payload[0], fence, bumpIntent(fence));
}

function* connectGitLabWithTokenWorker(
  fence: IntentFence,
  action: ReturnType<typeof connectGitLabWithToken>,
): SagaGenerator<void> {
  const { host, tokenRef } = action.payload;
  if (!(yield* selectLabsGitLabEnabled.effect())) {
    takeGitLabPatToken(tokenRef);
    return;
  }
  yield* call(connectWithToken, host, tokenRef, fence, bumpIntent(fence));
}

function* checkGitLabAuthStatusWorker(
  fence: IntentFence,
  _action: ReturnType<typeof checkGitLabAuthStatus>,
): SagaGenerator<void> {
  // A focus re-check reads on behalf of the current intent; it is not a new one.
  const host = yield* selectGitLabAuthHost.effect();
  yield* call(checkAuthComplete, host, fence, fence.generation);
}

function* cancelGitLabAuthWorker(
  fence: IntentFence,
  _action: ReturnType<typeof cancelGitLabAuth>,
): SagaGenerator<void> {
  yield* call(cancelAuth, fence, bumpIntent(fence));
}

function* logoutGitLabWorker(
  fence: IntentFence,
  _action: ReturnType<typeof logoutGitLab>,
): SagaGenerator<void> {
  yield* call(logout, fence, bumpIntent(fence));
}

function* gitlabAuthChangedWorker(
  fence: IntentFence,
  action: ReturnType<typeof gitlabAuthChanged>,
): SagaGenerator<void> {
  const [status, host] = action.payload;
  yield* call(authChanged, fence, status, host);
}

function* gitlabLabChangedWorker(): SagaGenerator<void> {
  if (
    !(yield* selectLabsGitLabEnabled.effect()) &&
    (yield* selectGitLabAuthIsAuthenticating.effect())
  ) {
    // Cancel only pending setup. Revoking a saved credential is a separate explicit action.
    yield* put(cancelGitLabAuth());
  }
}

export function* gitlabAuthSaga(): SagaGenerator<void> {
  const fence: IntentFence = { generation: 0, pendingDeviceStarts: new Map() };
  // Only the latest initialize may hydrate: an older read (mount-time default
  // host) that resolved after a newer one would otherwise overwrite it.
  yield* takeLatest(initializeGitLabAuth, initializeGitLabAuthWorker, fence);
  yield* takeEvery(startGitLabDeviceAuth, startGitLabDeviceAuthWorker, fence);
  yield* takeEvery(connectGitLabWithToken, connectGitLabWithTokenWorker, fence);
  yield* takeEvery(checkGitLabAuthStatus, checkGitLabAuthStatusWorker, fence);
  yield* takeEvery(cancelGitLabAuth, cancelGitLabAuthWorker, fence);
  yield* takeEvery(logoutGitLab, logoutGitLabWorker, fence);
  yield* takeEvery(gitlabAuthChanged, gitlabAuthChangedWorker, fence);
  yield* takeLatest(setGitLabDeviceFlowInfo, pollDeviceFlowWorker, fence);
  yield* takeEvery([setLabsGitLabEnabled, toggleLabsGitLab], gitlabLabChangedWorker);
}
