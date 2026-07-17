/**
 * Agent Availability Selectors
 */

import { store } from "../../store";
import type { ManagedInstallStatus } from './agent-availability-types';

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

export const selectManagedInstallStatusByProvider = store.createSelector(
  (state, providerId: string): ManagedInstallStatus | null => {
    const status = state.agentAvailability.providerStatusMap[providerId];
    if (!status?.managedInstallState) return null;
    return {
      managedInstallState: status.managedInstallState,
      version: status.version,
      downloadProgress: status.downloadProgress,
      error: status.error,
      usingFallback: status.usingFallback,
    };
  },
);

export const selectNpxStatus = store.createSelector(
  (state) => state.agentAvailability.npxStatus,
);
