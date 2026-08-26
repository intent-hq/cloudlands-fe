/**
 * Connections Selectors
 */

import { store } from '../../store';
import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type { ConnectionOpenStatus, ConnectionRecord } from './connections-types';

/** Full ordered connections list (local first, then remotes). */
export const selectConnections = store.createSelector((state) =>
  getItems(state.connections.connections),
);

/** Saved remote machines only (the synthetic local record is excluded). */
export const selectRemoteConnections = store.createSelector((state) =>
  getItems(state.connections.connections).filter((connection) => !connection.isLocal),
);

/** Whether the authoritative connection list has completed its first hydration. */
export const selectConnectionsLoaded = store.createSelector(
  (state) => state.connections.hasReceivedList,
);

/** Transient open state for one saved connection. Unknown/legacy entries are not open. */
export const selectConnectionOpenStatus = store.createSelector(
  (state, id: string): ConnectionOpenStatus =>
    getItem(state.connections.connections, id)?.status ?? 'not-open',
);

/** id of the active connection (`LOCAL_CONNECTION_ID` for the local sidecar). */
export const selectActiveConnectionId = store.createSelector((state) => state.connections.activeId);

/** The active connection record, or null before the list has loaded. */
export const selectActiveConnection = store.createSelector((state): ConnectionRecord | null => {
  const { connections, activeId } = state.connections;
  return getItems(connections).find((c) => c.id === activeId) ?? null;
});

/** id of the backend bound to this renderer window. */
export const selectCurrentConnectionId = store.createSelector(
  (state) => state.connections.windowBackendId,
);

/** The connection record bound to this renderer window, or null before list hydration. */
export const selectCurrentConnection = store.createSelector((state): ConnectionRecord | null => {
  const { connections, windowBackendId } = state.connections;
  return getItem(connections, windowBackendId) ?? null;
});

/** Status of the in-flight add/switch operation. */
export const selectConnectionStatus = store.createSelector((state) => state.connections.status);

/** True while an add/switch operation is in flight. */
export const selectIsConnecting = store.createSelector(
  (state) => state.connections.status === 'connecting',
);

/** Error message from the last failed add/switch operation, or null. */
export const selectConnectionError = store.createSelector((state) => state.connections.error);

/** Last pinned-cert mismatch push, or null. Drives the blocking failure modal. */
export const selectConnectionCertMismatch = store.createSelector(
  (state) => state.connections.certMismatch,
);

/**
 * Auth rejection for the currently-active backend, or null. The backend
 * rejected the WebSocket upgrade with HTTP 401/403 (bad/rotated token, or the
 * WS API is disabled). Gated on the active connection id so switching backends
 * hides the state without an explicit clear. Drives the actionable "token
 * rejected — re-pair" posture of the daemon-loss overlay.
 */
export const selectActiveAuthRejected = store.createSelector((state) => {
  const { authRejected, activeId } = state.connections;
  return authRejected && authRejected.id === activeId ? authRejected : null;
});

/**
 * Protocol mismatch for the currently-active backend, or null. Gated on the
 * active connection id so switching back to local (or to a compatible remote)
 * hides the warning without an explicit clear. Drives the persistent
 * daemon-status menu warning.
 */
export const selectActiveProtocolMismatch = store.createSelector((state) => {
  const { protocolMismatch, activeId } = state.connections;
  return protocolMismatch && protocolMismatch.id === activeId ? protocolMismatch : null;
});

/**
 * Protocol mismatch that should surface the advisory modal, or null. Same
 * active-backend gating as {@link selectActiveProtocolMismatch}, plus the modal must
 * not have been dismissed for this mismatch (warn-but-allow — dismissing keeps
 * the connection and the persistent menu warning).
 */
export const selectProtocolMismatchModal = store.createSelector((state) => {
  const { protocolMismatch, activeId, protocolMismatchModalDismissed } = state.connections;
  if (!protocolMismatch || protocolMismatch.id !== activeId) return null;
  return protocolMismatchModalDismissed ? null : protocolMismatch;
});

/**
 * iCloud-keychain sync state (supported/enabled/status), or null before the
 * settings UI first loads it. Drives the T4 settings toggle + status line.
 */
export const selectKeychainSyncState = store.createSelector(
  (state) => state.connections.keychainSync,
);
