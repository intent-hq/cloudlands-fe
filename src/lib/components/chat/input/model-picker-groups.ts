/** Svelte compatibility API; remove at Svelte picker retirement. */
import type { DropdownGroup, DropdownOption } from '$lib/components/ui/dropdown';
import type { BuildGroupedModelOptionsParams } from './model-picker-projection-types';
import { buildGroupedModelOptions as projectGroupedModelOptions } from './model-picker-group-projections';
import { getModelPickerProviderContext } from './model-picker-provider-context';

export { AUGGIE_LEGACY_GROUP_KEY } from './model-picker-group-projections';

export function buildGroupedModelOptions(
  params: BuildGroupedModelOptionsParams<DropdownOption>,
): DropdownGroup[] {
  // The source grouping policy uses the GLOBAL registry, even in workspace pickers.
  return projectGroupedModelOptions(params, getModelPickerProviderContext());
}
