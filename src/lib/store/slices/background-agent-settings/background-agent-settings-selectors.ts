import { createSelector } from "../../utils/create-selector";
import type { BackgroundAgentType, ProviderBgSettings } from "./background-agent-settings-slice";

/** Select the default model for background agents */
export const selectBgDefaultModel = createSelector(
  (state): string => {
    return state.backgroundAgentSettings.defaultModel;
  }
);

/** Select all type overrides */
export const selectBgTypeOverrides = createSelector(
  (state): Record<BackgroundAgentType, string> => {
    return state.backgroundAgentSettings.typeOverrides;
  }
);

/** Select the effective model for a background agent type */
export const selectModelForType = createSelector(
  (state, type: BackgroundAgentType): string => {
    const override = state.backgroundAgentSettings.typeOverrides[type];
    if (override && override.length > 0) {
      return override;
    }
    return state.backgroundAgentSettings.defaultModel;
  }
);

/** Select whether a type has a custom override */
export const selectHasOverride = createSelector(
  (state, type: BackgroundAgentType): boolean => {
    const override = state.backgroundAgentSettings.typeOverrides[type];
    return !!override && override.length > 0;
  }
);

/** Select the provider settings cache */
export const selectProviderSettings = createSelector(
  (state): Record<string, ProviderBgSettings> => {
    return state.backgroundAgentSettings.providerSettings;
  }
);

