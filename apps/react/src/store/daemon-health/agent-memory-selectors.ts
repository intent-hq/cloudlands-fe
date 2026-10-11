import { store } from '../index';

/** ReactStore bindings for the canonical daemon-health memory sample. */
export const selectAgentMemoryUsage = store.createSelector(
  (state) => state.daemonHealth.agentMemoryUsage,
);

export const selectAgentMemoryUsageError = store.createSelector(
  (state) => state.daemonHealth.agentMemoryUsageError,
);
