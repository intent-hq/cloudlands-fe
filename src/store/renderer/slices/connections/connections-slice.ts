/**
 * Connections Slice
 *
 * Actions + reducer for the multi-backend connect feature. Tracks the
 * connections list, the active backend, the in-flight add/open operation
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
  ConnectBackendParams,
  ConnectionRecord,
  ConnectionsState,
  ConnectionsListResult,
  ConnectionResultState,
  KeychainSyncStateResult,
  KeychainSyncUiStatus,
  OpenConnectionResult,
  RotateConnectionSecretParams,
  RotateConnectionSecretResult,
  TestConnectionParams,
  TestConnectionResult,
  UpdateConnectionParams,
  UpdateConnectionResult,
  UpdateBackendResult,
  ConnectionAuthRejectedEvent,
  ConnectionCertMismatchEvent,
  ConnectionCertWarningsEvent,
  ConnectionHostCertWarning,
  ConnectionProtocolMismatchEvent,
  PublishSelfResult,
  RefreshSelfResult,
  SelfPublishedStateResult,
  SaveConnectionParams,
  SaveConnectionResult,
  UnpublishSelfResult,
} from './connections-types';

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const initialState: ConnectionsState = {
  connections: createCollection<ConnectionRecord, 'id'>('id'),
  activeId: LOCAL_CONNECTION_ID,
  windowBackendId: LOCAL_CONNECTION_ID,
  hasReceivedList: false,
  pinnedVersion: null,
  connectedIds: [],
  status: 'idle',
  error: null,
  openingIds: [],
  certMismatch: null,
  certWarnings: {},
  authRejected: null,
  protocolMismatch: null,
  protocolMismatchModalDismissed: false,
  keychainSync: null,
  keychainSyncLoadStatus: 'idle',
  keychainSyncWriteOperation: {
    requestId: null,
    version: 0,
    status: 'idle',
    result: null,
    error: null,
  },
  selfPublishedState: null,
  selfPublishedStateStatus: 'idle',
  selfPublishStatus: 'idle',
  selfPublishError: null,
  selfPublishVersion: 0,
  selfUnpublishStatus: 'idle',
  selfUnpublishError: null,
  selfUnpublishVersion: 0,
  selfUnpublishRemoved: false,
  captureFingerprintOperation: {
    requestId: null,
    version: 0,
    status: 'idle',
    result: null,
    error: null,
  },
  connectBackendOperation: {
    requestId: null,
    version: 0,
    status: 'idle',
    result: null,
    error: null,
  },
  openOperations: {},
  saveOperations: {},
  testOperations: {},
  forgetOperations: {},
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
 * An add/open operation started (its saga invoked the IPC channel). Moves
 * status to 'connecting' and clears any prior error.
 */
export const connectOperationStarted = createAction('connections/operationStarted');

/**
 * The in-flight add/open operation succeeded. Status returns to 'idle'; the
 * list/active refresh arrives separately via the `connections:changed` push.
 */
export const connectOperationSettled = createAction('connections/operationSettled');

/**
 * The in-flight add/open operation failed. Status moves to 'error' and the
 * message is stored for the UI.
 */
export const connectOperationFailed = createAction<[error: string]>('connections/operationFailed');

/**
 * An open operation for one backend started. Records the id in `openingIds`
 * and moves status to 'connecting'. Different IDs may run concurrently;
 * repeat operations for one ID are serialized by the saga.
 */
export const openOperationStarted = createAction<[id: string]>('connections/openStarted');

/**
 * The open operation for one backend succeeded. Drops the id from
 * `openingIds`; status returns to 'idle' only once no other open remains in
 * flight.
 */
export const openOperationSettled = createAction<[id: string]>('connections/openSettled');

/**
 * The open operation for one backend failed. Drops the id from `openingIds`,
 * moves status to 'error' and stores the message for the UI.
 */
export const openOperationFailed =
  createAction<[id: string, error: string]>('connections/openFailed');

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
 * A `connections:cert-warnings` push arrived — the set of NON-FATAL per-host
 * cert mismatches observed for a connection changed (the multi-host connection
 * race can connect through one candidate while another presents a foreign
 * pinned cert). Informative only — never blocks the connection or retries. An
 * empty `warnings` array clears the connection's entry (fresh client).
 */
