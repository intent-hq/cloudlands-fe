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
  actionChannel,
  call,
  cancelled,
  fork,
  join,
  put,
  take,
  takeLatest,
  type SagaGenerator,
} from 'typed-redux-saga';

import { canRequestDeviceUpdate } from '$lib/utils/device-update-eligibility';
import { formatConnectionLabel, formatGuestSessionLabel } from '$lib/utils/connection-label';
import { takeEveryByContextFIFO, takeLatestInContext } from '../../../utils/context-saga-effects';
import {
  selectConnectionWorkflow,
  selectKeychainSyncState,
  selectSelfPublication,
  selectConnectionRecoveryTarget,
} from '../connections-selectors';
import type { ConnectionWorkflowOutcome } from '../connections-types';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  CONNECTIONS_CHANGED_EVENT,
  CONNECTION_AUTH_REJECTED_EVENT,
  CONNECTION_CERT_MISMATCH_EVENT,
  CONNECTION_CERT_WARNINGS_EVENT,
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
  ConnectionCertWarningsEvent,
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
  PublishSelfResult,
  SelfPublishedStateResult,
  UnpublishSelfResult,
} from '$shared/types/connections';
import {
  addConnectionRequested,
  authRejectedReceived,
  certMismatchReceived,
  certWarningsReceived,
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
  openOperationFailed,
  openOperationSettled,
  openOperationStarted,
  protocolMismatchReceived,
  rotateConnectionSecretRequested,
  setKeychainSyncEnabledRequested,
  testConnectionRequested,
  updateConnectionRequested,
  updateBackendRequested,
  connectionWorkflowRequested,
  connectionWorkflowCleared,
  connectionWorkflowProgress,
  connectionWorkflowFinished,
  selfPublicationRequested,
  selfPublicationReceived,
  selfPublicationBusyChanged,
} from '../connections-slice';

const CONNECTIONS = IPC_CHANNELS.CONNECTIONS;

type ConnectionsEvent =
  | { kind: 'changed'; payload: ConnectionsChangedEvent }
  | { kind: 'cert-mismatch'; payload: ConnectionCertMismatchEvent }
  | { kind: 'cert-warnings'; payload: ConnectionCertWarningsEvent }
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
        CONNECTION_CERT_WARNINGS_EVENT,
        api.on(CONNECTION_CERT_WARNINGS_EVENT, (payload: ConnectionCertWarningsEvent) =>
          emit({ kind: 'cert-warnings', payload }),
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
  const [{ notify }, { m }] = await Promise.all([
    import('$lib/components/patterns/notify'),
    import('$shared/paraglide/messages.js'),
  ]);
  if (result.ok) {
    notify.success(m.layout_daemonStatus_updateRequested_toast());
  } else if (result.reason === 'unsupported') {
    notify.error(m.layout_daemonStatus_updateUnsupported_toast());
  } else if (result.reason === 'not-connected') {
    notify.error(m.layout_daemonStatus_updateNotConnected_toast());
  } else {
    notify.error(m.layout_daemonStatus_updateFailed_toast({ message: result.message ?? '' }));
  }
}

/**
 * Generic toast for an IPC-level update failure (validation, bridge
 * unavailable) — internal error text like "electronAPI is not available" is
 * not user-oriented, unlike daemon-side 'failed' messages.
 */
async function showUpdateBackendRequestErrorToast(): Promise<void> {
  const [{ notify }, { m }] = await Promise.all([
    import('$lib/components/patterns/notify'),
    import('$shared/paraglide/messages.js'),
  ]);
  notify.error(m.layout_daemonStatus_updateRequestError_toast());
}

type UpdateBackendAction = ReturnType<typeof updateBackendRequested>;

/**
 * Toast a backend whose daemon just connected behind the app's pinned intentd
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
  const [{ notify }, { m }] = await Promise.all([
    import('$lib/components/patterns/notify'),
    import('$shared/paraglide/messages.js'),
  ]);
  notify.warning(
    m.layout_daemonStatus_daemonBehind_toast({
      // The local entry's persisted label is an English fallback — use the
      // localized label, same as DeviceRow and the daemon-status menu.
      name: conn.isLocal
        ? m.layout_daemonStatus_localConnection_label()
        : formatConnectionLabel(conn),
      // The message template prepends "v" — strip any reported prefix (same as DeviceRow).
      daemonVersion: daemonVersion.replace(/^v/, ''),
      pinnedVersion: pinnedVersion.replace(/^v/, ''),
    }),
    {
      id: `connections-daemon-behind-${conn.id}`,
      // Sticky: never auto-dismisses — announceDaemonsBehindPin dismisses it
      // programmatically once the backend stops qualifying.
      duration: Number.POSITIVE_INFINITY,
      action: { label: m.layout_daemonStatus_update_action(), onClick: onUpdate },
    },
  );
}

/** Dismiss a behind-pin toast previously raised for `connectionId`. */
async function dismissDaemonBehindPinToast(connectionId: string): Promise<void> {
  const { notify } = await import('$lib/components/patterns/notify');
  notify.dismiss(`connections-daemon-behind-${connectionId}`);
}

