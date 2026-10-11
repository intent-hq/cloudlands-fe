/**
 * Compatibility API for Svelte picker callers until that renderer is retired.
 * Only this binding reads the legacy Store; both renderers share the projections.
 */
import type { AuggieModel } from '$features/auggie/auggie-models.client';
import type { DropdownOption } from '$lib/components/ui/dropdown';
import {
  findModelFallbackOption as projectModelFallbackOption,
  isProviderDisabledInSettings as projectProviderDisabledInSettings,
  isProviderEnabled as projectProviderEnabled,
  isUserProviderSettled as projectUserProviderSettled,
  normalizeModelIdForMatch as projectModelIdForMatch,
} from './model-picker-option-projections';
import type {
  FindModelFallbackOptionParams as FallbackParams,
  IsUserProviderSettledParams as SettledParams,
} from './model-picker-projection-types';
import { getModelPickerProviderContext } from './model-picker-provider-context';

export {
  collapseCodexEffortModels,
  filterDefaultPseudoOptions,
  isDefaultPseudoModelId,
  toDropdownOptions,
} from './model-picker-option-projections';
export type { ModelPickerOptionInput } from './model-picker-projection-types';

export interface IsUserProviderSettledParams extends SettledParams {
  workspaceId?: string;
  agentProviderModels: AuggieModel[] | null;
  allProviderModels: Record<string, DropdownOption[]>;
}

export function isUserProviderSettled(params: IsUserProviderSettledParams): boolean {
  return projectUserProviderSettled(params, getModelPickerProviderContext(params.workspaceId));
}

export function isProviderEnabled(
  enabledProviderIds: string[],
  providerId: string,
  workspaceId?: string,
): boolean {
  return projectProviderEnabled(
    enabledProviderIds,
    providerId,
    getModelPickerProviderContext(workspaceId),
  );
}

export function isProviderDisabledInSettings(
  enabledProviders: Record<string, boolean>,
  providerId: string,
  workspaceId?: string,
): boolean {
  return projectProviderDisabledInSettings(
    enabledProviders,
    providerId,
    getModelPickerProviderContext(workspaceId),
  );
}

export function normalizeModelIdForMatch(
  modelId: string,
  bareProviderId?: string,
  workspaceId?: string,
): string {
  return projectModelIdForMatch(
    modelId,
    bareProviderId,
    getModelPickerProviderContext(workspaceId),
  );
}

export interface FindModelFallbackOptionParams extends FallbackParams<DropdownOption> {
  workspaceId?: string;
  options: DropdownOption[];
}

export function findModelFallbackOption(
  params: FindModelFallbackOptionParams,
): DropdownOption | undefined {
  return projectModelFallbackOption(params, getModelPickerProviderContext(params.workspaceId));
}
