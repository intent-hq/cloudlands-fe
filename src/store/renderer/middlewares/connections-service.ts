/**
 * Connections service — bridges the multi-backend connect IPC channels and
 * push events into the connections Redux slice, and exposes the thunks the
 * connect menu/modal (T6) calls.
 *
 * Boot (first dispatched action): fetch the initial `connections:list` and
 * subscribe to the `connections:changed` / `connections:cert-mismatch` pushes
 * so every window keeps its list + active selection and cert-mismatch state in
 * sync with main.
 *
 * Thunks (`loadConnections`, `captureFingerprint`, `addConnection`,
 * `forgetConnection`, `switchConnection`) invoke the request/response channels
 * and dispatch op-status actions; the list/active refresh arrives via the
 * `connections:changed` push (main broadcasts after every mutation).
 *
 * The bearer token only ever crosses renderer→main at capture/add time — it is
 * never returned, listed, or broadcast (see shared/types/connections.ts).
 */

import type { StoreMiddleware } from '$lib/store-shim/types';
import { store as appStore } from '$store/renderer/store';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import {
  CONNECTIONS_CHANGED_EVENT,
  CONNECTION_CERT_MISMATCH_EVENT,
  CONNECTION_PROTOCOL_MISMATCH_EVENT,
} from '$shared/types/connections';
import type {
  ConnectionsListResult,
  CaptureFingerprintParams,
  CaptureFingerprintResult,
  AddConnectionParams,
  ConnectionRecord,
  AddConnectionResult,
  ForgetConnectionParams,
  SwitchConnectionParams,
  ConnectionsChangedEvent,
  ConnectionCertMismatchEvent,
  ConnectionProtocolMismatchEvent,
} from '$shared/types/connections';
import {
  connectionsListReceived,
  connectOperationStarted,
  connectOperationSettled,
  connectOperationFailed,
  certMismatchReceived,
  protocolMismatchReceived,
} from '$store/renderer/slices/connections/connections-slice';

// Group alias (`const CONNECTIONS = IPC_CHANNELS.CONNECTIONS`) — the same idiom
// as backend-transport.ts's `BACKEND`, so the invoke-surface reconciliation
// audit resolves these channels statically.
const CONNECTIONS = IPC_CHANNELS.CONNECTIONS;

let booted = false;
let changedListener: ((payload: ConnectionsChangedEvent) => void) | null = null;
let certMismatchListener: ((payload: ConnectionCertMismatchEvent) => void) | null = null;
let protocolMismatchListener: ((payload: ConnectionProtocolMismatchEvent) => void) | null = null;

