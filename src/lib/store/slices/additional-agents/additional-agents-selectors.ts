import { createSelector } from "../../utils/create-selector";
import {
  getAlwaysEnabledProviders,
  getProviderConfig,
} from "$shared/config/provider-config";
import { selectActiveProviderId } from "../active-provider/active-provider-selectors";

/** Select the enabledProviders map */
export const selectEnabledProviders = createSelector(
  (state): Record<string, boolean> => {
    return state.additionalAgents.enabledProviders;
  }
);

/**
 * Select whether a specific provider is enabled.
 * Providers with canBeDisabled=false are always considered enabled.
 */
export const selectIsProviderEnabled = createSelector(
  (state, providerId: string): boolean => {
    const config = getProviderConfig(providerId);
    if (config.canBeDisabled === false) return true;
    return state.additionalAgents.enabledProviders[providerId] ?? false;
  }
);

/**
 * Select list of all enabled provider IDs.
 * Always includes providers with canBeDisabled=false.
 */
export const selectEnabledProviderIds = createSelector(
  (state): string[] => {
    const enabled = new Set(getAlwaysEnabledProviders().map((p) => p.id));
    enabled.add(selectActiveProviderId.select(state));

    for (const [providerId, isEnabled] of Object.entries(
      state.additionalAgents.enabledProviders
    )) {
      if (isEnabled) {
        enabled.add(providerId);
      }
    }

    return [...enabled];
  }
);

