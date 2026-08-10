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
  SwitchConnectionParams,
  SwitchConnectionResult,
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
  loadConnectionsRequested,
  protocolMismatchReceived,
  switchConnectionRequested,
} from '../connections-slice';

const CONNECTIONS = IPC_CHANNELS.CONNECTIONS;

type ConnectionsEvent =
  | { kind: 'changed'; payload: ConnectionsChangedEvent }
  | { kind: 'cert-mismatch'; payload: ConnectionCertMismatchEvent }
  | { kind: 'protocol-mismatch'; payload: ConnectionProtocolMismatchEvent }
  | { kind: 'auth-rejected'; payload: ConnectionAuthRejectedEvent };

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

function* hydrateConnections(
  action: ReturnType<typeof loadConnectionsRequested>,
): SagaGenerator<void> {
  let settled = false;
  try {
    const result = yield* call(invokeConnectionsList);
    yield* put(connectionsListReceived(result));
    if (result.protocolMismatch) yield* put(protocolMismatchReceived(result.protocolMismatch));
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
    yield* put(action.success(result.connection));
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

function* consumeConnectionsEvents(channel: EventChannel<ConnectionsEvent>): SagaGenerator<void> {
  try {
    while (true) {
      const event = yield* take(channel);
      if (event === (END as unknown as ConnectionsEvent)) return;
      if (event.kind === 'changed') yield* put(connectionsListReceived(event.payload));
      else if (event.kind === 'cert-mismatch') yield* put(certMismatchReceived(event.payload));
      else if (event.kind === 'auth-rejected') yield* put(authRejectedReceived(event.payload));
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
    takeLeading(forgetConnectionRequested, forgetConnection),
    takeLeading(switchConnectionRequested, switchConnection),
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
