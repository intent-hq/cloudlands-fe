import { store } from '../index';

/** ReactStore bindings for the shared daemon-health reducer. */
export const selectDaemonHealth = store.createSelector((state) => state.daemonHealth.health);
export const selectHasEverConnected = store.createSelector(
  (state) => state.daemonHealth.hasEverConnected,
);

export const selectAgentMemoryUsage = store.createSelector(
  (state) => state.daemonHealth.agentMemoryUsage,
);

export const selectAgentMemoryUsageError = store.createSelector(
  (state) => state.daemonHealth.agentMemoryUsageError,
);
