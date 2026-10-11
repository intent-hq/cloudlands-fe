import type { ProviderReadState } from '../provider-catalog/provider-read-types';

import { getHostRole, getPrincipalConnectionContext } from '../principal/principal-projections';

export const getProviderStatusMap = (state: ProviderReadState) =>
  state.agentAvailability.providerStatusMap;

export const getProviderLoadingMap = (state: ProviderReadState) =>
  state.agentAvailability.providerLoadingMap;

export const getProviderCheckEpochMap = (state: ProviderReadState) =>
  state.agentAvailability.providerCheckEpochMap;

export const getHasCheckedOnce = (state: ProviderReadState) =>
  state.agentAvailability.hasCheckedOnce;

export const getIsAnyProviderLoading = (state: ProviderReadState) =>
  Object.values(state.agentAvailability.providerLoadingMap).some((v) => v);

export const getNpxStatus = (state: ProviderReadState) => state.agentAvailability.npxStatus;

export const getProviderHiddenIds = (state: ProviderReadState) =>
  state.agentAvailability.hiddenProviders;
export const getProviderDiscoveryError = (state: ProviderReadState) =>
  state.agentAvailability.discoveryError;
export const getProviderDiscoveryRevision = (state: ProviderReadState) =>
  state.agentAvailability.discoveryRevision;
export const getProviderModelsRefreshPending = (state: ProviderReadState) =>
  state.agentAvailability.refreshModelsPending;
export const getProviderModelsRefreshRevision = (state: ProviderReadState) =>
  state.agentAvailability.refreshModelsRevision;

/** Hydrated per-host completion, rather than the current number of workspaces, owns first run. */
export const getOnboardingAdapterPreparationContext = (state: ProviderReadState) =>
  state.sidebarNav?.onboardingActive &&
  state.userPreferences.providerSetupHydratedBackendId === state.connections.windowBackendId &&
  !state.userPreferences.hasCompletedProviderSetup &&
  getHostRole(state) === 'owner'
    ? getPrincipalConnectionContext(state)
    : null;
