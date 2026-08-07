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
 * status + cert-mismatch are renderer-local UI state driven by the thunks and
 * the `connections:cert-mismatch` push (see connections-service.ts).
 */

import { createAction } from '$lib/store-shim/utils/store/create-action';
import { createReducer } from '$lib/store-shim/utils/store/create-reducer';
import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
import type {
  ConnectionsState,
  ConnectionsListResult,
  ConnectionCertMismatchEvent,
} from './connections-types';

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const initialState: ConnectionsState = {
  connections: [],
  activeId: LOCAL_CONNECTION_ID,
  status: 'idle',
  error: null,
  certMismatch: null,
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

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const connectionsReducer = createReducer<ConnectionsState>(initialState)
  .with(connectionsListReceived, (state, { payload: [result] }) => {
    return { ...state, connections: result.connections, activeId: result.activeId };
  })
  .with(connectOperationStarted, (state) => {
    return { ...state, status: 'connecting', error: null };
  })
  .with(connectOperationSettled, (state) => {
    return { ...state, status: 'idle', error: null };
  })
  .with(connectOperationFailed, (state, { payload: [error] }) => {
    return { ...state, status: 'error', error };
  })
  .with(certMismatchReceived, (state, { payload: [event] }) => {
    return { ...state, certMismatch: event };
  })
  .with(certMismatchCleared, (state) => {
    return { ...state, certMismatch: null };
  });
