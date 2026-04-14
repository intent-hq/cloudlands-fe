/**
 * Agent Availability Selectors
 */

import { createSelector } from '../../utils/create-selector';

export const selectProviderStatusMap = createSelector(
  (state) => state.agentAvailability.providerStatusMap,
);

export const selectProviderLoadingMap = createSelector(
  (state) => state.agentAvailability.providerLoadingMap,
);

export const selectProviderUserInfoLoadingMap = createSelector(
  (state) => state.agentAvailability.providerUserInfoLoadingMap,
);

export const selectHasCheckedOnce = createSelector(
  (state) => state.agentAvailability.hasCheckedOnce,
);

export const selectWatchedTerminalIds = createSelector(
  (state) => state.agentAvailability.watchedTerminalIds,
);

export const selectIsAnyProviderLoading = createSelector((state) =>
  Object.values(state.agentAvailability.providerLoadingMap).some((v) => v),
);

export const selectHasAnyAvailableProvider = createSelector((state) =>
  Object.values(state.agentAvailability.providerStatusMap).some((s) => s?.available),
);