export const certWarningsReceived = createAction<[event: ConnectionCertWarningsEvent]>(
  'connections/certWarningsReceived',
);

/**
 * A `connections:auth-rejected` push arrived — the remote backend rejected the
 * WebSocket upgrade with HTTP 401/403 (bad/rotated token, or the WS API is
 * disabled). Latched so the UI can surface a "re-pair or open local" state
 * instead of the generic cannot-connect overlay.
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
 * connect, so no modal).
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
 * whether main rebuilt an active connection's client in place.
 */
export const addConnectionRequested = createAsyncAction<
  [params: AddConnectionParams],
  AddConnectionResult
>('connections/add', 'connections/addRequested');

/** Saga-owned remote metadata update request. */
export const updateConnectionRequested = createAsyncAction<
  [params: UpdateConnectionParams],
  UpdateConnectionResult
>('connections/update', 'connections/updateRequested');

/** Saga-owned probe of unsaved address values with the saved secret. */
export const testConnectionRequested = createAsyncAction<
  [params: TestConnectionParams],
  TestConnectionResult
>('connections/test', 'connections/testRequested');

/** Saga-owned write-only secret rotation request. */
export const rotateConnectionSecretRequested = createAsyncAction<
  [params: RotateConnectionSecretParams],
  RotateConnectionSecretResult
>('connections/rotateSecret', 'connections/rotateSecretRequested');

/** Saga-owned non-destructive open/focus request for one backend. */
export const openConnectionRequested = createAsyncAction<
  [id: string, requestId?: string],
  [id: string, requestId: string],
  OpenConnectionResult
>(
  'connections/open',
  'connections/openRequested',
  (id, requestId = globalThis.crypto.randomUUID()) => [id, requestId],
);

/** Saga-owned stored-connection removal request. */
export const forgetConnectionRequested = createAsyncAction<
  [id: string, requestId?: string],
  [id: string, requestId: string],
  void
>(
  'connections/forget',
  'connections/forgetRequested',
  (id, requestId = globalThis.crypto.randomUUID()) => [id, requestId],
);

/**
 * Saga-owned remote-backend update request (the connections-menu Update
 * action). Resolves with the structured `connections:update-backend` result;
 * the saga owns the success/failure toasts, so no op-status state is tracked.
 */
export const updateBackendRequested = createAsyncAction<[id: string], UpdateBackendResult>(
  'connections/updateBackend',
  'connections/updateBackendRequested',
);

/**
 * iCloud-keychain sync state received — from the `connections:sync-get-state`
 * invoke or the `connections:sync-set-enabled` result (both carry the full
 * `KeychainSyncStateResult`).
 */
export const keychainSyncStateReceived = createAction<[result: KeychainSyncStateResult]>(
  'connections/keychainSyncStateReceived',
);

/** Clear the renderer's cached sync state without changing the backend setting. */
export const keychainSyncStateCleared = createAction('connections/keychainSyncStateCleared');

/**
 * A `connections:sync-status-changed` push arrived — a reconcile's
 * availability verdict changed. Ignored until the full state has been loaded
 * (`keychainSync` is null before that, and status alone cannot seed it).
 */
export const keychainSyncStatusReceived = createAction<[status: KeychainSyncUiStatus]>(
  'connections/keychainSyncStatusReceived',
);

/** Saga-owned keychain-sync state hydration (settings UI mount). */
export const loadKeychainSyncStateRequested = createAsyncAction<[], KeychainSyncStateResult>(
  'connections/loadKeychainSyncState',
  'connections/loadKeychainSyncStateRequested',
);

/** Saga-owned keychain-sync opt-in toggle request. */
export const setKeychainSyncEnabledRequested = createAsyncAction<
  [enabled: boolean, requestId?: string],
  [enabled: boolean, requestId: string],
  KeychainSyncStateResult
>(
  'connections/setKeychainSyncEnabled',
  'connections/setKeychainSyncEnabledRequested',
  (enabled, requestId = globalThis.crypto.randomUUID()) => [enabled, requestId],
);

