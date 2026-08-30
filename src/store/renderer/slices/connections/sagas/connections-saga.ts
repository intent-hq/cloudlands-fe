import {
  END,
  eventChannel,
  buffers,
  channel as sagaChannel,
  type Channel,
  type EventChannel,
} from 'redux-saga';
import {
  all,
  call,
  cancelled,
  fork,
  join,
  put,
  take,
  takeEvery,
  takeLeading,
  type SagaGenerator,
} from 'typed-redux-saga';

import { canRequestDeviceUpdate } from '$lib/utils/device-update-eligibility';
import { formatConnectionLabel } from '$lib/utils/connection-label';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  CONNECTIONS_CHANGED_EVENT,
  CONNECTION_AUTH_REJECTED_EVENT,
  CONNECTION_CERT_MISMATCH_EVENT,
  CONNECTION_PROTOCOL_MISMATCH_EVENT,
  KEYCHAIN_SYNC_STATUS_EVENT,
} from '$shared/types/connections';
import type {
  AddConnectionParams,
  AddConnectionResult,
  CaptureFingerprintParams,
  CaptureFingerprintResult,
  ConnectionAuthRejectedEvent,
  ConnectionCertMismatchEvent,
  ConnectionProtocolMismatchEvent,
  ConnectionRecord,
  ConnectionsChangedEvent,
  ConnectionsListResult,
  ForgetConnectionParams,
  ForgetConnectionResult,
  KeychainSyncStateResult,
  KeychainSyncUiStatus,
  OpenConnectionParams,
  OpenConnectionResult,
  RotateConnectionSecretParams,
  RotateConnectionSecretResult,
  SetKeychainSyncEnabledParams,
  TestConnectionParams,
  TestConnectionResult,
  UpdateConnectionParams,
  UpdateConnectionResult,
  UpdateBackendParams,
  UpdateBackendResult,
} from '$shared/types/connections';
import {
  addConnectionRequested,
  authRejectedReceived,
  certMismatchReceived,
  captureFingerprintRequested,
  connectOperationFailed,
  connectOperationSettled,
  connectOperationStarted,
  connectionsListReceived,
  forgetConnectionRequested,
  keychainSyncStateReceived,
  keychainSyncStatusReceived,
  loadConnectionsRequested,
  loadKeychainSyncStateRequested,
  openConnectionRequested,
  protocolMismatchReceived,
  rotateConnectionSecretRequested,
  setKeychainSyncEnabledRequested,
  testConnectionRequested,
  updateConnectionRequested,
  updateBackendRequested,
} from '../connections-slice';

const CONNECTIONS = IPC_CHANNELS.CONNECTIONS;

type ConnectionsEvent =
  | { kind: 'changed'; payload: ConnectionsChangedEvent }
  | { kind: 'cert-mismatch'; payload: ConnectionCertMismatchEvent }
  | { kind: 'protocol-mismatch'; payload: ConnectionProtocolMismatchEvent }
  | { kind: 'auth-rejected'; payload: ConnectionAuthRejectedEvent }
  | { kind: 'sync-status'; payload: KeychainSyncUiStatus };

