import type { AppSettingChange } from '$lib/client/app-client';
import type { BackgroundAgentSettingsState } from './background-agent-settings-slice';

/** Persist the entire provider-local bundle in the provider switch transaction. */
export function backgroundSettingsChanges(
  state: BackgroundAgentSettingsState,
  providerId?: string,
): AppSettingChange[] {
  const snapshot =
    providerId && providerId !== state.providerId ? state.providerSettings[providerId] : state;
  return [
    { path: 'quickActions.defaultModel', value: snapshot?.defaultModel ?? '' },
    { path: 'quickActions.typeOverrides', value: { ...snapshot?.typeOverrides } },
    { path: 'quickActions.defaultReasoningEffort', value: snapshot?.defaultReasoningEffort ?? '' },
    {
      path: 'quickActions.typeReasoningEffortOverrides',
      value: { ...snapshot?.typeReasoningEffortOverrides },
    },
    { path: 'quickActions.providerSettings', value: { ...state.providerSettings } },
  ];
}