export const loadSelfPublishedStateRequested = createAsyncAction<[], SelfPublishedStateResult>(
  'connections/loadSelfPublishedState',
  'connections/loadSelfPublishedStateRequested',
);
export const publishSelfRequested = createAsyncAction<[], PublishSelfResult>(
  'connections/publishSelf',
  'connections/publishSelfRequested',
);
export const unpublishSelfRequested = createAsyncAction<[], UnpublishSelfResult>(
  'connections/unpublishSelf',
  'connections/unpublishSelfRequested',
);
export const refreshSelfRequested = createAsyncAction<[], RefreshSelfResult>(
  'connections/refreshSelf',
  'connections/refreshSelfRequested',
);

export const saveConnectionRequested = createAsyncAction<
  [params: SaveConnectionParams, requestId?: string],
  [params: SaveConnectionParams, requestId: string],
  SaveConnectionResult
>(
  'connections/save',
  'connections/saveRequested',
  (params, requestId = globalThis.crypto.randomUUID()) => [params, requestId],
);

export const connectBackendRequested = createAsyncAction<
  [params: ConnectBackendParams],
  OpenConnectionResult
>('connections/connectBackend', 'connections/connectBackendRequested');

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const connectionsReducer = createReducer<ConnectionsState>(initialState);
connectionsReducer.with(connectionsListReceived, (state, { payload: [result] }) => {
  const next: ConnectionsState = {
    ...state,
    connections: createCollection<ConnectionRecord, 'id'>('id', result.connections),
    activeId: result.activeId,
    windowBackendId: result.windowBackendId,
    hasReceivedList: true,
    // Absent on payloads from an older main process — keep the prior value
    // rather than clearing a pin the renderer already learned.
    pinnedVersion: result.pinnedVersion !== undefined ? result.pinnedVersion : state.pinnedVersion,
    // Same older-main tolerance for live connectivity.
    connectedIds: result.connectedIds !== undefined ? result.connectedIds : state.connectedIds,
  };
  // Sync the per-window sticky latches when the payload carries them: `null`
  // clears (e.g. main disconnected/rebuilt the window's backend client, so the
  // old rejection no longer applies), an event replays the latch. Absent fields
  // (older payload shape) leave the latched state untouched.
  if (result.authRejected !== undefined) {
    next.authRejected = result.authRejected;
  }
  if (result.certWarnings !== undefined) {
    // Replay of the window backend's sticky NON-FATAL per-host warnings —
    // same shape as the one-shot push, so an empty/`null` replay clears the
    // entry and a non-empty one seeds a renderer created after the push.
    if (result.certWarnings === null || result.certWarnings.warnings.length === 0) {
      // A `null` replay carries no id — it means the window backend has no
      // sticky warnings, so the entry to drop is the window backend's.
      const clearedId =
        result.certWarnings === null ? result.windowBackendId : result.certWarnings.id;
      if (state.certWarnings[clearedId]) {
        const { [clearedId]: _cleared, ...rest } = state.certWarnings;
        next.certWarnings = rest;
      }
    } else {
      next.certWarnings = {
        ...state.certWarnings,
        [result.certWarnings.id]: createCollection<ConnectionHostCertWarning, 'host'>(
          'host',
          result.certWarnings.warnings,
        ),
      };
    }
  }
  if (result.protocolMismatch !== undefined) {
    next.protocolMismatch = result.protocolMismatch;
    if (result.protocolMismatch === null) {
      next.protocolMismatchModalDismissed = false;
    } else if (result.protocolMismatch.id !== state.protocolMismatch?.id) {
      // A fresh mismatch replayed via the list gets the same modal semantics
      // as the one-shot push; re-replays of the already-stored mismatch keep
      // the user's dismissal.
      next.protocolMismatchModalDismissed = result.protocolMismatch.origin === 'boot';
    }
  }
  return next;
});
connectionsReducer.with(connectOperationStarted, (state) => {
  // A fresh add/open clears the auth-rejected latch: a re-add refreshes the
  // stored token for the same target, and a fresh open rebuilds the client —
  // either way the latched rejection no longer describes the operation under way.
  return { ...state, status: 'connecting', error: null, authRejected: null };
});
connectionsReducer.with(connectOperationSettled, (state) => {
  return { ...state, status: 'idle', error: null };
});
connectionsReducer.with(connectOperationFailed, (state, { payload: [error] }) => {
  return { ...state, status: 'error', error };
});
/**
 * Drop exactly one occurrence of `id` from the in-flight list.
 */
