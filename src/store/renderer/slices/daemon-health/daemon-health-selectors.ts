/**
 * Daemon Health Selectors
 */

import { store } from '../../store';

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
