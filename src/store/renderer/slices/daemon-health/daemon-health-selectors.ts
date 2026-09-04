/**
 * Daemon Health Selectors
 */

import { compareToPinnedVersion, type PinComparison } from '$shared/intentd-version-compare';
import { store } from '../../store';
import type { BackendTransportInfo } from './daemon-health-types';

export const selectDaemonHealth = store.createSelector((state) => state.daemonHealth.health);

export const selectDaemonHealthStats = store.createSelector((state) => state.daemonHealth.stats);

export const selectDaemonHealthLastUpdated = store.createSelector(
  (state) => state.daemonHealth.lastUpdated,
);

/** Last-known transport info; survives disconnects (see DaemonHealthState.transport). */
export const selectDaemonTransport = store.createSelector((state) => state.daemonHealth.transport);

/** Reconnect attempts since the last successful connect (#1750). */
export const selectReconnectAttempts = store.createSelector(
  (state) => state.daemonHealth.reconnectAttempts,
);

/** Connected-daemon-vs-pin version comparison derived for the health UI. */
export interface DaemonVersionComparison {
  /** Semver ordering of the daemon version relative to the pin ('unknown' when unparsable). */
  comparison: PinComparison;
  /** Live version from the last system.status poll. */
  daemonVersion: string;
  /** The bundled intentd.version pin, from transport info. */
  pinnedVersion: string;
}

/**
 * Compares the connected daemon's live version (`stats.version`, from the
 * last system.status poll) against the bundled intentd.version pin
 * (`transport.pinnedVersion`). Returns `null` when either side is missing —
 * older daemons that omit `version` and builds without a pin degrade to "no
 * mismatch". A mismatch is `comparison === 'older' | 'newer'`; 'unknown'
 * (unparsable version) is not a mismatch.
 */
export const selectDaemonVersionComparison = store.createSelector(
  (state): DaemonVersionComparison | null => {
    const daemonVersion = state.daemonHealth.stats?.version;
    const pinnedVersion = state.daemonHealth.transport?.pinnedVersion;
    if (!daemonVersion || !pinnedVersion) return null;
    return {
      comparison: compareToPinnedVersion(daemonVersion, pinnedVersion),
      daemonVersion,
      pinnedVersion,
    };
  },
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
 * local desktop.
 *
 * Prefers the daemon-reported `host.locality` from the last system.status
 * poll (BE = source of truth; it reflects a forced `server.locality`
 * override, §5.12/§5.14, that the transport mode cannot see). Falls back to
 * the FE transport heuristic before the first poll lands.
 */
export const selectIsDaemonLocal = store.createSelector((state): boolean => {
  const reported = state.daemonHealth.hostLocality;
  if (reported === 'local' || reported === 'remote') return reported === 'local';
  return isLocalTransport(state.daemonHealth.transport);
});

/** True when the sidecar supervisor gave up restarting the daemon (#439). */
export const selectSidecarGaveUp = store.createSelector(
  (state) => state.daemonHealth.sidecarGaveUp,
);

/** Reason string from the sidecar give-up broadcast, if any. */
export const selectSidecarGaveUpReason = store.createSelector(
  (state) => state.daemonHealth.sidecarGaveUpReason,
);

/** True when the sidecar spawn could not happen at all (binary not found, spawn error). */
export const selectSidecarStartupFailed = store.createSelector(
  (state) => state.daemonHealth.sidecarStartupFailed,
);

/** Reason string from the sidecar startup-failure broadcast, if any. */
export const selectSidecarStartupFailedReason = store.createSelector(
  (state) => state.daemonHealth.sidecarStartupFailedReason,
);

/** True once a successful connect has landed at any point since app launch. */
export const selectHasEverConnected = store.createSelector(
  (state) => state.daemonHealth.hasEverConnected,
);

/** True while an on-demand sidecar spawn is pending (#439). */
export const selectSidecarSpawnPending = store.createSelector(
  (state) => state.daemonHealth.sidecarSpawnPending,
);

/** Error string from the last failed on-demand sidecar spawn, if any. */
export const selectSidecarSpawnError = store.createSelector(
  (state) => state.daemonHealth.sidecarSpawnError,
);

/**
 * Epoch ms of the first disconnect caused by a user-requested daemon update,
 * or null when the current outage (if any) is not update-caused.
 */
export const selectDaemonUpdateDisconnectedAt = store.createSelector(
  (state) => state.daemonHealth.daemonUpdateDisconnectedAt,
);

/** Last-run sidecar log fetched on demand for the daemon-loss dialog, if any. */
export const selectSidecarRunLog = store.createSelector(
  (state) => state.daemonHealth.sidecarRunLog,
);

/** True while a backend:get-sidecar-run-log fetch is in flight. */
export const selectSidecarRunLogPending = store.createSelector(
  (state) => state.daemonHealth.sidecarRunLogPending,
);

/** Error string from the last failed run-log fetch, if any. */
export const selectSidecarRunLogError = store.createSelector(
  (state) => state.daemonHealth.sidecarRunLogError,
);

/** Last unsloth.status result (polled while the status dropdown is open), if any. */
export const selectUnslothStatus = store.createSelector(
  (state) => state.daemonHealth.unslothStatus,
);

/** True while an unsloth.stop request is in flight. */
export const selectUnslothStopping = store.createSelector(
  (state) => state.daemonHealth.unslothStopping,
);
