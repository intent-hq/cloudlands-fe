import { createSelector } from "../../utils/create-selector";
import {
  type ACPProviderConfig,
  ACP_PROVIDERS,
  getProviderConfig,
} from "$shared/config/provider-config";

/** Select the active provider ID */
export const selectActiveProviderId = createSelector(
  (state): string => {
    return state.activeProvider.activeProviderId;
  }
);

/** Select the full config for the active provider */
export const selectActiveProvider = createSelector(
  (state): ACPProviderConfig => {
    return getProviderConfig(state.activeProvider.activeProviderId);
  }
);

/** Select whether a specific provider is currently active */
export const selectIsProviderActive = createSelector(
  (state, providerId: string): boolean => {
    return state.activeProvider.activeProviderId === providerId;
  }
);

/** Select all available (configured) providers */
export const selectAvailableProviders = createSelector(
  (): ACPProviderConfig[] => {
    return Object.values(ACP_PROVIDERS);
  }
);