function getApi(): Window['electronAPI'] | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function createConnectionsEventChannel(): EventChannel<ConnectionsEvent> {
  return eventChannel<ConnectionsEvent>((emit) => {
    const api = getApi();
    if (!api?.on) return () => {};

    const listeners: Array<[string, string]> = [
      [
        CONNECTIONS_CHANGED_EVENT,
        api.on(CONNECTIONS_CHANGED_EVENT, (payload: ConnectionsChangedEvent) =>
          emit({ kind: 'changed', payload }),
        ),
      ],
      [
        CONNECTION_CERT_MISMATCH_EVENT,
        api.on(CONNECTION_CERT_MISMATCH_EVENT, (payload: ConnectionCertMismatchEvent) =>
          emit({ kind: 'cert-mismatch', payload }),
        ),
      ],
      [
        CONNECTION_PROTOCOL_MISMATCH_EVENT,
        api.on(CONNECTION_PROTOCOL_MISMATCH_EVENT, (payload: ConnectionProtocolMismatchEvent) =>
          emit({ kind: 'protocol-mismatch', payload }),
        ),
      ],
      [
        CONNECTION_AUTH_REJECTED_EVENT,
        api.on(CONNECTION_AUTH_REJECTED_EVENT, (payload: ConnectionAuthRejectedEvent) =>
          emit({ kind: 'auth-rejected', payload }),
        ),
      ],
      [
        KEYCHAIN_SYNC_STATUS_EVENT,
        api.on(KEYCHAIN_SYNC_STATUS_EVENT, (payload: KeychainSyncUiStatus) =>
          emit({ kind: 'sync-status', payload }),
        ),
      ],
    ];

    return () => {
      for (const [channel, listenerId] of listeners) api.offById(channel, listenerId);
    };
  }, buffers.expanding<ConnectionsEvent>());
}

async function invokeConnectionsList(): Promise<ConnectionsListResult> {
  const api = getApi();
  if (!api) throw new Error('electronAPI is not available');
  return (await api.invoke(CONNECTIONS.LIST)) as ConnectionsListResult;
}

async function invokeCaptureFingerprint(
  params: CaptureFingerprintParams,
): Promise<CaptureFingerprintResult> {
  const api = getApi();
  if (!api) throw new Error('electronAPI is not available');
  return (await api.invoke(CONNECTIONS.CAPTURE_FINGERPRINT, params)) as CaptureFingerprintResult;
}

async function invokeAddConnection(params: AddConnectionParams): Promise<AddConnectionResult> {
  const api = getApi();
  if (!api) throw new Error('electronAPI is not available');
  return (await api.invoke(CONNECTIONS.ADD, params)) as AddConnectionResult;
}

async function invokeUpdateConnection(
  params: UpdateConnectionParams,
): Promise<UpdateConnectionResult> {
  const api = getApi();
  if (!api) throw new Error('electronAPI is not available');
  return (await api.invoke(CONNECTIONS.UPDATE, params)) as UpdateConnectionResult;
}

async function invokeTestConnection(params: TestConnectionParams): Promise<TestConnectionResult> {
  const api = getApi();
  if (!api) throw new Error('electronAPI is not available');
  return (await api.invoke(CONNECTIONS.TEST, params)) as TestConnectionResult;
}

async function invokeRotateConnectionSecret(
  params: RotateConnectionSecretParams,
): Promise<RotateConnectionSecretResult> {
  const api = getApi();
  if (!api) throw new Error('electronAPI is not available');
  return (await api.invoke(CONNECTIONS.ROTATE_SECRET, params)) as RotateConnectionSecretResult;
}

async function invokeOpenConnection(params: OpenConnectionParams): Promise<OpenConnectionResult> {
  const api = getApi();
  if (!api) throw new Error('electronAPI is not available');
  return (await api.invoke(CONNECTIONS.OPEN, params)) as OpenConnectionResult;
}

async function invokeForgetConnection(
  params: ForgetConnectionParams,
): Promise<ForgetConnectionResult> {
  const api = getApi();
  if (!api) throw new Error('electronAPI is not available');
  return (await api.invoke(CONNECTIONS.FORGET, params)) as ForgetConnectionResult;
}

async function invokeUpdateBackend(params: UpdateBackendParams): Promise<UpdateBackendResult> {
  const api = getApi();
  if (!api) throw new Error('electronAPI is not available');
  return (await api.invoke(CONNECTIONS.UPDATE_BACKEND, params)) as UpdateBackendResult;
}

/**
 * Toast the structured `connections:update-backend` outcome. Lazy imports
 * (same pattern as the boot-fallback toast) keep the saga module light.
 */
