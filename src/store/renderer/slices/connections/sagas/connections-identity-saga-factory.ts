import { END, buffers, eventChannel, type EventChannel } from 'redux-saga';
import {
  call,
  cancelled,
  fork,
  join,
  put,
  take,
  takeLatest,
  type SagaGenerator,
} from 'typed-redux-saga';
import { resolveBackendTransport } from '$lib/client/live/backend-transport-factory';
import { getWebDaemonStatusSource } from '$lib/client/live/web-daemon-status';
import { expectsElectronPreloadBridge, isElectronPlatform } from '$lib/utils/platform-capabilities';
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
  ConnectionsChangedEvent,
  ConnectionAuthRejectedEvent,
  ConnectionCertMismatchEvent,
  ConnectionCertWarningsEvent,
  ConnectionProtocolMismatchEvent,
  KeychainSyncUiStatus,
  ConnectionsListResult,
} from '$shared/types/connections';
import {
  connectionsListReceived,
  protocolMismatchReceived,
  authRejectedReceived,
  certMismatchReceived,
  certWarningsReceived,
  keychainSyncStatusReceived,
  loadConnectionsRequested,
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
  // Browser windows have one actual WebSocket backend and no Electron registry.
  // Resolve the selected transport before binding; an absent/late Electron preload
  // must still wait for its real per-window connections:list response.
  if (!expectsElectronPreloadBridge() && !isElectronPlatform()) {
    resolveBackendTransport();
    const browserBackend = getWebDaemonStatusSource();
    if (browserBackend) {
      const id = 'browser-websocket';
      return { connections: [], activeId: id, windowBackendId: id };
    }
  }
  const api = getApi();
  if (!api) throw new Error('electronAPI is not available');
  return (await api.invoke(CONNECTIONS.LIST)) as ConnectionsListResult;
}

/** Bind actual window identity independently of connection-management UI. */
export function createConnectionsIdentitySaga(
  onList?: (result: ConnectionsListResult) => SagaGenerator<void>,
) {
  function* hydrateConnections(
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
      if (onList) yield* call(onList, result);
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

  function* consumeConnectionsEvents(channel: EventChannel<ConnectionsEvent>): SagaGenerator<void> {
    try {
      while (true) {
        const event = yield* take(channel);
        if (event === (END as unknown as ConnectionsEvent)) return;
        if (event.kind === 'changed') {
          yield* put(connectionsListReceived(event.payload));
          if (onList) yield* call(onList, event.payload);
        } else if (event.kind === 'cert-mismatch') yield* put(certMismatchReceived(event.payload));
        else if (event.kind === 'cert-warnings') yield* put(certWarningsReceived(event.payload));
        else if (event.kind === 'auth-rejected') yield* put(authRejectedReceived(event.payload));
        else if (event.kind === 'sync-status')
          yield* put(keychainSyncStatusReceived(event.payload));
        else yield* put(protocolMismatchReceived(event.payload));
      }
    } finally {
      channel.close();
    }
  }

  return function* connectionsIdentitySaga(): SagaGenerator<void> {
    const events = createConnectionsEventChannel();
    try {
      const eventsTask = yield* fork(consumeConnectionsEvents, events);
      yield* takeLatest(loadConnectionsRequested, hydrateConnections);
      yield* put(loadConnectionsRequested());
      yield* join(eventsTask);
    } finally {
      events.close();
    }
  };
}
