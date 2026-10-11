import { m } from '$shared/paraglide/messages.js';
import { formatProviderLoadError } from './model-picker-provider-projections';
import { filterDefaultPseudoOptions, toDropdownOptions } from './model-picker-option-projections';
import type {
  BuildGroupedModelOptionsParams,
  ModelPickerGroup,
  ModelPickerProviderContext,
} from './model-picker-projection-types';

export const AUGGIE_LEGACY_GROUP_KEY = 'auggie:legacy-models';

export function buildGroupedModelOptions(
  {
    showDefaultOption,
    useDefaultOption,
    effectiveProviderId,
    availableModels,
    availableModelsProviderId,
    enabledProviderIds,
    effectiveProviderDisabled = false,
    allProviderModels,
    allProviderLoading,
    allProviderErrors,
    allProviderWarnings,
  }: BuildGroupedModelOptionsParams,
  context: ModelPickerProviderContext,
): ModelPickerGroup[] {
  const groups: ModelPickerGroup[] = [];

  if (showDefaultOption) {
    groups.push({
      key: 'default',
      label: '',
      options: [useDefaultOption],
    });
  }

  const normalizedEnabledProviderIds = new Set(
    enabledProviderIds.map((pid) => context.normalizeProviderId(pid)),
  );
  // Keep the agent's current provider group visible while that provider is
  // merely unavailable (or a guest window cannot see the host's settings), so
  // the selected model isn't orphaned — unless it was explicitly disabled in
  // settings (see `effectiveProviderDisabled`).
  const normalizedEffectiveProviderId = context.normalizeProviderId(effectiveProviderId);
  // Settings win: `enabledProviderIds` also carries the active provider, which
  // can still name the disabled one until the daemon re-derives the default.
  if (effectiveProviderDisabled) normalizedEnabledProviderIds.delete(normalizedEffectiveProviderId);
  // Only use the shared catalog for the fallback group when it was actually
  // loaded for the effective provider (see availableModelsProviderId doc).
  const fallbackModelsMatchEffectiveProvider =
    availableModelsProviderId !== '' &&
    context.normalizeProviderId(availableModelsProviderId) === normalizedEffectiveProviderId;

  for (const pid of context.providerIds) {
    const isDisabledEffectiveProvider =
      !effectiveProviderDisabled &&
      pid === normalizedEffectiveProviderId &&
      !normalizedEnabledProviderIds.has(pid);
    if (!normalizedEnabledProviderIds.has(pid) && !isDisabledEffectiveProvider) continue;
    const rawModels =
      allProviderModels[pid] ??
      (isDisabledEffectiveProvider && fallbackModelsMatchEffectiveProvider
        ? toDropdownOptions(availableModels)
        : undefined);
    // Never list a `default` pseudo-row (older daemons can still serve one);
    // pseudo-rows are kept only when no real rows remain, so the group is
    // never empty (D1).
    const models = rawModels && filterDefaultPseudoOptions(rawModels);
    if (models && models.length > 0) {
      const displayName = context.resolveProviderEntry(pid)?.displayName ?? pid;
      if (pid === 'auggie') {
        const currentModels = models.filter((model) => model.data?.isLegacyModel !== true);
        const legacyModels = models.filter((model) => model.data?.isLegacyModel === true);
        if (currentModels.length > 0) {
          groups.push({ key: pid, label: displayName, options: currentModels });
        }
        if (legacyModels.length > 0) {
          groups.push({
            key: AUGGIE_LEGACY_GROUP_KEY,
            parentKey: pid,
            label: m.chat_modelPicker_legacyModels_label(),
            searchLabel: displayName,
            options: legacyModels,
          });
        }
      } else {
        groups.push({ key: pid, label: displayName, options: models });
      }
    } else if (allProviderLoading[pid]) {
      const displayName = context.resolveProviderEntry(pid)?.displayName ?? pid;
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
      const warning = formatProviderLoadError(pid, allProviderWarnings[pid], context);
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