/** Resolve the Electron preload bridge, or undefined outside Electron. */
function getApi(): Window['electronAPI'] | undefined {
  return typeof window !== 'undefined' ? window.electronAPI : undefined;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Fetch the current `connections:list` and dispatch it into the slice.
 * Rejects if the bridge is unavailable so boot's `.catch` can log-and-continue
 * (push events + a later retry converge the state).
 */
export async function loadConnections(): Promise<void> {
  const api = getApi();
  if (!api) throw new Error('electronAPI is not available');
  const result = (await api.invoke(CONNECTIONS.LIST)) as ConnectionsListResult;
  appStore.dispatch(connectionsListReceived(result));
  // Replay a sticky protocol mismatch latched in main (cloudlands-fe#823): a
  // renderer created by a backend switch may register its
  // `connections:protocol-mismatch` listener AFTER the one-shot broadcast fired,
  // so the advisory arrives here on the initial list fetch instead. Only the
  // boot-time fetch replays it — `connections:changed` pushes route through
  // `changedListener` (list refresh only) so a benign mutation (e.g. a hostname
  // label upgrade) never re-pops a modal the user already dismissed.
  if (result.protocolMismatch) {
    appStore.dispatch(protocolMismatchReceived(result.protocolMismatch));
  }
}

/**
 * Capture the cert fingerprint a remote daemon presents (trust-on-first-use).
 * Returns the presented fingerprint for the modal to show; the caller handles
 * a rejection (unreachable host, TLS error) inline.
 */
export async function captureFingerprint(
  params: CaptureFingerprintParams,
): Promise<CaptureFingerprintResult> {
  const api = getApi();
  if (!api) throw new Error('electronAPI is not available');
  return (await api.invoke(CONNECTIONS.CAPTURE_FINGERPRINT, params)) as CaptureFingerprintResult;
}

/**
 * Add (pin + store) a new remote connection. The token is passed once here for
 * main to encrypt at rest; it is never returned. Dispatches op-status; the
 * list refresh arrives via the `connections:changed` push. Rethrows on failure
 * so the modal can surface the error inline.
 */
export async function addConnection(params: AddConnectionParams): Promise<ConnectionRecord> {
  const api = getApi();
  if (!api) {
    const message = 'electronAPI is not available';
    appStore.dispatch(connectOperationFailed(message));
    throw new Error(message);
  }
  appStore.dispatch(connectOperationStarted());
  try {
    const result = (await api.invoke(CONNECTIONS.ADD, params)) as AddConnectionResult;
    appStore.dispatch(connectOperationSettled());
    return result.connection;
  } catch (error) {
    appStore.dispatch(connectOperationFailed(toMessage(error)));
    throw error;
  }
}

/**
 * Forget a stored connection. The list refresh arrives via the
 * `connections:changed` push. Rethrows on failure for the caller to surface.
 */
export async function forgetConnection(id: string): Promise<void> {
  const api = getApi();
  if (!api) throw new Error('electronAPI is not available');
  const params: ForgetConnectionParams = { id };
  await api.invoke(CONNECTIONS.FORGET, params);
}

/**
 * Switch the active backend. Dispatches op-status; the active refresh arrives
 * via the `connections:changed` push (it carries the new activeId). Rethrows
 * on failure so the caller can surface the error inline.
 */
export async function switchConnection(id: string): Promise<void> {
  const api = getApi();
  if (!api) {
    const message = 'electronAPI is not available';
    appStore.dispatch(connectOperationFailed(message));
    throw new Error(message);
  }
  appStore.dispatch(connectOperationStarted());
  try {
    const params: SwitchConnectionParams = { id };
    await api.invoke(CONNECTIONS.SWITCH, params);
    appStore.dispatch(connectOperationSettled());
  } catch (error) {
    appStore.dispatch(connectOperationFailed(toMessage(error)));
    throw error;
  }
}

/**
 * Boot-time setup: subscribe to the push events and fetch the initial list.
 */
function boot(): void {
  if (booted) return;
  booted = true;

  const api = getApi();
  if (!api) return;

  // Refresh the list + active selection on every mutation broadcast.
  changedListener = (payload: ConnectionsChangedEvent) => {
    appStore.dispatch(connectionsListReceived(payload));
  };
  api.on(CONNECTIONS_CHANGED_EVENT, changedListener);

  // A pinned cert changed on (re)connect — surface the blocking failure modal.
  certMismatchListener = (payload: ConnectionCertMismatchEvent) => {
    appStore.dispatch(certMismatchReceived(payload));
  };
  api.on(CONNECTION_CERT_MISMATCH_EVENT, certMismatchListener);

  // A remote's protocol major differs from local — surface a non-blocking
  // advisory (modal + persistent menu warning). The connection still proceeds.
  protocolMismatchListener = (payload: ConnectionProtocolMismatchEvent) => {
    appStore.dispatch(protocolMismatchReceived(payload));
  };
  api.on(CONNECTION_PROTOCOL_MISMATCH_EVENT, protocolMismatchListener);

  // Fetch the initial list. Push events + a later action converge the state if
  // the bridge is not ready yet.
  void loadConnections().catch(() => {
    // Bridge not ready — the next connections:changed push refreshes the list.
  });
}

/**
 * Middleware that boots the connections service on the first dispatched action.
 * The thunks above are called directly by the UI, so there is no per-action
 * routing here — boot only wires the push-event subscriptions + initial list.
 */
export function createConnectionsMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    if (!booted) boot();
    return next(action);
  };
}

/**
 * Cleanup for tests (remove listeners, reset boot latch).
 */
export function disposeConnectionsService(): void {
  const api = getApi();
  if (api) {
    if (changedListener) api.off(CONNECTIONS_CHANGED_EVENT, changedListener);
    if (certMismatchListener) api.off(CONNECTION_CERT_MISMATCH_EVENT, certMismatchListener);
    if (protocolMismatchListener)
      api.off(CONNECTION_PROTOCOL_MISMATCH_EVENT, protocolMismatchListener);
  }
  changedListener = null;
  certMismatchListener = null;
  protocolMismatchListener = null;
  booted = false;
}
