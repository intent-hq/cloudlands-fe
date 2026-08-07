/**
 * Agent Availability Selectors
 */

import { store } from "../../store";

export const selectProviderStatusMap = store.createSelector(
  (state) => state.agentAvailability.providerStatusMap,
);

export const selectProviderLoadingMap = store.createSelector(
  (state) => state.agentAvailability.providerLoadingMap,
);

export const selectHasCheckedOnce = store.createSelector(
  (state) => state.agentAvailability.hasCheckedOnce,
);

export const selectWatchedTerminalIds = store.createSelector(
  (state) => state.agentAvailability.watchedTerminalIds,
);

export const selectIsAnyProviderLoading = store.createSelector((state) =>
  Object.values(state.agentAvailability.providerLoadingMap).some((v) => v),
);

export const selectNpxStatus = store.createSelector(
  (state) => state.agentAvailability.npxStatus,
);