/**
 * The behind-pin announcements already evaluated: connected backend id → the
 * `daemonVersion` that was evaluated, plus the ids whose sticky toast is
 * currently shown (so dismissal only fires for toasts actually raised).
 * Saga-local mutable state shared between the hydration path (startup seeding
 * + announcement) and the `connections:changed` consumer.
 */
interface DaemonBehindTracker {
  evaluatedById: ReadonlyMap<string, string>;
  toastedIds: ReadonlySet<string>;
}

/**
 * Toast the window's own backend (`windowBackendId`) when it is a connected
 * backend whose daemon is behind the app's pin, once per
 * (id, daemonVersion, updateSupported) while it stays connected. The local
 * entry is evaluated like a remote: its record only carries
 * `daemonVersion`/`updateSupported` for an adopted external daemon over UDS,
 * so the spawned sidecar (which carries neither) stays silent naturally.
 * Other backends' connections are skipped entirely (not tracked either), so a
 * window never announces a daemon it isn't bound to and the tracker semantics
 * cover the window's backend only. An id only counts as
 * evaluated when the check was conclusive (`daemonVersion`, `pinnedVersion`,
 * and `updateSupported` all present) — the daemon-version and updateSupported
 * captures on connect are fire-and-forget, so the 'connected' broadcast can
 * precede the value-bearing ones; deferring keeps those follow-up broadcasts
 * counting as the transition, and a version OR flag refresh re-evaluates (the
 * per-id toast id updates in place rather than stacking) — so a daemon whose
 * flag flips false→true at an unchanged version still gets its toast.
 * Re-broadcasts of an
 * unchanged pool stay silent; a disconnect clears the id so a reconnect
 * announces again. Daemons that report `updateSupported: false` are evaluated
 * but never toasted (the Update affordance is gated on explicit support —
 * the Devices-page behind-pin badge stays as the informational surface).
 * The toast is sticky (no auto-dismiss), so this saga also dismisses it once
 * the backend stops qualifying: it disconnects, or a re-evaluation finds it no
 * longer behind the pin (e.g. back at/above the pinned version). An
 * inconclusive re-broadcast (version/flag capture in flight) keeps a shown
 * toast — it is no verdict either way. Dismissal only fires for toasts
 * actually raised, tracked via `tracker.toastedIds`.
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
  const previousToasted = tracker.toastedIds;
  const evaluated = new Map<string, string>();
  const toasted = new Set<string>();
  for (const conn of connections) {
    if (conn.id !== windowBackendId) continue;
    if (!connectedIds.includes(conn.id)) continue;
    const { daemonVersion } = conn;
    // Inconclusive while connected: keep a shown toast (no dismissal verdict).
    if (!daemonVersion || !pinnedVersion) {
      if (previousToasted.has(conn.id)) toasted.add(conn.id);
      continue;
    }
    // The updateSupported capture is fire-and-forget like the version
    // capture: unknown (absent/null) is inconclusive, so the flag-bearing
    // follow-up broadcast still counts as the transition. An explicit
    // `false` IS conclusive — evaluated but suppressed below. The flag is
    // part of the evaluated value so a false→true refresh at an unchanged
    // daemonVersion re-evaluates (and toasts) like a version refresh.
    if (conn.updateSupported == null) {
      if (previousToasted.has(conn.id)) toasted.add(conn.id);
      continue;
    }
    const evaluatedValue = `${daemonVersion}|${conn.updateSupported}`;
    evaluated.set(conn.id, evaluatedValue);
    if (previous.get(conn.id) === evaluatedValue) {
      // Unchanged re-broadcast: the sticky toast (if raised) is still valid.
      if (previousToasted.has(conn.id)) toasted.add(conn.id);
      continue;
    }
    if (!canRequestDeviceUpdate(conn, connectedIds, pinnedVersion)) continue;
    yield* call(showDaemonBehindPinToast, conn, daemonVersion, pinnedVersion, () => {
      const action = updateBackendRequested(conn.id);
      // Failure feedback is the update saga's toast; the unobserved promise
      // must not surface as an unhandled rejection.
      action.promise.catch(() => {});
      updateActions.put(action);
    });
    toasted.add(conn.id);
  }
  // A previously raised toast whose backend stopped qualifying (disconnected,
  // or re-evaluated as no longer behind the pin) no longer applies.
  for (const id of previousToasted) {
    if (!toasted.has(id)) yield* call(dismissDaemonBehindPinToast, id);
  }
  tracker.evaluatedById = evaluated;
  tracker.toastedIds = toasted;
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
  const id = action.payload[0];
  let settled = false;
  yield* put(openOperationStarted(id));
  try {
    const result = yield* call(invokeOpenConnection, { id });
    yield* put(openOperationSettled(id));
    yield* put(action.success(result));
    settled = true;
  } catch (error) {
    const resolved = toError(error);
    yield* put(openOperationFailed(id, resolved.message));
    yield* put(action.failure(resolved));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      const resolved = new Error('Connection open was cancelled');
      yield* put(openOperationFailed(id, resolved.message));
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
      else if (event.kind === 'cert-warnings') yield* put(certWarningsReceived(event.payload));
      else if (event.kind === 'auth-rejected') yield* put(authRejectedReceived(event.payload));
      else if (event.kind === 'sync-status') yield* put(keychainSyncStatusReceived(event.payload));
      else yield* put(protocolMismatchReceived(event.payload));
    }
  } finally {
    channel.close();
  }
}

type WorkflowAction = ReturnType<typeof connectionWorkflowRequested>;
type WriteAction =
  | ReturnType<
      | typeof addConnectionRequested
      | typeof updateConnectionRequested
      | typeof rotateConnectionSecretRequested
      | typeof openConnectionRequested
      | typeof forgetConnectionRequested
      | typeof updateBackendRequested
      | typeof loadKeychainSyncStateRequested
      | typeof setKeychainSyncEnabledRequested
      | typeof selfPublicationRequested
    >
  | WorkflowAction;

function writeKey(action: WriteAction): string {
  if (action.type === connectionWorkflowRequested.toString()) {
    const { intent } = (action as WorkflowAction).payload;
    if (intent.kind === 'connect') return `target:${intent.params.host}:${intent.params.port}`;
    if ('id' in intent) return `device:${intent.id}`;
    if ('id' in intent.params) return `device:${intent.params.id}`;
    return 'capture';
  }
  if (action.type === addConnectionRequested.toString()) {
    const [params] = (action as ReturnType<typeof addConnectionRequested>).payload;
    return `target:${params.host}:${params.port}`;
  }
  const first = (action as Exclude<WriteAction, WorkflowAction>).payload[0];
  if (typeof first === 'string' && action.type !== selfPublicationRequested.toString())
    return `device:${first}`;
  if (typeof first === 'object' && first && 'id' in first) return `device:${first.id}`;
  return 'keychain';
}

function* discardWrite(action: WriteAction): SagaGenerator<void> {
  if (action.type === connectionWorkflowRequested.toString()) {
    const { consumerId, requestId } = (action as WorkflowAction).payload;
    yield* put(connectionWorkflowFinished(consumerId, requestId, { kind: 'cancelled' }));
  } else {
    yield* put(
      (action as Exclude<WriteAction, WorkflowAction>).failure(
        new Error('Connection request was cancelled'),
      ),
    );
  }
}

function* enableSyncForWorkflow(action: WorkflowAction): SagaGenerator<boolean> {
  const { consumerId, requestId } = action.payload;
  yield* put(connectionWorkflowProgress(consumerId, requestId, 'sync'));
  const sync = setKeychainSyncEnabledRequested(true);
  yield* put(sync);
  try {
    yield* call(() => sync.promise);
    return true;
  } catch (error) {
    yield* put(
      connectionWorkflowFinished(consumerId, requestId, {
        kind: 'syncError',
        message: toError(error).message,
      }),
    );
    return false;
  }
}

function* workflowIsCurrent(action: WorkflowAction): SagaGenerator<boolean> {
  const current = yield* selectConnectionWorkflow.effect(action.payload.consumerId);
  return current?.requestId === action.payload.requestId;
}

function* recoverOpenInSettings(action: WorkflowAction, id: string): SagaGenerator<void> {
  const [{ notify }, { m }, { navigateToSettings }] = yield* call(() =>
    Promise.all([
      import('$lib/components/patterns/notify'),
      import('$shared/paraglide/messages.js'),
      import('$lib/utils/workspace-navigation'),
    ]),
  );
  if (!(yield* workflowIsCurrent(action))) return;
  const { guest, connection } = yield* selectConnectionRecoveryTarget.effect(id);
  yield* call(
    notify.error,
    guest
      ? m.layout_daemonStatus_guestSecretUnavailable_error({
          label: formatGuestSessionLabel(guest),
        })
      : m.layout_daemonStatus_secretUnavailable_error({
          label:
            connection && !connection.isLocal
              ? formatConnectionLabel(connection)
              : m.layout_daemonStatus_localConnection_label(),
        }),
  );
  if (yield* workflowIsCurrent(action))
    yield* call(navigateToSettings, { tab: guest ? 'guest-sessions' : 'devices' });
}

function* runWorkflow(action: WorkflowAction): SagaGenerator<void> {
  const { consumerId, requestId, intent } = action.payload;
  let outcome: ConnectionWorkflowOutcome = { kind: 'done' };
  try {
    if (!(yield* workflowIsCurrent(action))) return;
    if (intent.kind === 'capture') {
      const result = yield* call(invokeCaptureFingerprint, intent.params);
      outcome = result.tokenValid
        ? { kind: 'captured', fingerprint: result.fingerprint }
        : { kind: 'captureRejected', statusCode: result.statusCode };
    } else if (intent.kind === 'connect') {
      const add = addConnectionRequested(intent.params);
      add.promise.catch(() => {});
      yield* call(addConnection, add);
      const { connection } = yield* call(() => add.promise);
      if (!(yield* workflowIsCurrent(action))) return;
      if (intent.enableSync && !(yield* enableSyncForWorkflow(action))) return;
      if (!(yield* workflowIsCurrent(action))) return;
      const open = openConnectionRequested(connection.id);
      open.promise.catch(() => {});
      yield* call(openConnection, open);
      const result = yield* call(() => open.promise);
      if (result.status === 'secret-unavailable') outcome = { kind: 'secretUnavailable' };
    } else if (intent.kind === 'save' || intent.kind === 'localIcon') {
      if (intent.kind === 'save' && intent.secret) {
        yield* put(connectionWorkflowProgress(consumerId, requestId, 'secret'));
        const result = yield* call(invokeRotateConnectionSecret, intent.secret);
        if (result.status !== 'updated') {
          yield* put(
            connectionWorkflowFinished(consumerId, requestId, {
              kind: 'blocked',
              operation: 'secret',
              result,
            }),
          );
          return;
        }
        yield* put(connectionWorkflowProgress(consumerId, requestId, 'running', true));
      }
      if (!(yield* workflowIsCurrent(action))) return;
      const result = yield* call(invokeUpdateConnection, intent.params);
      if (result.status !== 'updated') {
        outcome =
          result.status === 'secret-unavailable'
            ? { kind: 'secretUnavailable' }
            : { kind: 'blocked', operation: 'update', result };
      } else if (
        intent.kind === 'save' &&
        intent.enableSync &&
        (yield* workflowIsCurrent(action))
      ) {
        if (!(yield* enableSyncForWorkflow(action))) return;
      }
    } else if (intent.kind === 'test') {
      const result = yield* call(invokeTestConnection, intent.params);
      outcome =
        result.status === 'success'
          ? { kind: 'tested' }
          : result.status === 'secret-unavailable'
            ? { kind: 'secretUnavailable' }
            : { kind: 'blocked', operation: 'test', result };
    } else if (intent.kind === 'open') {
      const open = openConnectionRequested(intent.id);
      open.promise.catch(() => {});
      yield* call(openConnection, open);
      const result = yield* call(() => open.promise);
      if (result.status === 'secret-unavailable') {
        outcome = { kind: 'secretUnavailable' };
        if (intent.recovery === 'settings' && (yield* workflowIsCurrent(action)))
          yield* recoverOpenInSettings(action, intent.id);
      }
    } else if (intent.kind === 'forget') {
      yield* call(invokeForgetConnection, { id: intent.id });
    } else {
      const update = updateBackendRequested(intent.id);
      update.promise.catch(() => {});
      yield* call(updateBackend, update);
      yield* call(() => update.promise);
    }
    yield* put(connectionWorkflowFinished(consumerId, requestId, outcome));
  } catch (error) {
    yield* put(
      connectionWorkflowFinished(consumerId, requestId, {
        kind: 'error',
        message: toError(error).message,
      }),
    );
    if (intent.kind === 'localIcon') {
      const [{ notify }, { m }] = yield* call(() =>
        Promise.all([
          import('$lib/components/patterns/notify'),
          import('$shared/paraglide/messages.js'),
        ]),
      );
      yield* call(notify.error, m.settings_devices_update_error());
    }
  } finally {
    if (yield* cancelled())
      yield* put(connectionWorkflowFinished(consumerId, requestId, { kind: 'cancelled' }));
  }
}

function* publication(action: ReturnType<typeof selfPublicationRequested>): SagaGenerator<void> {
  const [operation] = action.payload;
  let settled = false;
  yield* put(selfPublicationBusyChanged(true));
  try {
    const api = getApi();
    if (!api) throw new Error('electronAPI is not available');
    if (operation === 'load') {
      const [sync, self] = yield* all([
        call(invokeSyncGetState),
        call([api, api.invoke], CONNECTIONS.SELF_PUBLISHED_STATE),
      ]);
      yield* put(keychainSyncStateReceived(sync));
      yield* put(selfPublicationReceived(self as SelfPublishedStateResult));
    } else if (operation === 'refresh') {
      yield* call([api, api.invoke], CONNECTIONS.REFRESH_SELF);
    } else {
      const sync = yield* selectKeychainSyncState.effect();
      const self = yield* selectSelfPublication.effect();
      const publish =
        operation === 'publish' ||
        (operation === 'autoPublish' &&
          sync?.supported &&
          sync.enabled &&
          self &&
          !self.published &&
          !self.suppressed);
      const unpublish = operation === 'autoUnpublish' && sync?.supported && self?.published;
      if (publish || unpublish) {
        const [{ notify }, { m }] = yield* call(() =>
          Promise.all([
            import('$lib/components/patterns/notify'),
            import('$shared/paraglide/messages.js'),
          ]),
        );
        if (publish) {
          const result = (yield* call(
            [api, api.invoke],
            CONNECTIONS.PUBLISH_SELF,
          )) as PublishSelfResult;
          yield* put(
            selfPublicationReceived({
              published: true,
              suppressed: false,
              selfConnectionId: result.connection.id,
            }),
          );
          yield* call(notify.success, m.settings_wsApi_publishSelf_success());
        } else {
          const result = (yield* call(
            [api, api.invoke],
            CONNECTIONS.UNPUBLISH_SELF,
          )) as UnpublishSelfResult;
          yield* put(
            selfPublicationReceived({
              published: false,
              suppressed: self?.suppressed ?? false,
              selfConnectionId: null,
            }),
          );
          if (result.removed) yield* call(notify.success, m.settings_wsApi_unpublishSelf_success());
        }
      }
    }
    yield* put(action.success(undefined as never));
    settled = true;
  } catch (error) {
    if (operation === 'load') yield* put(selfPublicationReceived(null));
    else if (operation !== 'refresh') {
      const [{ notify }, { m }] = yield* call(() =>
        Promise.all([
          import('$lib/components/patterns/notify'),
          import('$shared/paraglide/messages.js'),
        ]),
      );
      const params = { error: toError(error).message };
      yield* call(
        notify.error,
        operation === 'autoUnpublish'
          ? m.settings_wsApi_unpublishSelf_error(params)
          : m.settings_wsApi_publishSelf_error(params),
      );
    }
    yield* put(action.failure(toError(error)));
    settled = true;
  } finally {
    yield* put(selfPublicationBusyChanged(false));
    if (!settled && (yield* cancelled()))
      yield* put(action.failure(new Error('Self publication was cancelled')));
  }
}

function* runWrite(action: WriteAction): SagaGenerator<void> {
  if (action.type === connectionWorkflowRequested.toString())
    yield* runWorkflow(action as WorkflowAction);
  else if (action.type === addConnectionRequested.toString())
    yield* addConnection(action as ReturnType<typeof addConnectionRequested>);
  else if (action.type === updateConnectionRequested.toString())
    yield* updateConnection(action as ReturnType<typeof updateConnectionRequested>);
  else if (action.type === rotateConnectionSecretRequested.toString())
    yield* rotateConnectionSecret(action as ReturnType<typeof rotateConnectionSecretRequested>);
  else if (action.type === openConnectionRequested.toString())
    yield* openConnection(action as ReturnType<typeof openConnectionRequested>);
  else if (action.type === forgetConnectionRequested.toString())
    yield* forgetConnection(action as ReturnType<typeof forgetConnectionRequested>);
  else if (action.type === updateBackendRequested.toString())
    yield* updateBackend(action as ReturnType<typeof updateBackendRequested>);
  else if (action.type === loadKeychainSyncStateRequested.toString())
    yield* loadKeychainSyncState(action as ReturnType<typeof loadKeychainSyncStateRequested>);
  else if (action.type === setKeychainSyncEnabledRequested.toString())
    yield* setKeychainSyncEnabled(action as ReturnType<typeof setKeychainSyncEnabledRequested>);
  else yield* publication(action as ReturnType<typeof selfPublicationRequested>);
}

function* watchWorkflowReads(
  reads: Channel<WorkflowAction | ReturnType<typeof connectionWorkflowCleared>>,
): SagaGenerator<void> {
  yield* takeLatestInContext(
    reads,
    (action) =>
      action.type === connectionWorkflowCleared.toString()
        ? (action as ReturnType<typeof connectionWorkflowCleared>).payload[0]
        : (action as WorkflowAction).payload.consumerId,
    function* (action) {
      if (action.type === connectionWorkflowRequested.toString())
        yield* runWorkflow(action as WorkflowAction);
    },
  );
}

function* watchConnectionsActions(
  tracker: DaemonBehindTracker,
  updateActions: Channel<UpdateBackendAction>,
): SagaGenerator<void> {
  const writes = sagaChannel<WriteAction>(buffers.expanding());
  const reads = sagaChannel<WorkflowAction | ReturnType<typeof connectionWorkflowCleared>>(
    buffers.expanding(),
  );
  const requests = yield* actionChannel(
    [
      connectionWorkflowRequested,
      connectionWorkflowCleared,
      addConnectionRequested,
      updateConnectionRequested,
      rotateConnectionSecretRequested,
      openConnectionRequested,
      forgetConnectionRequested,
      updateBackendRequested,
      loadKeychainSyncStateRequested,
      setKeychainSyncEnabledRequested,
      selfPublicationRequested,
    ],
    buffers.expanding(),
  );
  try {
    yield* takeEveryByContextFIFO(writes, writeKey, runWrite, { onDiscardPending: discardWrite });
    yield* fork(watchWorkflowReads, reads);
    yield* takeLatest(loadConnectionsRequested, hydrateConnections, tracker, updateActions);
    yield* takeLatestInContext(
      captureFingerprintRequested,
      (action) => `${action.payload[0].host}:${action.payload[0].port}`,
      captureFingerprint,
    );
    yield* takeLatestInContext(
      testConnectionRequested,
      (action) => action.payload[0].id,
      testConnection,
    );
    while (true) {
      const action = yield* take(requests);
      if (action.type === connectionWorkflowCleared.toString())
        yield* put(reads, action as ReturnType<typeof connectionWorkflowCleared>);
      else if (
        action.type === connectionWorkflowRequested.toString() &&
        ['capture', 'test'].includes((action as WorkflowAction).payload.intent.kind)
      )
        yield* put(reads, action as WorkflowAction);
      else yield* put(writes, action as WriteAction);
    }
  } finally {
    requests.close();
    writes.close();
    reads.close();
  }
}

/** Re-dispatch toast-action clicks into the store (a toast onClick runs outside saga context). */
function* pumpUpdateActions(updateActions: Channel<UpdateBackendAction>): SagaGenerator<void> {
  while (true) {
    const action = yield* take(updateActions);
    yield* put(action);
  }
}

export function* connectionsSaga(): SagaGenerator<void> {
  const events = createConnectionsEventChannel();
  const updateActions = sagaChannel<UpdateBackendAction>();
  const tracker: DaemonBehindTracker = { evaluatedById: new Map(), toastedIds: new Set() };
  const eventTask = yield* fork(consumeConnectionsEvents, events, tracker, updateActions);
  const pumpTask = yield* fork(pumpUpdateActions, updateActions);
  const actionsTask = yield* fork(watchConnectionsActions, tracker, updateActions);
  const initial = loadConnectionsRequested();
  initial.promise.catch(() => {});
  try {
    yield* put(initial);
    yield* all([join(eventTask), join(pumpTask), join(actionsTask)]);
  } finally {
    events.close();
    updateActions.close();
  }
}
