import type { DropdownGroup, DropdownOption } from '$lib/components/ui/dropdown';
import {
  selectAllCatalogProviderIds,
  selectNormalizedProviderId,
  selectProviderDisplayName,
} from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { store as appStore } from '$store/renderer/store';
import { m } from '$shared/paraglide/messages.js';

import {
  formatProviderLoadError,
  type ProviderLoadError,
} from './model-picker-provider-errors';
import { toDropdownOptions } from './model-picker-utils';

type ModelPickerOptions = Parameters<typeof toDropdownOptions>[0];

interface BuildGroupedModelOptionsParams {
  showDefaultOption: boolean;
  useDefaultOption: DropdownOption;
  effectiveProviderId: string;
  availableModels: ModelPickerOptions;
  /**
   * Provider `availableModels` was actually loaded for ('' when unknown).
   * The disabled-effective-provider fallback group only renders those models
   * when this matches the effective provider — otherwise a stale catalog from
   * a previously active provider would show up under the wrong group label.
   */
  availableModelsProviderId: string;
  enabledProviderIds: string[];
  allProviderModels: Record<string, DropdownOption[]>;
  allProviderLoading: Record<string, boolean>;
  allProviderErrors: Record<string, ProviderLoadError>;
  allProviderWarnings: Record<string, string>;
}

export function buildGroupedModelOptions({
  showDefaultOption,
  useDefaultOption,
  effectiveProviderId,
  availableModels,
  availableModelsProviderId,
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

  const state = appStore.state;
  const normalizedEnabledProviderIds = new Set(
    enabledProviderIds.map((pid) => selectNormalizedProviderId.select(state, pid)),
  );
  // Keep the agent's current provider group visible even if that provider was
  // since disabled in settings, so the selected model isn't orphaned.
  const normalizedEffectiveProviderId = selectNormalizedProviderId.select(
    state,
    effectiveProviderId,
  );
  // Only use the shared catalog for the fallback group when it was actually
  // loaded for the effective provider (see availableModelsProviderId doc).
  const fallbackModelsMatchEffectiveProvider =
    availableModelsProviderId !== '' &&
    selectNormalizedProviderId.select(state, availableModelsProviderId) ===
      normalizedEffectiveProviderId;

  for (const pid of selectAllCatalogProviderIds.select(state)) {
    const isDisabledEffectiveProvider =
      pid === normalizedEffectiveProviderId && !normalizedEnabledProviderIds.has(pid);
    if (!normalizedEnabledProviderIds.has(pid) && !isDisabledEffectiveProvider) continue;
    const models =
      allProviderModels[pid] ??
      (isDisabledEffectiveProvider && fallbackModelsMatchEffectiveProvider
        ? toDropdownOptions(availableModels)
        : undefined);
    if (models && models.length > 0) {
      groups.push({
        key: pid,
        label: selectProviderDisplayName.select(state, pid),
        options: models,
      });
    } else if (allProviderLoading[pid]) {
      const displayName = selectProviderDisplayName.select(state, pid);
      groups.push({
        key: pid,
        label: displayName,
        options: [
          {
            value: `provider-loading:${pid}`,
            label: m.chat_modelPicker_loadingProviderModels_label({
              provider: displayName,
            }),
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