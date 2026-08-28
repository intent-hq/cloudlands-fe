import { END, eventChannel, buffers, type EventChannel } from 'redux-saga';
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
  ConnectionsChangedEvent,
  ConnectionsListResult,
  ForgetConnectionParams,
  ForgetConnectionResult,
  KeychainSyncStateResult,
  KeychainSyncUiStatus,
  OpenConnectionParams,
  OpenConnectionResult,
  SetKeychainSyncEnabledParams,
  SwitchConnectionParams,
  SwitchConnectionResult,
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
  setKeychainSyncEnabledRequested,
  switchConnectionRequested,
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

async function invokeSwitchConnection(
  params: SwitchConnectionParams,
): Promise<SwitchConnectionResult> {
  const api = getApi();
  if (!api) throw new Error('electronAPI is not available');
  return (await api.invoke(CONNECTIONS.SWITCH, params)) as SwitchConnectionResult;
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
  action: ReturnType<typeof loadConnectionsRequested>,
): SagaGenerator<void> {
  let settled = false;
  try {
    const result = yield* call(invokeConnectionsList);
    yield* put(connectionsListReceived(result));
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

function* switchConnection(
  action: ReturnType<typeof switchConnectionRequested>,
): SagaGenerator<void> {
  let settled = false;
  yield* put(connectOperationStarted());
  try {
    yield* call(invokeSwitchConnection, { id: action.payload[0] });
    yield* put(connectOperationSettled());
    yield* put(action.success(undefined as never));
    settled = true;
  } catch (error) {
    const resolved = toError(error);
    yield* put(connectOperationFailed(resolved.message));
    yield* put(action.failure(resolved));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      const resolved = new Error('Connection switch was cancelled');
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

function* consumeConnectionsEvents(channel: EventChannel<ConnectionsEvent>): SagaGenerator<void> {
  try {
    while (true) {
      const event = yield* take(channel);
      if (event === (END as unknown as ConnectionsEvent)) return;
      if (event.kind === 'changed') yield* put(connectionsListReceived(event.payload));
      else if (event.kind === 'cert-mismatch') yield* put(certMismatchReceived(event.payload));
      else if (event.kind === 'auth-rejected') yield* put(authRejectedReceived(event.payload));
      else if (event.kind === 'sync-status') yield* put(keychainSyncStatusReceived(event.payload));
      else yield* put(protocolMismatchReceived(event.payload));
    }
  } finally {
    channel.close();
  }
}

function* watchConnectionsActions(): SagaGenerator<void> {
  yield* all([
    takeLeading(loadConnectionsRequested, hydrateConnections),
    takeLeading(captureFingerprintRequested, captureFingerprint),
    takeLeading(addConnectionRequested, addConnection),
    takeLeading(openConnectionRequested, openConnection),
    takeLeading(forgetConnectionRequested, forgetConnection),
    takeLeading(switchConnectionRequested, switchConnection),
    // takeEvery, not takeLeading: each action targets one backend id, and
    // multiple connected remotes can be updated back-to-back — takeLeading
    // would drop the second action, leaving its promise unresolved and the
    // user without a toast.
    takeEvery(updateBackendRequested, updateBackend),
    takeLeading(loadKeychainSyncStateRequested, loadKeychainSyncState),
    takeLeading(setKeychainSyncEnabledRequested, setKeychainSyncEnabled),
  ]);
}

export function* connectionsSaga(): SagaGenerator<void> {
  if (!getApi()) return;

  const events = createConnectionsEventChannel();
  const eventTask = yield* fork(consumeConnectionsEvents, events);
  const actionsTask = yield* fork(watchConnectionsActions);
  const initial = loadConnectionsRequested();
  try {
    yield* call(hydrateConnections, initial);
    yield* all([join(eventTask), join(actionsTask)]);
  } finally {
    events.close();
  }
}