async function showUpdateBackendToast(result: UpdateBackendResult): Promise<void> {
  const [{ toast }, { m }] = await Promise.all([
    import('svelte-sonner'),
    import('$shared/paraglide/messages.js'),
  ]);
  if (result.ok) {
    toast.success(m.layout_daemonStatus_updateRequested_toast());
  } else if (result.reason === 'unsupported') {
    toast.error(m.layout_daemonStatus_updateUnsupported_toast());
  } else if (result.reason === 'not-connected') {
    toast.error(m.layout_daemonStatus_updateNotConnected_toast());
  } else {
    toast.error(m.layout_daemonStatus_updateFailed_toast({ message: result.message ?? '' }));
  }
}

/**
 * Generic toast for an IPC-level update failure (validation, bridge
 * unavailable) — internal error text like "electronAPI is not available" is
 * not user-oriented, unlike daemon-side 'failed' messages.
 */
async function showUpdateBackendRequestErrorToast(): Promise<void> {
  const [{ toast }, { m }] = await Promise.all([
    import('svelte-sonner'),
    import('$shared/paraglide/messages.js'),
  ]);
  toast.error(m.layout_daemonStatus_updateRequestError_toast());
}

/** Long enough to act on the Update action, short enough not to nag. */
const DAEMON_BEHIND_TOAST_DURATION_MS = 10000;

type UpdateBackendAction = ReturnType<typeof updateBackendRequested>;

/**
 * Toast a remote whose daemon just connected behind the app's pinned intentd
 * version, with an Update action. Same lazy imports as the other update
 * toasts; the per-connection toast id makes a reconnect update the existing
 * toast instead of stacking a new one.
 */
async function showDaemonBehindPinToast(
  conn: ConnectionRecord,
  daemonVersion: string,
  pinnedVersion: string,
  onUpdate: () => void,
): Promise<void> {
  const [{ toast }, { m }] = await Promise.all([
    import('svelte-sonner'),
    import('$shared/paraglide/messages.js'),
  ]);
  toast.warning(
    m.layout_daemonStatus_daemonBehind_toast({
      name: formatConnectionLabel(conn),
      // The message template prepends "v" — strip any reported prefix (same as DeviceRow).
      daemonVersion: daemonVersion.replace(/^v/, ''),
      pinnedVersion: pinnedVersion.replace(/^v/, ''),
    }),
    {
      id: `connections-daemon-behind-${conn.id}`,
      duration: DAEMON_BEHIND_TOAST_DURATION_MS,
      action: { label: m.layout_daemonStatus_update_action(), onClick: onUpdate },
    },
  );
}

/**
 * The behind-pin announcements already evaluated: connected remote id → the
 * `daemonVersion` that was evaluated. Saga-local mutable state shared between
 * the hydration path (startup seeding + announcement) and the
 * `connections:changed` consumer.
 */
interface DaemonBehindTracker {
  evaluatedById: ReadonlyMap<string, string>;
}

/**
 * Toast the window's own backend (`windowBackendId`) when it is a connected
 * remote whose daemon is behind the app's pin, once per (id, daemonVersion)
 * while it stays connected. Other backends' connections are skipped entirely
 * (not tracked either), so a window never announces a daemon it isn't bound
 * to and the tracker semantics cover the window's backend only. An id only
 * counts as
 * evaluated when the check was conclusive (both `daemonVersion` and
 * `pinnedVersion` present) — the daemon-version capture on connect is
 * fire-and-forget, so the 'connected' broadcast can precede the
 * version-bearing one; deferring keeps that follow-up broadcast counting as
 * the transition, and a version refresh re-evaluates (the per-id toast id
 * updates in place rather than stacking). Re-broadcasts of an unchanged pool
 * stay silent; a disconnect clears the id so a reconnect announces again.
 * The Update action feeds `updateActions` (pumped back into the store as an
 * `updateBackendRequested` dispatch); the outcome then surfaces via the
 * existing per-result update toasts.
 */
