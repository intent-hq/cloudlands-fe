import type { DropdownGroup, DropdownOption } from '$lib/components/ui/dropdown';
import { ACP_PROVIDERS, getProviderConfig } from '$shared/config/provider-config';

import {
  formatProviderLoadError,
  type ProviderLoadError,
} from './model-picker-provider-errors';
import { toDropdownOptions } from './model-picker-utils';

type ModelPickerOptions = Parameters<typeof toDropdownOptions>[0];

interface BuildGroupedModelOptionsParams {
  showDefaultOption: boolean;
  useDefaultOption: DropdownOption;
  isAgentProviderOverride: boolean;
  effectiveProviderId: string;
  availableModels: ModelPickerOptions;
  enabledProviderIds: string[];
  allProviderModels: Record<string, DropdownOption[]>;
  allProviderLoading: Record<string, boolean>;
  allProviderErrors: Record<string, ProviderLoadError>;
  allProviderWarnings: Record<string, string>;
}

export function buildGroupedModelOptions({
  showDefaultOption,
  useDefaultOption,
  isAgentProviderOverride,
  effectiveProviderId,
  availableModels,
  enabledProviderIds,
  allProviderModels,
  allProviderLoading,
  allProviderErrors,
  allProviderWarnings,
}: BuildGroupedModelOptionsParams): DropdownGroup[] {
  const groups: DropdownGroup[] = [];

  if (showDefaultOption) {
    groups.push({
      key: 'default',
      label: '',
      options: [useDefaultOption],
    });
  }

  if (isAgentProviderOverride) {
    const providerConfig = getProviderConfig(effectiveProviderId);
    if (availableModels.length > 0) {
      groups.push({
        key: effectiveProviderId,
        label: providerConfig.displayName,
        options: toDropdownOptions(availableModels),
      });
    }
    return groups;
  }

  const normalizedEnabledProviderIds = new Set(
    enabledProviderIds.map((pid) => getProviderConfig(pid).id),
  );
  // Keep the agent's current provider group visible even if that provider was
  // since disabled in settings, so the selected model isn't orphaned.
  const normalizedEffectiveProviderId = getProviderConfig(effectiveProviderId).id;

  for (const pid of Object.keys(ACP_PROVIDERS)) {
    const isDisabledEffectiveProvider =
      pid === normalizedEffectiveProviderId && !normalizedEnabledProviderIds.has(pid);
    if (!normalizedEnabledProviderIds.has(pid) && !isDisabledEffectiveProvider) continue;
    const models =
      allProviderModels[pid] ??
      (isDisabledEffectiveProvider ? toDropdownOptions(availableModels) : undefined);
    if (models && models.length > 0) {
      const providerConfig = getProviderConfig(pid);
      groups.push({
        key: pid,
        label: providerConfig.displayName,
        options: models,
      });
    } else if (allProviderLoading[pid]) {
      const providerConfig = getProviderConfig(pid);
      groups.push({
        key: pid,
        label: providerConfig.displayName,
        options: [
          {
            value: `provider-loading:${pid}`,
            label: `Loading ${providerConfig.displayName} models…`,
            disabled: true,
            class: 'cursor-default disabled:opacity-100',
            data: { providerLoading: true },
          },
        ],
      });
    } else if (allProviderErrors[pid]) {
      const error = allProviderErrors[pid];
      groups.push({
        key: pid,
        label: error.providerName,
        options: [
          {
            value: `provider-error:${pid}`,
            label: error.displayText,
            description: error.hint,
            disabled: true,
            class: 'cursor-default disabled:opacity-100',
            data: { providerLoadError: error },
          },
        ],
      });
    } else if (allProviderWarnings[pid]) {
      // Enabled provider that legitimately returned zero models with a
      // daemon warning (PROTOCOL §5.30 degraded response) — surface the
      // warning as a disabled row instead of silently dropping the group.
      const warning = formatProviderLoadError(pid, allProviderWarnings[pid]);
      groups.push({
        key: pid,
        label: warning.providerName,
        options: [
          {
            value: `provider-warning:${pid}`,
            label: warning.displayText,
            description: warning.hint,
            disabled: true,
            class: 'cursor-default disabled:opacity-100',
            data: { providerLoadError: warning },
          },
        ],
      });
    }
  }

  return groups;
}