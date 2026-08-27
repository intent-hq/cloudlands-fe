import { END, eventChannel, buffers, type EventChannel } from 'redux-saga';
import {
  all,
  call,
  cancelled,
  fork,
  join,
  put,
  take,
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
  RotateConnectionSecretParams,
  RotateConnectionSecretResult,
  SetKeychainSyncEnabledParams,
  SwitchConnectionParams,
  SwitchConnectionResult,
  TestConnectionParams,
  TestConnectionResult,
  UpdateConnectionParams,
  UpdateConnectionResult,
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
  switchConnectionRequested,
  testConnectionRequested,
  updateConnectionRequested,
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

async function invokeSwitchConnection(
  params: SwitchConnectionParams,
): Promise<SwitchConnectionResult> {
  const api = getApi();
  if (!api) throw new Error('electronAPI is not available');
  return (await api.invoke(CONNECTIONS.SWITCH, params)) as SwitchConnectionResult;
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
    takeLeading(updateConnectionRequested, updateConnection),
    takeLeading(testConnectionRequested, testConnection),
    takeLeading(rotateConnectionSecretRequested, rotateConnectionSecret),
    takeLeading(openConnectionRequested, openConnection),
    takeLeading(forgetConnectionRequested, forgetConnection),
    takeLeading(switchConnectionRequested, switchConnection),
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
