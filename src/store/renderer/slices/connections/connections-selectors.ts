/**
 * Connections Selectors
 */

import { store } from '../../store';
import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type {
  ConnectionHostCertWarning,
  ConnectionOpenStatus,
  ConnectionRecord,
} from './connections-types';

const NO_CERT_WARNINGS: ConnectionHostCertWarning[] = [];

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

/** id of the backend bound to this renderer window. */
export const selectCurrentConnectionId = store.createSelector(
  (state) => state.connections.windowBackendId,
);

/** The connection record bound to this renderer window, or null before list hydration. */
export const selectCurrentConnection = store.createSelector((state): ConnectionRecord | null => {
  const { connections, windowBackendId } = state.connections;
  return getItem(connections, windowBackendId) ?? null;
});

/**
 * The app's pinned intentd version, or null before the list has loaded or
 * when the pin file is missing/malformed. Compared against each remote's
 * captured `daemonVersion`.
 */
export const selectPinnedDaemonVersion = store.createSelector(
  (state) => state.connections.pinnedVersion,
);

/**
 * ids of the connections with a live, currently-connected client in main's
 * pool. Gates connected-only actions (the remote Update button).
 */
export const selectConnectedIds = store.createSelector((state) => state.connections.connectedIds);

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
 * NON-FATAL per-host cert warnings by connection id (latest fingerprint per
 * host, accumulated by main across reconnect attempts). Informative only —
 * never blocks anything. Connections without observed warnings have no entry.
 * The state stores a host-keyed `Collection` per id; this unwraps to ordered
 * lists for the per-row warning icon in the daemon-status devices list.
 */
export const selectCertWarningsByConnectionId = store.createSelector(
  (state): Record<string, ConnectionHostCertWarning[]> => {
    const byId: Record<string, ConnectionHostCertWarning[]> = {};
    for (const [id, warnings] of Object.entries(state.connections.certWarnings)) {
      byId[id] = getItems(warnings);
    }
    return byId;
  },
);

/**
 * NON-FATAL per-host cert warnings for THIS WINDOW'S backend. Same gating as
 * the other own-backend selectors: switching backends hides another
 * connection's warnings without an explicit clear. Drives the passive list in
 * the reconnect overlay and the daemon-status menu.
 */
export const selectCurrentConnectionCertWarnings = store.createSelector(
  (state): ConnectionHostCertWarning[] => {
    const warnings = state.connections.certWarnings[state.connections.windowBackendId];
    return warnings ? getItems(warnings) : NO_CERT_WARNINGS;
  },
);

/**
 * Auth rejection for THIS WINDOW'S backend, or null. The backend rejected the
 * WebSocket upgrade with HTTP 401/403 (bad/rotated token, or the WS API is
 * disabled). Gated on the window's own connection id so a window bound to a
 * pooled backend surfaces its own rejection and switching backends hides the
 * state without an explicit clear. Drives the actionable "token rejected —
 * re-pair" posture of the daemon-loss overlay.
 */
export const selectActiveAuthRejected = store.createSelector((state) => {
  const { authRejected, windowBackendId } = state.connections;
  return authRejected && authRejected.id === windowBackendId ? authRejected : null;
});

/**
 * Protocol mismatch for THIS WINDOW'S backend, or null. Gated on the window's
 * own connection id so a window bound to a pooled backend surfaces its own
 * mismatch, and switching back to local (or to a compatible remote) hides the
 * warning without an explicit clear. Drives the persistent daemon-status menu
 * warning.
 */
export const selectActiveProtocolMismatch = store.createSelector((state) => {
  const { protocolMismatch, windowBackendId } = state.connections;
  return protocolMismatch && protocolMismatch.id === windowBackendId ? protocolMismatch : null;
});

/**
 * Protocol mismatch that should surface the advisory modal, or null. Same
 * own-backend gating as {@link selectActiveProtocolMismatch}, plus the modal must
 * not have been dismissed for this mismatch (warn-but-allow — dismissing keeps
 * the connection and the persistent menu warning).
 */
export const selectProtocolMismatchModal = store.createSelector((state) => {
  const { protocolMismatch, windowBackendId, protocolMismatchModalDismissed } = state.connections;
  if (!protocolMismatch || protocolMismatch.id !== windowBackendId) return null;
  return protocolMismatchModalDismissed ? null : protocolMismatch;
});

/**
 * iCloud-keychain sync state (supported/enabled/status), or null before the
 * settings UI first loads it. Drives the T4 settings toggle + status line.
 */
export const selectKeychainSyncState = store.createSelector(
  (state) => state.connections.keychainSync,
);