function* announceDaemonsBehindPin(
  payload: ConnectionsChangedEvent,
  tracker: DaemonBehindTracker,
  updateActions: Channel<UpdateBackendAction>,
): SagaGenerator<void> {
  const { connections, connectedIds, pinnedVersion, windowBackendId } = payload;
  // Older main process without connected info: nothing to evaluate.
  if (!connectedIds) return;
  const previous = tracker.evaluatedById;
  const evaluated = new Map<string, string>();
  for (const conn of connections) {
    if (conn.id !== windowBackendId) continue;
    if (conn.isLocal || !connectedIds.includes(conn.id)) continue;
    const { daemonVersion } = conn;
    if (!daemonVersion || !pinnedVersion) continue;
    evaluated.set(conn.id, daemonVersion);
    if (previous.get(conn.id) === daemonVersion) continue;
    if (!canRequestDeviceUpdate(conn, connectedIds, pinnedVersion)) continue;
    yield* call(showDaemonBehindPinToast, conn, daemonVersion, pinnedVersion, () => {
      const action = updateBackendRequested(conn.id);
      // Failure feedback is the update saga's toast; the unobserved promise
      // must not surface as an unhandled rejection.
      action.promise.catch(() => {});
      updateActions.put(action);
    });
  }
  tracker.evaluatedById = evaluated;
}

async function invokeSyncGetState(): Promise<KeychainSyncStateResult> {
  const api = getApi();
  if (!api) throw new Error('electronAPI is not available');
  return (await api.invoke(CONNECTIONS.SYNC_GET_STATE)) as KeychainSyncStateResult;
}

async function invokeSyncSetEnabled(
  params: SetKeychainSyncEnabledParams,
): Promise<KeychainSyncStateResult> {
  const api = getApi();
  if (!api) throw new Error('electronAPI is not available');
  return (await api.invoke(CONNECTIONS.SYNC_SET_ENABLED, params)) as KeychainSyncStateResult;
}

function* hydrateConnections(
  tracker: DaemonBehindTracker,
  updateActions: Channel<UpdateBackendAction>,
  action: ReturnType<typeof loadConnectionsRequested>,
): SagaGenerator<void> {
  let settled = false;
  try {
    const result = yield* call(invokeConnectionsList);
    yield* put(connectionsListReceived(result));
    // Deliberate startup announcement: the boot-wide restore connects pooled
    // clients before windows exist (see the cert-mismatch note below), so a
    // backend already connected behind the pin would otherwise never toast.
    // The shared tracker keeps later `connections:changed` broadcasts silent
    // for the same (id, daemonVersion).
    yield* call(announceDaemonsBehindPin, result, tracker, updateActions);
    if (result.protocolMismatch) yield* put(protocolMismatchReceived(result.protocolMismatch));
    // Replay the latched auth rejection for the active backend so a window
    // created/reloaded after the one-shot push (including boot) still surfaces
    // the actionable state.
    if (result.authRejected) yield* put(authRejectedReceived(result.authRejected));
    // Replay the latched cert mismatch the same way — the boot-wide restore
    // connects pooled clients before their windows exist, so the one-shot
    // `connections:cert-mismatch` push can fire into zero windows. Initial
    // hydration only: syncing it from every `connections:changed` push would
    // reopen a modal the user already dismissed.
    if (result.certMismatch) yield* put(certMismatchReceived(result.certMismatch));
    yield* put(action.success(undefined as never));
    settled = true;
  } catch (error) {
    yield* put(action.failure(toError(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error('Connections hydration was cancelled')));
    }
  }
}

