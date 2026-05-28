import { createSelector } from "../../utils/create-selector";
import {
  type ACPProviderConfig,
  ACP_PROVIDERS,
  getAlwaysEnabledProviders,
  getProviderConfig,
} from "$shared/config/provider-config";

export const selectActiveProviderId = createSelector(
  (state): string => {
    return state.providerSettings.activeProviderId;
  }
);

export const selectActiveProvider = createSelector(
  (state): ACPProviderConfig => {
    return getProviderConfig(state.providerSettings.activeProviderId);
  }
);

export const selectIsProviderActive = createSelector(
  (state, providerId: string): boolean => {
    return state.providerSettings.activeProviderId === providerId;
  }
);

export const selectAvailableProviders = createSelector(
  (): ACPProviderConfig[] => {
    return Object.values(ACP_PROVIDERS);
  }
);

export const selectEnabledProviders = createSelector(
  (state): Record<string, boolean> => {
    return state.providerSettings.enabledProviders;
  }
);

export const selectIsProviderEnabled = createSelector(
  (state, providerId: string): boolean => {
    const config = getProviderConfig(providerId);
    if (config.canBeDisabled === false) return true;
    return state.providerSettings.enabledProviders[providerId] ?? false;
  }
);

export const selectEnabledProviderIds = createSelector(
  (state): string[] => {
    const enabled = new Set(getAlwaysEnabledProviders().map((p) => p.id));
    enabled.add(selectActiveProviderId.select(state));

    for (const [providerId, isEnabled] of Object.entries(state.providerSettings.enabledProviders)) {
      if (isEnabled) {
        enabled.add(providerId);
      }
    }

    return [...enabled];
  }
);