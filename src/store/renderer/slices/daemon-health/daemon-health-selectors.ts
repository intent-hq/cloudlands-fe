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