function* captureFingerprint(
  action: ReturnType<typeof captureFingerprintRequested>,
): SagaGenerator<void> {
  let settled = false;
  try {
    const result = yield* call(invokeCaptureFingerprint, action.payload[0]);
    yield* put(action.success(result));
    settled = true;
  } catch (error) {
    yield* put(action.failure(toError(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('Fingerprint request was cancelled')));
  }
}

function* addConnection(action: ReturnType<typeof addConnectionRequested>): SagaGenerator<void> {
  let settled = false;
  yield* put(connectOperationStarted());
  try {
    const result = yield* call(invokeAddConnection, action.payload[0]);
    yield* put(connectOperationSettled());
    yield* put(action.success(result));
    settled = true;
  } catch (error) {
    const resolved = toError(error);
    yield* put(connectOperationFailed(resolved.message));
    yield* put(action.failure(resolved));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      const resolved = new Error('Connection add was cancelled');
      yield* put(connectOperationFailed(resolved.message));
      yield* put(action.failure(resolved));
    }
  }
}

function* forgetConnection(
  action: ReturnType<typeof forgetConnectionRequested>,
): SagaGenerator<void> {
  let settled = false;
  try {
    yield* call(invokeForgetConnection, { id: action.payload[0] });
    yield* put(action.success(undefined as never));
    settled = true;
  } catch (error) {
    yield* put(action.failure(toError(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('Connection forget was cancelled')));
  }
}

function* updateConnection(
  action: ReturnType<typeof updateConnectionRequested>,
): SagaGenerator<void> {
  let settled = false;
  try {
    const result = yield* call(invokeUpdateConnection, action.payload[0]);
    yield* put(action.success(result));
    settled = true;
  } catch (error) {
    yield* put(action.failure(toError(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('Connection update was cancelled')));
  }
}

function* testConnection(action: ReturnType<typeof testConnectionRequested>): SagaGenerator<void> {
  let settled = false;
  try {
    const result = yield* call(invokeTestConnection, action.payload[0]);
    yield* put(action.success(result));
    settled = true;
  } catch (error) {
    yield* put(action.failure(toError(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('Connection test was cancelled')));
  }
}

function* rotateConnectionSecret(
  action: ReturnType<typeof rotateConnectionSecretRequested>,
): SagaGenerator<void> {
  let settled = false;
  try {
    const result = yield* call(invokeRotateConnectionSecret, action.payload[0]);
    yield* put(action.success(result));
    settled = true;
  } catch (error) {
    yield* put(action.failure(toError(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('Secret rotation was cancelled')));
  }
}

function* openConnection(action: ReturnType<typeof openConnectionRequested>): SagaGenerator<void> {
  let settled = false;
  yield* put(connectOperationStarted());
  try {
    const result = yield* call(invokeOpenConnection, { id: action.payload[0] });
    yield* put(connectOperationSettled());
    yield* put(action.success(result));
    settled = true;
  } catch (error) {
    const resolved = toError(error);
    yield* put(connectOperationFailed(resolved.message));
    yield* put(action.failure(resolved));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      const resolved = new Error('Connection open was cancelled');
      yield* put(connectOperationFailed(resolved.message));
      yield* put(action.failure(resolved));
    }
  }
}

function* updateBackend(action: ReturnType<typeof updateBackendRequested>): SagaGenerator<void> {
  let settled = false;
  try {
    const result = yield* call(invokeUpdateBackend, { id: action.payload[0] });
    yield* call(showUpdateBackendToast, result);
    yield* put(action.success(result));
    settled = true;
  } catch (error) {
    // An IPC-level failure (validation, bridge unavailable) — daemon-side
    // failures come back as structured non-ok results, not throws.
    const resolved = toError(error);
    yield* call(showUpdateBackendRequestErrorToast);
    yield* put(action.failure(resolved));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('Backend update request was cancelled')));
  }
}

function* loadKeychainSyncState(
  action: ReturnType<typeof loadKeychainSyncStateRequested>,
): SagaGenerator<void> {
  let settled = false;
  try {
    const result = yield* call(invokeSyncGetState);
    yield* put(keychainSyncStateReceived(result));
    yield* put(action.success(result));
    settled = true;
  } catch (error) {
    yield* put(action.failure(toError(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('Keychain sync state load was cancelled')));
  }
}

function* setKeychainSyncEnabled(
  action: ReturnType<typeof setKeychainSyncEnabledRequested>,
): SagaGenerator<void> {
  let settled = false;
  try {
    const result = yield* call(invokeSyncSetEnabled, { enabled: action.payload[0] });
    yield* put(keychainSyncStateReceived(result));
    yield* put(action.success(result));
    settled = true;
  } catch (error) {
    yield* put(action.failure(toError(error)));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('Keychain sync toggle was cancelled')));
  }
}

