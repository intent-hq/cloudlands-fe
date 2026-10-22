import type { AppSettingChange, AppliedSettingChange } from '$lib/client/app-client';
import {
  backgroundFields,
  type BackgroundAgentSettingsState,
} from './background-agent-settings-slice';

/** Rebase the existing pending batch without replaying unrelated displayed values. */
export function rebaseBackgroundSettings(
  snapshot: readonly AppliedSettingChange[],
  pending: BackgroundAgentSettingsState,
): BackgroundAgentSettingsState {
  const values = new Map(snapshot.map(({ path, value }) => [path, value]));
  const provider = values.get('model.defaultProvider');
  if (provider !== null && typeof provider !== 'string')
    throw new Error('Invalid daemon model.defaultProvider');
  const providerId = provider || undefined;
  const fields = Object.fromEntries(
    backgroundFields.map((field) => {
      const value = values.get(`quickActions.${field}`);
      const valid =
        field === 'defaultModel' || field === 'defaultReasoningEffort'
          ? value === null || typeof value === 'string'
          : value !== null && typeof value === 'object' && !Array.isArray(value);
      if (!valid) throw new Error(`Missing daemon quickActions.${field}`);
      return [field, value === null ? '' : value];
    }),
  );
  const rebased = { ...pending, ...fields, providerId } as BackgroundAgentSettingsState;
  for (const [field, generation] of Object.entries(pending.pendingFields ?? {})) {
    if (generation === undefined || generation > (pending.persistenceGeneration ?? 0)) continue;
    const separator = field.indexOf('.');
    if (separator === -1) {
      const name = field as (typeof backgroundFields)[number];
      Object.assign(rebased, { [name]: pending[name] });
    } else {
      const name = field.slice(0, separator) as 'typeOverrides' | 'typeReasoningEffortOverrides';
      const key = field.slice(separator + 1);
      const current: Record<string, string> = pending[name];
      const map: Record<string, string> = { ...rebased[name] };
      if (key in current) map[key] = current[key];
      else delete map[key];
      Object.assign(rebased, { [name]: map });
    }
  }
  return rebased;
}

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
