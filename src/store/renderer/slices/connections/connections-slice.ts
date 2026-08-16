/**
 * Connections Slice
 *
 * Actions + reducer for the multi-backend connect feature. Tracks the
 * connections list, the active backend, the in-flight add/switch operation
 * status, and the last pinned-cert mismatch.
 *
 * The list + active selection are authoritative from main: they are set from
 * the `connections:list` result on boot and refreshed on every
 * `connections:changed` push (both carry `ConnectionsListResult`). The op
 * status + cert-mismatch are renderer-local UI state driven by saga-owned
 * async actions and the `connections:cert-mismatch` push.
 */

import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { createAction, createAsyncAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import type {
  AddConnectionParams,
  AddConnectionResult,
  CaptureFingerprintParams,
  CaptureFingerprintResult,
  ConnectionRecord,
  ConnectionsState,
  ConnectionsListResult,
  ConnectionAuthRejectedEvent,
  ConnectionCertMismatchEvent,
  ConnectionProtocolMismatchEvent,
} from './connections-types';

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const initialState: ConnectionsState = {
  connections: createCollection<ConnectionRecord, 'id'>('id'),
  activeId: LOCAL_CONNECTION_ID,
  status: 'idle',
  error: null,
  certMismatch: null,
  authRejected: null,
  protocolMismatch: null,
  protocolMismatchModalDismissed: false,
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Connections list + active selection received — from the initial
 * `connections:list` invoke or a `connections:changed` push. Both carry the
 * same `ConnectionsListResult` shape.
 */
export const connectionsListReceived = createAction<[result: ConnectionsListResult]>(
  'connections/listReceived',
);

/**
 * An add/switch operation started (thunk invoked its IPC channel). Moves
 * status to 'connecting' and clears any prior error.
 */
export const connectOperationStarted = createAction('connections/operationStarted');

/**
 * The in-flight add/switch operation succeeded. Status returns to 'idle'; the
 * list/active refresh arrives separately via the `connections:changed` push.
 */
export const connectOperationSettled = createAction('connections/operationSettled');

/**
 * The in-flight add/switch operation failed. Status moves to 'error' and the
 * message is stored for the UI.
 */
export const connectOperationFailed = createAction<[error: string]>('connections/operationFailed');

/**
 * A `connections:cert-mismatch` push arrived — a pinned cert changed on
 * (re)connect. Stored so the UI can surface a blocking failure modal.
 */
export const certMismatchReceived = createAction<[event: ConnectionCertMismatchEvent]>(
  'connections/certMismatchReceived',
);

/** User dismissed the cert-mismatch modal. */
export const certMismatchCleared = createAction('connections/certMismatchCleared');

/**
 * A `connections:auth-rejected` push arrived — the remote backend rejected the
 * WebSocket upgrade with HTTP 401/403 (bad/rotated token, or the WS API is
 * disabled). Latched so the UI can surface a "re-pair or switch" state instead
 * of the generic cannot-connect overlay.
 */
export const authRejectedReceived = createAction<[event: ConnectionAuthRejectedEvent]>(
  'connections/authRejectedReceived',
);

/**
 * A `connections:protocol-mismatch` push arrived — a remote's protocolVersion
 * differs in major version from the local intentd's. Stored so the UI can
 * surface a non-blocking advisory modal (and a persistent menu warning). Resets
 * the modal-dismissed flag so the advisory shows for this fresh mismatch —
 * except for boot-origin events (`origin: 'boot'`), which latch the flag so
 * only the persistent menu warning shows (the user did not just initiate a
 * switch, so no modal).
 */
export const protocolMismatchReceived = createAction<[event: ConnectionProtocolMismatchEvent]>(
  'connections/protocolMismatchReceived',
);

/**
 * User dismissed the advisory protocol-mismatch modal ("continue anyway"). The
 * mismatch state itself is retained for the persistent menu warning.
 */
export const protocolMismatchModalDismissed = createAction(
  'connections/protocolMismatchModalDismissed',
);

/** Saga-owned initial/list hydration trigger. */
export const loadConnectionsRequested = createAsyncAction<[], void>(
  'connections/load',
  'connections/loadRequested',
);

/** Saga-owned trust-on-first-use fingerprint request. */
export const captureFingerprintRequested = createAsyncAction<
  [params: CaptureFingerprintParams],
  CaptureFingerprintResult
>('connections/captureFingerprint', 'connections/captureFingerprintRequested');

/**
 * Saga-owned connection add request. Resolves with the token-free record plus
 * whether main already switched to it (active re-pair rebuilds the live client
 * in the add handler — the caller must then skip its own follow-up switch).
 */
export const addConnectionRequested = createAsyncAction<
  [params: AddConnectionParams],
  AddConnectionResult
>('connections/add', 'connections/addRequested');

/** Saga-owned stored-connection removal request. */
export const forgetConnectionRequested = createAsyncAction<[id: string], void>(
  'connections/forget',
  'connections/forgetRequested',
);

/** Saga-owned active-backend switch request. */
export const switchConnectionRequested = createAsyncAction<[id: string], void>(
  'connections/switch',
  'connections/switchRequested',
);

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const connectionsReducer = createReducer<ConnectionsState>(initialState);
connectionsReducer.with(connectionsListReceived, (state, { payload: [result] }) => {
  return {
    ...state,
    connections: createCollection<ConnectionRecord, 'id'>('id', result.connections),
    activeId: result.activeId,
  };
});
connectionsReducer.with(connectOperationStarted, (state) => {
  // A fresh add/switch clears the auth-rejected latch: a re-add refreshes the
  // stored token for the same target, and a switch changes the target — either
  // way the latched rejection no longer describes the operation under way.
  return { ...state, status: 'connecting', error: null, authRejected: null };
});
connectionsReducer.with(connectOperationSettled, (state) => {
  return { ...state, status: 'idle', error: null };
});
connectionsReducer.with(connectOperationFailed, (state, { payload: [error] }) => {
  return { ...state, status: 'error', error };
});
connectionsReducer.with(certMismatchReceived, (state, { payload: [event] }) => {
  return { ...state, certMismatch: event };
});
connectionsReducer.with(certMismatchCleared, (state) => {
  return { ...state, certMismatch: null };
});
connectionsReducer.with(authRejectedReceived, (state, { payload: [event] }) => {
  return { ...state, authRejected: event };
});
connectionsReducer.with(protocolMismatchReceived, (state, { payload: [event] }) => {
  // Boot-origin mismatches (persisted remote restored at launch) suppress the
  // advisory modal but keep the persistent menu warning; switch-origin (or
  // origin-less, older payloads) mismatches show the modal.
  return {
    ...state,
    protocolMismatch: event,
    protocolMismatchModalDismissed: event.origin === 'boot',
  };
});
connectionsReducer.with(protocolMismatchModalDismissed, (state) => {
  return { ...state, protocolMismatchModalDismissed: true };
});
