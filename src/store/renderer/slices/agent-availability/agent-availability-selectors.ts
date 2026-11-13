/**
 * Agent Availability Selectors
 */

import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import { store } from '../../store';
import {
  selectHostRole,
  selectIsOrchestratorBackend,
  selectPrincipalConnectionContext,
} from '../principal/principal-selectors';
import type { ProviderStatus } from './agent-availability-types';

/** One stable map per catalog collection, so consumers see a stable reference. */
const orchestratorStatusMaps = new WeakMap<object, Record<string, ProviderStatus>>();

/**
 * Per-provider status. On an orchestrator the backend runs no provider CLI
 * and checks none (`host.providerDiscovery` → no providers), yet every
 * provider can be enabled and used: whether it runs is each machine's own
 * report (PROTOCOL `provider-profiles.md` → "Profiles on an orchestrator").
 * Every catalog provider there counts as available with no sign-in verdict,
 * so readiness checks (agent creation, model picker, setup gate) and
 * Settings agree.
 */
export const selectProviderStatusMap = store.createSelector(
  (state): Record<string, ProviderStatus> => {
    if (!selectIsOrchestratorBackend.select(state))
      return state.agentAvailability.providerStatusMap;
    const providers = state.providerCatalog?.providers;
    if (!providers) return {};
    let map = orchestratorStatusMaps.get(providers);
    if (!map) {
      map = Object.fromEntries(getItems(providers).map((entry) => [entry.id, { available: true }]));
      orchestratorStatusMaps.set(providers, map);
    }
    return map;
  },
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
