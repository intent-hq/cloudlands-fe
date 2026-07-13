import { store } from "../../store";
import type { BackgroundAgentType, ProviderBgSettings } from "./background-agent-settings-slice";

/** Select the default model for background agents */
export const selectBgDefaultModel = store.createSelector(
  (state): string => {
    return state.backgroundAgentSettings.defaultModel;
  }
);

/** Select all type overrides */
export const selectBgTypeOverrides = store.createSelector(
  (state): Record<BackgroundAgentType, string> => {
    return state.backgroundAgentSettings.typeOverrides;
  }
);

/** Select the effective model for a background agent type */
export const selectModelForType = store.createSelector(
  (state, type: BackgroundAgentType): string => {
    const override = state.backgroundAgentSettings.typeOverrides[type];
    if (override && override.length > 0) {
      return override;
    }
    return state.backgroundAgentSettings.defaultModel;
  }
);

/** Select whether a type has a custom override */
export const selectHasOverride = store.createSelector(
  (state, type: BackgroundAgentType): boolean => {
    const override = state.backgroundAgentSettings.typeOverrides[type];
    return !!override && override.length > 0;
  }
);

/** Select the provider settings cache */
export const selectProviderSettings = store.createSelector(
  (state): Record<string, ProviderBgSettings> => {
    return state.backgroundAgentSettings.providerSettings;
  }
);

