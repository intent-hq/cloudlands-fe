import { store } from '../../store';
import type { BackgroundAgentType } from './background-agent-settings-slice';

/** Select the default model for background agents */
export const selectBgDefaultModel = store.createSelector((state): string => {
  return state.backgroundAgentSettings.defaultModel;
});

/** Select all type overrides */
export const selectBgTypeOverrides = store.createSelector(
  (state): Record<BackgroundAgentType, string> => {
    return state.backgroundAgentSettings.typeOverrides;
  },
);

/** Select whether a type has a custom override */
export const selectHasOverride = store.createSelector(
  (state, type: BackgroundAgentType): boolean => {
    const override = state.backgroundAgentSettings.typeOverrides[type];
    return Boolean(override || state.backgroundAgentSettings.typeReasoningEffortOverrides[type]);
  },
);

export const selectBgDefaultReasoningEffort = store.createSelector(
  (state) => state.backgroundAgentSettings.defaultReasoningEffort,
);
export const selectBgTypeReasoningEffortOverrides = store.createSelector(
  (state) => state.backgroundAgentSettings.typeReasoningEffortOverrides,
);
export const selectBgSettings = store.createSelector((state) => state.backgroundAgentSettings);
