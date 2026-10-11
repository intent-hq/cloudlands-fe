/**
 * React binding of the canonical picker projections. The read-runtime owner
 * supplies real snapshot-bound catalog/default reads; this module owns no Store.
 */
import type { DropdownGroup, DropdownOption } from '@/components/ui/dropdown';
import { buildGroupedModelOptions } from '$lib/components/chat/input/model-picker-group-projections';
import {
  findModelFallbackOption,
  isProviderDisabledInSettings,
  isProviderEnabled,
  isUserProviderSettled,
  normalizeModelIdForMatch,
} from '$lib/components/chat/input/model-picker-option-projections';
import {
  createProviderWarningNotice,
  formatProviderLoadError,
} from '$lib/components/chat/input/model-picker-provider-projections';
import type {
  BuildGroupedModelOptionsParams,
  FindModelFallbackOptionParams,
  IsUserProviderSettledParams,
  ModelPickerOption,
  ModelPickerProviderContext,
} from '$lib/components/chat/input/model-picker-projection-types';

export {
  collapseCodexEffortModels,
  filterDefaultPseudoOptions,
  isDefaultPseudoModelId,
  toDropdownOptions,
} from '$lib/components/chat/input/model-picker-option-projections';
export { AUGGIE_LEGACY_GROUP_KEY } from '$lib/components/chat/input/model-picker-group-projections';
export type {
  ModelPickerOptionInput,
  ModelPickerProviderContext,
  ProviderWarningNotice,
} from '$lib/components/chat/input/model-picker-projection-types';
export type { ProviderLoadError } from '$lib/components/chat/input/provider-load-error';

function toReactOption(option: ModelPickerOption): DropdownOption {
  // Preserve caller-supplied React callbacks/icons/classes. Only generated source
  // status rows carry `class`; no provider, model or selection policy lives here.
  if (option.class === undefined) return option;
  const { class: rowClass, ...rest } = option;
  return { ...rest, className: rowClass };
}

export interface ModelPickerProjectionInputs {
  /** Global registry order, names, errors and host-managed guidance in the source. */
  globalContext: ModelPickerProviderContext;
  /**
   * The selection's actual scope: explicit workspace registry/default when scoped,
   * global otherwise. Required separately: missing workspace reads must not silently
   * fall back to local provider settings. Rebind when the state snapshot changes.
   */
  selectionContext: ModelPickerProviderContext;
}

export function createModelPickerProjections({
  globalContext,
  selectionContext,
}: ModelPickerProjectionInputs) {
  return {
    buildGroupedModelOptions(
      params: BuildGroupedModelOptionsParams<DropdownOption>,
    ): DropdownGroup[] {
      return buildGroupedModelOptions(params, globalContext).map((group) => ({
        ...group,
        options: group.options.map(toReactOption),
      }));
    },
    formatProviderLoadError(providerId: string, error: unknown) {
      return formatProviderLoadError(providerId, error, globalContext);
    },
    createProviderWarningNotice(providerId: string, warning: string | undefined) {
      return createProviderWarningNotice(providerId, warning, globalContext);
    },
    isUserProviderSettled(params: IsUserProviderSettledParams): boolean {
      return isUserProviderSettled(params, selectionContext);
    },
    isProviderEnabled(enabledProviderIds: string[], providerId: string): boolean {
      return isProviderEnabled(enabledProviderIds, providerId, selectionContext);
    },
    isProviderDisabledInSettings(
      enabledProviders: Record<string, boolean>,
      providerId: string,
    ): boolean {
      return isProviderDisabledInSettings(enabledProviders, providerId, selectionContext);
    },
    normalizeModelIdForMatch(modelId: string, bareProviderId?: string): string {
      return normalizeModelIdForMatch(modelId, bareProviderId, selectionContext);
    },
    findModelFallbackOption(
      params: FindModelFallbackOptionParams<DropdownOption>,
    ): DropdownOption | undefined {
      const option = findModelFallbackOption(params, selectionContext);
      return option && toReactOption(option);
    },
  };
}
