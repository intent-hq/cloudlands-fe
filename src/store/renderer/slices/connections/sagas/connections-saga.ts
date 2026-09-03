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

import { canRequestDeviceUpdate, isDaemonBehindPin } from '$lib/utils/device-update-eligibility';
import { formatConnectionLabel } from '$lib/utils/connection-label';
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
async function showUpdateBackendToast(id: string, result?: UpdateBackendResult): Promise<void> {
  const [{ toast }, { m }] = await Promise.all([
    import('svelte-sonner'),
    import('$shared/paraglide/messages.js'),
  ]);
  const options = { id: `connections-update-${id}` };
  if (!result) {
    toast.info(m.layout_daemonStatus_updateRequested_toast(), {
      ...options,
      duration: Number.POSITIVE_INFINITY,
    });
  } else if (result.ok) {
    toast.success(
      m.layout_daemonStatus_updateCompleted_toast({ version: result.version }),
      options,
    );
  } else if (result.reason === 'unsupported' || result.reason === 'invalid-ack') {
    toast.error(m.layout_daemonStatus_updateUnsupported_toast(), options);
  } else if (result.reason === 'not-connected') {
    toast.error(m.layout_daemonStatus_updateNotConnected_toast(), options);
  } else if (result.reason === 'invalid-pin') {
    toast.error(m.layout_daemonStatus_updateInvalidPin_toast(), options);
  } else if (result.reason === 'busy') {
    toast.error(m.layout_daemonStatus_updateBusy_toast(), options);
  } else if (result.reason === 'timeout') {
    toast.error(m.layout_daemonStatus_updateTimeout_toast(), options);
  } else if (result.reason === 'version-mismatch') {
    toast.error(
      m.layout_daemonStatus_updateMismatch_toast({
        version: result.version ?? '',
        actualVersion: result.actualVersion ?? '?',
      }),
      options,
    );
  } else {
    toast.error(
      m.layout_daemonStatus_updateFailed_toast({ message: result.message ?? '' }),
      options,
    );
  }
}

/**
 * Generic toast for an IPC-level update failure (validation, bridge
 * unavailable) — internal error text like "electronAPI is not available" is
 * not user-oriented, unlike daemon-side 'failed' messages.
 */
async function showUpdateBackendRequestErrorToast(id: string): Promise<void> {
  const [{ toast }, { m }] = await Promise.all([
    import('svelte-sonner'),
    import('$shared/paraglide/messages.js'),
  ]);
  toast.error(m.layout_daemonStatus_updateRequestError_toast(), { id: `connections-update-${id}` });
}

async function dismissUpdateBackendToast(id: string): Promise<void> {
  const { toast } = await import('svelte-sonner');
  toast.dismiss(`connections-update-${id}`);
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
  onUpdate: (() => void) | undefined,
): Promise<void> {
  const [{ toast }, { m }] = await Promise.all([
    import('svelte-sonner'),
    import('$shared/paraglide/messages.js'),
  ]);
  toast.warning(
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
      ...(onUpdate
        ? { action: { label: m.layout_daemonStatus_update_action(), onClick: onUpdate } }
        : { description: m.layout_daemonStatus_updateUnsupported_toast() }),
    },
  );
}

/** Dismiss a behind-pin toast previously raised for `connectionId`. */
async function dismissDaemonBehindPinToast(connectionId: string): Promise<void> {
  const { toast } = await import('svelte-sonner');
  toast.dismiss(`connections-daemon-behind-${connectionId}`);
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
    const evaluatedValue = `${daemonVersion}|${conn.updateSupported}|${conn.exactVersionUpdateSupported}|${pinnedVersion}`;
    evaluated.set(conn.id, evaluatedValue);
    if (previous.get(conn.id) === evaluatedValue) {
      // Unchanged re-broadcast: the sticky toast (if raised) is still valid.
      if (previousToasted.has(conn.id)) toasted.add(conn.id);
      continue;
    }
    if (conn.updateSupported !== true || !isDaemonBehindPin(conn, pinnedVersion)) continue;
    const onUpdate = canRequestDeviceUpdate(conn, connectedIds, pinnedVersion)
      ? () => {
          const action = updateBackendRequested(conn.id);
          // Failure feedback is the update saga's toast; the unobserved promise
          // must not surface as an unhandled rejection.
          action.promise.catch(() => {});
          updateActions.put(action);
        }
      : undefined;
    yield* call(showDaemonBehindPinToast, conn, daemonVersion, pinnedVersion, onUpdate);
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
    yield* call(showUpdateBackendToast, action.payload[0]);
    const result = yield* call(invokeUpdateBackend, { id: action.payload[0] });
    yield* call(showUpdateBackendToast, action.payload[0], result);
    yield* put(action.success(result));
    settled = true;
  } catch (error) {
    // An IPC-level failure (validation, bridge unavailable) — daemon-side
    // failures come back as structured non-ok results, not throws.
    const resolved = toError(error);
    yield* call(showUpdateBackendRequestErrorToast, action.payload[0]);
    yield* put(action.failure(resolved));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* call(dismissUpdateBackendToast, action.payload[0]);
      yield* put(action.failure(new Error('Backend update request was cancelled')));
    }
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
  const tracker: DaemonBehindTracker = { evaluatedById: new Map(), toastedIds: new Set() };
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
