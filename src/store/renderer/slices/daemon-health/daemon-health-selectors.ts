/**
 * Daemon Health Selectors
 */

import { store } from '../../store';
import type { BackendTransportInfo } from './daemon-health-types';

export const selectDaemonHealth = store.createSelector(
  (state) => state.daemonHealth.health,
);

export const selectDaemonHealthStats = store.createSelector(
  (state) => state.daemonHealth.stats,
);

export const selectDaemonHealthLastUpdated = store.createSelector(
  (state) => state.daemonHealth.lastUpdated,
);

export const selectDaemonHealthPolling = store.createSelector(
  (state) => state.daemonHealth.polling,
);

/** Last-known transport info; survives disconnects (see DaemonHealthState.transport). */
export const selectDaemonTransport = store.createSelector(
  (state) => state.daemonHealth.transport,
);

/**
 * Whether a transport reaches a daemon on THIS machine (PROTOCOL §5.14
 * locality: UDS ⇒ local, WebSocket ⇒ remote). A `null` transport — no
 * backend:status/backend:get-status info yet — is treated as local: the only
 * production paths are the Electron builds (sidecar or adopted UDS daemon,
 * both local) and the remote-WS build, which reports `external-ws` on its
 * very first status event, so the optimistic default never leaks a
 * remote-host reveal.
 */
export function isLocalTransport(transport: BackendTransportInfo | null): boolean {
  return transport === null || transport.mode !== 'external-ws';
}

/**
 * True when the daemon host is the user's machine — gates host-shell
 * affordances (reveal-in-file-manager, editor opens) that must act on the
 * local desktop, per the same UDS-vs-WS discrimination the daemon itself
 * uses for `host.locality` (§5.14).
 */
export const selectIsDaemonLocal = store.createSelector((state): boolean =>
  isLocalTransport(state.daemonHealth.transport),
);

/** True when the sidecar supervisor gave up restarting the daemon (#439). */
export const selectSidecarGaveUp = store.createSelector(
  (state) => state.daemonHealth.sidecarGaveUp,
);

/** Reason string from the sidecar give-up broadcast, if any. */
export const selectSidecarGaveUpReason = store.createSelector(
  (state) => state.daemonHealth.sidecarGaveUpReason,
);

/** True while an on-demand sidecar spawn is pending (#439). */
export const selectSidecarSpawnPending = store.createSelector(
  (state) => state.daemonHealth.sidecarSpawnPending,
);

/** Error string from the last failed on-demand sidecar spawn, if any. */
export const selectSidecarSpawnError = store.createSelector(
  (state) => state.daemonHealth.sidecarSpawnError,
);
