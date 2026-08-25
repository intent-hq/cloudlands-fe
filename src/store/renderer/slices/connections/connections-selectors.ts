/**
 * Connections Selectors
 */

import { store } from '../../store';
import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type { ConnectionRecord } from './connections-types';

/** Full ordered connections list (local first, then remotes). */
export const selectConnections = store.createSelector((state) =>
  getItems(state.connections.connections),
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
 * Auth rejection for this window's backend, or null. The backend
 * rejected the WebSocket upgrade with HTTP 401/403 (bad/rotated token, or the
 * WS API is disabled). Gated on the window backend id so switching backends
 * hides the state without an explicit clear. Drives the actionable "token
 * rejected — re-pair" posture of the daemon-loss overlay.
 */
export const selectActiveAuthRejected = store.createSelector((state) => {
  const { authRejected, windowBackendId } = state.connections;
  return authRejected && authRejected.id === windowBackendId ? authRejected : null;
});

/**
 * Protocol mismatch for this window's backend, or null. Gated on the window
 * backend id so switching back to local (or to a compatible remote)
 * hides the warning without an explicit clear. Drives the persistent
 * daemon-status menu warning.
 */
export const selectActiveProtocolMismatch = store.createSelector((state) => {
  const { protocolMismatch, windowBackendId } = state.connections;
  return protocolMismatch && protocolMismatch.id === windowBackendId ? protocolMismatch : null;
});

/**
 * Protocol mismatch that should surface the advisory modal, or null. Same
 * window-backend gating as {@link selectActiveProtocolMismatch}, plus the modal must
 * not have been dismissed for this mismatch (warn-but-allow — dismissing keeps
 * the connection and the persistent menu warning).
 */
export const selectProtocolMismatchModal = store.createSelector((state) => {
  const { protocolMismatch, windowBackendId, protocolMismatchModalDismissed } = state.connections;
  if (!protocolMismatch || protocolMismatch.id !== windowBackendId) return null;
  return protocolMismatchModalDismissed ? null : protocolMismatch;
});