function* consumeConnectionsEvents(
  channel: EventChannel<ConnectionsEvent>,
  tracker: DaemonBehindTracker,
  updateActions: Channel<UpdateBackendAction>,
): SagaGenerator<void> {
  try {
    while (true) {
      const event = yield* take(channel);
      if (event === (END as unknown as ConnectionsEvent)) return;
      if (event.kind === 'changed') {
        yield* put(connectionsListReceived(event.payload));
        yield* call(announceDaemonsBehindPin, event.payload, tracker, updateActions);
      } else if (event.kind === 'cert-mismatch') yield* put(certMismatchReceived(event.payload));
      else if (event.kind === 'auth-rejected') yield* put(authRejectedReceived(event.payload));
      else if (event.kind === 'sync-status') yield* put(keychainSyncStatusReceived(event.payload));
      else yield* put(protocolMismatchReceived(event.payload));
    }
  } finally {
    channel.close();
  }
}

function* watchConnectionsActions(
  tracker: DaemonBehindTracker,
  updateActions: Channel<UpdateBackendAction>,
): SagaGenerator<void> {
  yield* all([
    takeLeading(loadConnectionsRequested, hydrateConnections, tracker, updateActions),
    takeLeading(captureFingerprintRequested, captureFingerprint),
    takeLeading(addConnectionRequested, addConnection),
    takeEvery(updateConnectionRequested, updateConnection),
    takeEvery(testConnectionRequested, testConnection),
    takeEvery(rotateConnectionSecretRequested, rotateConnectionSecret),
    takeLeading(openConnectionRequested, openConnection),
    takeLeading(forgetConnectionRequested, forgetConnection),
    // takeEvery, not takeLeading: each action targets one backend id, and
    // multiple connected remotes can be updated back-to-back — takeLeading
    // would drop the second action, leaving its promise unresolved and the
    // user without a toast.
    takeEvery(updateBackendRequested, updateBackend),
    takeLeading(loadKeychainSyncStateRequested, loadKeychainSyncState),
    takeLeading(setKeychainSyncEnabledRequested, setKeychainSyncEnabled),
  ]);
}

/** Re-dispatch toast-action clicks into the store (a toast onClick runs outside saga context). */
function* pumpUpdateActions(updateActions: Channel<UpdateBackendAction>): SagaGenerator<void> {
  while (true) {
    const action = yield* take(updateActions);
    yield* put(action);
  }
}

export function* connectionsSaga(): SagaGenerator<void> {
  if (!getApi()) return;

  const events = createConnectionsEventChannel();
  const updateActions = sagaChannel<UpdateBackendAction>();
  const tracker: DaemonBehindTracker = { evaluatedById: new Map() };
  const eventTask = yield* fork(consumeConnectionsEvents, events, tracker, updateActions);
  const pumpTask = yield* fork(pumpUpdateActions, updateActions);
  const actionsTask = yield* fork(watchConnectionsActions, tracker, updateActions);
  const initial = loadConnectionsRequested();
  try {
    yield* call(hydrateConnections, tracker, updateActions, initial);
    yield* all([join(eventTask), join(pumpTask), join(actionsTask)]);
  } finally {
    events.close();
    updateActions.close();
  }
}
