import { store } from "../../store";
import {
  ACP_PROVIDERS,
  type ACPProviderConfig,
  getProviderConfig,
  resolveProviderEnabled,
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