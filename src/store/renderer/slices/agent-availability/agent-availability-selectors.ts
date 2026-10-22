/**
 * Agent Availability Selectors
 */

import { store } from '../../store';
import { selectHostRole, selectPrincipalConnectionContext } from '../principal/principal-selectors';

export const selectProviderStatusMap = store.createSelector(
  (state) => state.agentAvailability.providerStatusMap,
);

export const selectProviderLoadingMap = store.createSelector(
  (state) => state.agentAvailability.providerLoadingMap,
);

export const selectProviderCheckEpochMap = store.createSelector(
  (state) => state.agentAvailability.providerCheckEpochMap,
);

export const selectHasCheckedOnce = store.createSelector(
  (state) => state.agentAvailability.hasCheckedOnce,
);

export const selectIsAnyProviderLoading = store.createSelector((state) =>
  Object.values(state.agentAvailability.providerLoadingMap).some((v) => v),
);

export const selectNpxStatus = store.createSelector((state) => state.agentAvailability.npxStatus);

export const selectProviderHiddenIds = store.createSelector(
  (state) => state.agentAvailability.hiddenProviders,
);
export const selectProviderDiscoveryError = store.createSelector(
  (state) => state.agentAvailability.discoveryError,
);
export const selectProviderDiscoveryRevision = store.createSelector(
  (state) => state.agentAvailability.discoveryRevision,
);
export const selectProviderModelsRefreshPending = store.createSelector(
  (state) => state.agentAvailability.refreshModelsPending,
);
export const selectProviderModelsRefreshRevision = store.createSelector(
  (state) => state.agentAvailability.refreshModelsRevision,
);

/** Hydrated per-host completion, rather than the current number of workspaces, owns first run. */
export const selectOnboardingAdapterPreparationContext = store.createSelector((state) =>
  state.sidebarNav?.onboardingActive &&
  state.userPreferences.providerSetupHydratedBackendId === state.connections.windowBackendId &&
  !state.userPreferences.hasCompletedProviderSetup &&
  selectHostRole.select(state) === 'owner'
    ? selectPrincipalConnectionContext.select(state)
    : null,
);
