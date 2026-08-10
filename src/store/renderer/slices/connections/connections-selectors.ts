/**
 * Connections Selectors
 */

import { store } from '../../store';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type { ConnectionRecord } from './connections-types';

/** Full ordered connections list (local first, then remotes). */
export const selectConnections = store.createSelector((state) => getItems(state.connections.connections));

/** id of the active connection (`LOCAL_CONNECTION_ID` for the local sidecar). */
export const selectActiveConnectionId = store.createSelector((state) => state.connections.activeId);

/** The active connection record, or null before the list has loaded. */
export const selectActiveConnection = store.createSelector((state): ConnectionRecord | null => {
  const { connections, activeId } = state.connections;
  return getItems(connections).find((c) => c.id === activeId) ?? null;
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
 * Auth rejection for the CURRENTLY-ACTIVE backend, or null. The backend
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
 * Protocol mismatch for the CURRENTLY-ACTIVE backend, or null. Gated on the
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
 * active-id gating as {@link selectActiveProtocolMismatch}, plus the modal must
 * not have been dismissed for this mismatch (warn-but-allow — dismissing keeps
 * the connection and the persistent menu warning).
 */
export const selectProtocolMismatchModal = store.createSelector((state) => {
  const { protocolMismatch, activeId, protocolMismatchModalDismissed } = state.connections;
  if (!protocolMismatch || protocolMismatch.id !== activeId) return null;
  return protocolMismatchModalDismissed ? null : protocolMismatch;
});
