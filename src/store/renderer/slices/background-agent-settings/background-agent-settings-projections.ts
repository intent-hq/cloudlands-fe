type BackgroundSettingsRoot = { backgroundAgentSettings: BackgroundAgentSettingsState };
import type {
  BackgroundAgentType,
  BackgroundAgentSettingsState,
} from './background-agent-settings-slice';

/** Select the default model for background agents */
export const getBgDefaultModel = (state: BackgroundSettingsRoot): string => {
  return state.backgroundAgentSettings.defaultModel;
};

/** Select all type overrides */
export const getBgTypeOverrides = (
  state: BackgroundSettingsRoot,
): Record<BackgroundAgentType, string> => {
  return state.backgroundAgentSettings.typeOverrides;
};

/** Select whether a type has a custom override */
export const getHasOverride = (
  state: BackgroundSettingsRoot,
  type: BackgroundAgentType,
): boolean => {
  const override = state.backgroundAgentSettings.typeOverrides[type];
  return Boolean(override || state.backgroundAgentSettings.typeReasoningEffortOverrides[type]);
};

export const getBgDefaultReasoningEffort = (state: BackgroundSettingsRoot) =>
  state.backgroundAgentSettings.defaultReasoningEffort;
export const getBgTypeReasoningEffortOverrides = (state: BackgroundSettingsRoot) =>
  state.backgroundAgentSettings.typeReasoningEffortOverrides;
export const getBgSettings = (state: BackgroundSettingsRoot) => state.backgroundAgentSettings;