function removeOneOpening(openingIds: string[], id: string): string[] {
  const index = openingIds.indexOf(id);
  if (index === -1) return openingIds;
  return [...openingIds.slice(0, index), ...openingIds.slice(index + 1)];
}

connectionsReducer.with(openOperationStarted, (state, { payload: [id] }) => {
  // Mirrors connectOperationStarted's legacy latch-clearing semantics: any new
  // open clears the auth-rejected latch, regardless of whether `id` matches
  // the window's own backend (the clearing is not scoped to the opened id).
  // Opening does not itself replace the client (main's connectBackendClient
  // reuses the pooled instance; replacement happens on re-pair/config
  // changes). The saga serializes repeat opens for one backend, while opens
  // for different backend IDs remain independent.
  const openingIds = [...state.openingIds, id];
  return { ...state, openingIds, status: 'connecting', error: null, authRejected: null };
});
connectionsReducer.with(openOperationSettled, (state, { payload: [id] }) => {
  const openingIds = removeOneOpening(state.openingIds, id);
  // Another open still in flight keeps the global status busy.
  if (openingIds.length > 0) return { ...state, openingIds };
  return { ...state, openingIds, status: 'idle', error: null };
});
connectionsReducer.with(openOperationFailed, (state, { payload: [id, error] }) => {
  const openingIds = removeOneOpening(state.openingIds, id);
  return { ...state, openingIds, status: 'error', error };
});
connectionsReducer.with(certMismatchReceived, (state, { payload: [event] }) => {
  // The fatal mismatch also carries every per-host mismatch the failing
  // multi-host race observed — seed the passive list from it so the
  // reconnect UI can show which hosts failed even when no separate
  // `connections:cert-warnings` push preceded the failure.
  const certWarnings =
    event.mismatches && event.mismatches.length > 0
      ? {
          ...state.certWarnings,
          [event.id]: createCollection<ConnectionHostCertWarning, 'host'>('host', event.mismatches),
        }
      : state.certWarnings;
  return { ...state, certMismatch: event, certWarnings };
});
connectionsReducer.with(certMismatchCleared, (state) => {
  return { ...state, certMismatch: null };
});
connectionsReducer.with(certWarningsReceived, (state, { payload: [event] }) => {
  // Empty warnings ⇒ the set was cleared for this id (fresh client) — drop
  // the entry entirely so selectors return the shared empty list.
  if (event.warnings.length === 0) {
    if (!state.certWarnings[event.id]) return state;
    const { [event.id]: _cleared, ...rest } = state.certWarnings;
    return { ...state, certWarnings: rest };
  }
  return {
    ...state,
    certWarnings: {
      ...state.certWarnings,
      [event.id]: createCollection<ConnectionHostCertWarning, 'host'>('host', event.warnings),
    },
  };
});
connectionsReducer.with(authRejectedReceived, (state, { payload: [event] }) => {
  return { ...state, authRejected: event };
});
connectionsReducer.with(protocolMismatchReceived, (state, { payload: [event] }) => {
  // Boot-origin mismatches (persisted remote restored at launch) suppress the
  // advisory modal but keep the persistent menu warning; user-initiated (or
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
connectionsReducer.with(keychainSyncStateReceived, (state, { payload: [result] }) => {
  return { ...state, keychainSync: result };
});
connectionsReducer.with(keychainSyncStateCleared, (state) => {
  return state.keychainSync === null ? state : { ...state, keychainSync: null };
});
connectionsReducer.with(keychainSyncStatusReceived, (state, { payload: [status] }) => {
  // Status alone cannot seed the state — `supported`/`enabled` are unknown
  // until the first full load, so a push arriving before it is dropped.
  if (!state.keychainSync) return state;
  return { ...state, keychainSync: { ...state.keychainSync, status } };
});
connectionsReducer.with(loadKeychainSyncStateRequested, (state) => ({
  ...state,
  keychainSyncLoadStatus: 'loading',
}));
connectionsReducer.with(loadKeychainSyncStateRequested.success, (state) => ({
  ...state,
  keychainSyncLoadStatus: 'success',
}));
connectionsReducer.with(loadKeychainSyncStateRequested.failure, (state) => ({
  ...state,
  keychainSyncLoadStatus: 'error',
}));
connectionsReducer.with(setKeychainSyncEnabledRequested, (state, { payload: [, requestId] }) => ({
  ...state,
  keychainSyncWriteOperation: loadingResult(state.keychainSyncWriteOperation, requestId),
}));
connectionsReducer.with(setKeychainSyncEnabledRequested.success, (state, { payload }) => {
  const requestId = payload.request[1];
  if (state.keychainSyncWriteOperation.requestId !== requestId) return state;
  return {
    ...state,
    keychainSync: payload.response,
    keychainSyncWriteOperation: {
      ...state.keychainSyncWriteOperation,
      status: 'success',
      result: payload.response,
    },
  };
});
connectionsReducer.with(setKeychainSyncEnabledRequested.failure, (state, { payload }) => {
  const requestId = payload.request[1];
  if (state.keychainSyncWriteOperation.requestId !== requestId) return state;
  return {
    ...state,
    keychainSyncWriteOperation: {
      ...state.keychainSyncWriteOperation,
      status: 'error',
      error: payload.error.message,
    },
  };
});
connectionsReducer.with(loadSelfPublishedStateRequested, (state) => ({
  ...state,
  selfPublishedStateStatus: 'loading',
}));
connectionsReducer.with(loadSelfPublishedStateRequested.success, (state, { payload }) => ({
  ...state,
  selfPublishedState: payload.response,
  selfPublishedStateStatus: 'success',
}));
connectionsReducer.with(loadSelfPublishedStateRequested.failure, (state) => ({
  ...state,
  selfPublishedStateStatus: 'error',
}));
connectionsReducer.with(publishSelfRequested, (state) => ({
  ...state,
  selfPublishStatus: 'loading',
  selfPublishError: null,
  selfPublishVersion: state.selfPublishVersion + 1,
}));
connectionsReducer.with(publishSelfRequested.success, (state) => ({
  ...state,
  selfPublishedState: state.selfPublishedState
    ? { ...state.selfPublishedState, published: true, suppressed: false }
    : state.selfPublishedState,
  selfPublishStatus: 'success',
}));
connectionsReducer.with(publishSelfRequested.failure, (state, { payload }) => ({
  ...state,
  selfPublishStatus: 'error',
  selfPublishError: payload.error.message,
}));
connectionsReducer.with(unpublishSelfRequested, (state) => ({
  ...state,
  selfUnpublishStatus: 'loading',
  selfUnpublishError: null,
  selfUnpublishVersion: state.selfUnpublishVersion + 1,
}));
connectionsReducer.with(unpublishSelfRequested.success, (state, { payload }) => ({
  ...state,
  selfPublishedState: state.selfPublishedState
    ? { ...state.selfPublishedState, published: false }
    : state.selfPublishedState,
  selfUnpublishStatus: 'success',
  selfUnpublishRemoved: payload.response.removed,
}));
connectionsReducer.with(unpublishSelfRequested.failure, (state, { payload }) => ({
  ...state,
  selfUnpublishStatus: 'error',
  selfUnpublishError: payload.error.message,
}));

function loadingResult<T>(
  previous?: { version: number },
  requestId: string | null = null,
): ConnectionResultState<T> {
  return {
    requestId,
    version: (previous?.version ?? 0) + 1,
    status: 'loading',
    result: null,
    error: null,
  };
}

connectionsReducer.with(captureFingerprintRequested, (state) => ({
  ...state,
  captureFingerprintOperation: loadingResult(state.captureFingerprintOperation),
}));
connectionsReducer.with(captureFingerprintRequested.success, (state, { payload }) => ({
  ...state,
  captureFingerprintOperation: {
    ...state.captureFingerprintOperation,
    status: 'success',
    result: payload.response,
  },
}));
connectionsReducer.with(captureFingerprintRequested.failure, (state, { payload }) => ({
  ...state,
  captureFingerprintOperation: {
    ...state.captureFingerprintOperation,
    status: 'error',
    error: payload.error.message,
  },
}));

connectionsReducer.with(openConnectionRequested, (state, { payload: [id, requestId] }) => ({
  ...state,
  openOperations: {
    ...state.openOperations,
    [id]: loadingResult(state.openOperations[id], requestId),
  },
}));
connectionsReducer.with(openConnectionRequested.success, (state, { payload }) => {
  const [id, requestId] = payload.request;
  if (state.openOperations[id]?.requestId !== requestId) return state;
  return {
    ...state,
    openOperations: {
      ...state.openOperations,
      [id]: { ...state.openOperations[id], status: 'success' as const, result: payload.response },
    },
  };
});
connectionsReducer.with(openConnectionRequested.failure, (state, { payload }) => {
  const [id, requestId] = payload.request;
  if (state.openOperations[id]?.requestId !== requestId) return state;
  return {
    ...state,
    openOperations: {
      ...state.openOperations,
      [id]: { ...state.openOperations[id], status: 'error' as const, error: payload.error.message },
    },
  };
});

connectionsReducer.with(saveConnectionRequested, (state, { payload: [params, requestId] }) => ({
  ...state,
  saveOperations: {
    ...state.saveOperations,
    [params.update.id]: loadingResult(state.saveOperations[params.update.id], requestId),
  },
}));
connectionsReducer.with(saveConnectionRequested.success, (state, { payload }) => {
  const [params, requestId] = payload.request;
  const id = params.update.id;
  if (state.saveOperations[id]?.requestId !== requestId) return state;
  return {
    ...state,
    saveOperations: {
      ...state.saveOperations,
      [id]: { ...state.saveOperations[id], status: 'success' as const, result: payload.response },
    },
  };
});
connectionsReducer.with(saveConnectionRequested.failure, (state, { payload }) => {
  const [params, requestId] = payload.request;
  const id = params.update.id;
  if (state.saveOperations[id]?.requestId !== requestId) return state;
  return {
    ...state,
    saveOperations: {
      ...state.saveOperations,
      [id]: { ...state.saveOperations[id], status: 'error' as const, error: payload.error.message },
    },
  };
});

connectionsReducer.with(testConnectionRequested, (state, { payload: [params] }) => ({
  ...state,
  testOperations: {
    ...state.testOperations,
    [params.id]: loadingResult(state.testOperations[params.id]),
  },
}));
connectionsReducer.with(testConnectionRequested.success, (state, { payload }) => {
  const id = payload.request[0].id;
  return {
    ...state,
    testOperations: {
      ...state.testOperations,
      [id]: { ...state.testOperations[id], status: 'success' as const, result: payload.response },
    },
  };
});
connectionsReducer.with(testConnectionRequested.failure, (state, { payload }) => {
  const id = payload.request[0].id;
  return {
    ...state,
    testOperations: {
      ...state.testOperations,
      [id]: { ...state.testOperations[id], status: 'error' as const, error: payload.error.message },
    },
  };
});

connectionsReducer.with(forgetConnectionRequested, (state, { payload: [id, requestId] }) => ({
  ...state,
  forgetOperations: {
    ...state.forgetOperations,
    [id]: loadingResult(state.forgetOperations[id], requestId),
  },
}));
connectionsReducer.with(forgetConnectionRequested.success, (state, { payload }) => {
  const [id, requestId] = payload.request;
  if (state.forgetOperations[id]?.requestId !== requestId) return state;
  return {
    ...state,
    forgetOperations: {
      ...state.forgetOperations,
      [id]: { ...state.forgetOperations[id], status: 'success' as const, result: true },
    },
  };
});
connectionsReducer.with(forgetConnectionRequested.failure, (state, { payload }) => {
  const [id, requestId] = payload.request;
  if (state.forgetOperations[id]?.requestId !== requestId) return state;
  return {
    ...state,
    forgetOperations: {
      ...state.forgetOperations,
      [id]: {
        ...state.forgetOperations[id],
        status: 'error' as const,
        error: payload.error.message,
      },
    },
  };
});

connectionsReducer.with(connectBackendRequested, (state) => ({
  ...state,
  connectBackendOperation: loadingResult(state.connectBackendOperation),
}));
connectionsReducer.with(connectBackendRequested.success, (state, { payload }) => ({
  ...state,
  connectBackendOperation: {
    ...state.connectBackendOperation,
    status: 'success',
    result: payload.response,
  },
}));
connectionsReducer.with(connectBackendRequested.failure, (state, { payload }) => ({
  ...state,
  connectBackendOperation: {
    ...state.connectBackendOperation,
    status: 'error',
    error: payload.error.message,
  },
}));
