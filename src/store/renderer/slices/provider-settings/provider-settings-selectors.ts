import { store } from "../../store";
import {
  type ACPProviderConfig,
  ACP_PROVIDERS,
  getAlwaysEnabledProviders,
  getProviderConfig,
} from "$shared/config/provider-config";

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

export const selectAvailableProviders = store.createSelector(
  (): ACPProviderConfig[] => {
    return Object.values(ACP_PROVIDERS);
  }
);

export const selectEnabledProviders = store.createSelector(
  (state): Record<string, boolean> => {
    return state.providerSettings.enabledProviders;
  }
);

export const selectIsProviderEnabled = store.createSelector(
  (state, providerId: string): boolean => {
    const config = getProviderConfig(providerId);
    if (config.canBeDisabled === false) return true;
    return state.providerSettings.enabledProviders[providerId] ?? false;
  }
);

export const selectEnabledProviderIds = store.createSelector(
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