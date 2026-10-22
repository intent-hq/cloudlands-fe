import type { AppSettingChange, AppliedSettingChange } from '$lib/client/app-client';
import type { ProviderBgSettings } from '../background-agent-settings/background-agent-settings-slice';
import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringMap(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function isProviderSettings(value: unknown): value is Record<string, ProviderBgSettings> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (snapshot) =>
        isRecord(snapshot) &&
        typeof snapshot.defaultModel === 'string' &&
        isStringMap(snapshot.typeOverrides) &&
        (snapshot.defaultReasoningEffort === undefined ||
          typeof snapshot.defaultReasoningEffort === 'string') &&
        (snapshot.typeReasoningEffortOverrides === undefined ||
          isStringMap(snapshot.typeReasoningEffortOverrides)),
    )
  );
}

/** Build the existing atomic provider/Quick Action transaction from daemon values. */
export function modelSettingsChanges(
  settings: readonly AppliedSettingChange[],
  picks: Record<string, string>,
  providerId?: string,
): AppSettingChange[] {
  const values = new Map(settings.map(({ path, value }) => [path, value]));
  // A complete list includes unset scalars as null and empty maps as {}.
  // Reject incomplete/malformed reads before building a whole-value replacement.
  for (const path of [
    'model.defaultProvider',
    'quickActions.defaultModel',
    'quickActions.defaultReasoningEffort',
  ]) {
    const value = values.get(path);
    if (value !== null && typeof value !== 'string') throw new Error(`Invalid daemon ${path}`);
  }
  for (const path of ['quickActions.typeOverrides', 'quickActions.typeReasoningEffortOverrides']) {
    if (!isStringMap(values.get(path))) throw new Error(`Invalid daemon ${path}`);
  }
  const savedProviders = values.get('quickActions.providerSettings');
  if (!isProviderSettings(savedProviders))
    throw new Error('Invalid daemon quickActions.providerSettings');
  const changes: AppSettingChange[] = [];
  if (providerId !== undefined) changes.push({ path: 'model.defaultProvider', value: providerId });
  if (Object.keys(picks).length) {
    const models = values.get('model.providerDefaults');
    if (!models || typeof models !== 'object' || Array.isArray(models))
      throw new Error('Missing daemon model.providerDefaults');
    changes.push({
      path: 'model.providerDefaults',
      value: {
        ...models,
        ...Object.fromEntries(
          Object.entries(picks).map(([id, model]) => [id, splitLegacyCompoundId(model).modelId]),
        ),
      },
    });
  }
  if (providerId === undefined || providerId === values.get('model.defaultProvider'))
    return changes;
  const providerSettings = { ...savedProviders };
  const previous = values.get('model.defaultProvider');
  if (typeof previous === 'string' && previous) {
    providerSettings[previous] = {
      defaultModel: (values.get('quickActions.defaultModel') as string | null) ?? '',
      typeOverrides: values.get(
        'quickActions.typeOverrides',
      ) as ProviderBgSettings['typeOverrides'],
      defaultReasoningEffort:
        (values.get('quickActions.defaultReasoningEffort') as string | null) ?? '',
      typeReasoningEffortOverrides: values.get(
        'quickActions.typeReasoningEffortOverrides',
      ) as Record<string, string>,
    };
  }
  const next = providerSettings[providerId];
  if (
    [next?.defaultModel, ...Object.values(next?.typeOverrides ?? {})].some(
      (model) => typeof model === 'string' && model.includes(':'),
    )
  )
    throw new Error('Cannot switch to a legacy Quick Action model');
  changes.push(
    { path: 'quickActions.defaultModel', value: next?.defaultModel ?? '' },
    {
      path: 'quickActions.typeOverrides',
      value: next?.typeOverrides ?? { commit: '', pr: '', review: '', fast: '' },
    },
    { path: 'quickActions.defaultReasoningEffort', value: next?.defaultReasoningEffort ?? '' },
    {
      path: 'quickActions.typeReasoningEffortOverrides',
      value: { ...next?.typeReasoningEffortOverrides },
    },
    { path: 'quickActions.providerSettings', value: providerSettings },
  );
  return changes;
}
