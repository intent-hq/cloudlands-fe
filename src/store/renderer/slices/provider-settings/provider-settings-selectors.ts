import { store } from "../../store";
import {
  ACP_PROVIDERS,
  type ACPProviderConfig,
  getProviderConfig,
  resolveProviderEnabled,
} from "$shared/config/provider-config";
import { selectProviderStatusMap } from "../agent-availability/agent-availability-selectors";

export const selectActiveProviderId = store.createSelector(
  (state): string => {
    return state.providerSettings.activeProviderId;
  }
);

export const selectActiveProvider = store.createSelector(
  (state): ACPProviderConfig => {
    return getProviderConfig(state.providerSettings.activeProviderId);
  }
);

export const selectIsProviderActive = store.createSelector(
  (state, providerId: string): boolean => {
    return state.providerSettings.activeProviderId === providerId;
  }
);

export const selectEnabledProviders = store.createSelector(
  (state): Record<string, boolean> => {
    return state.providerSettings.enabledProviders;
  }
);

export const selectIsProviderEnabled = store.createSelector(
  (state, providerId: string): boolean => {
    return resolveProviderEnabled(state.providerSettings.enabledProviders, providerId);
  }
);

export const selectEnabledProviderIds = store.createSelector(
  (state): string[] => {
    const enabledProviders = state.providerSettings.enabledProviders;
    const enabled = new Set(
      Object.values(ACP_PROVIDERS)
        .filter((p) => resolveProviderEnabled(enabledProviders, p.id))
        .map((p) => p.id)
    );
    enabled.add(selectActiveProviderId.select(state));

    for (const [providerId, isEnabled] of Object.entries(enabledProviders)) {
      if (isEnabled) {
        enabled.add(providerId);
      }
    }

    return [...enabled];
  }
);

/**
 * A provider is hidden when it's gated behind an env var / feature code the
 * renderer cannot verify — mirrors the default-deny gating in
 * `provider-status-bridge-seeder.ts`'s `computeHiddenProviders`.
 */
function isProviderHidden(providerId: string): boolean {
  const config = getProviderConfig(providerId);
  return Boolean(config.requiresEnvVar || config.requiresFeatureCode);
}

/**
 * Enabled provider ids that are also known-available (per the
 * agent-availability slice) and not hidden. This is the availability-gated
 * pool the UI should offer for selection — per decision D1(B) we never
 * auto-switch into it, we only use it to detect/surface failure.
 */
export const selectAvailableEnabledProviderIds = store.createSelector(
  (state): string[] => {
    const statusMap = selectProviderStatusMap.select(state);
    return selectEnabledProviderIds
      .select(state)
      .filter((id) => !isProviderHidden(id) && statusMap[id]?.available === true);
  }
);

/** Whether the currently active provider is in the available+enabled set. */
export const selectIsActiveProviderAvailable = store.createSelector(
  (state): boolean => {
    const activeProviderId = selectActiveProviderId.select(state);
    return selectAvailableEnabledProviderIds.select(state).includes(activeProviderId);
  }
);
