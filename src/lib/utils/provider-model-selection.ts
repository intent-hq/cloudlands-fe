import { resolveDefaultModel } from '$store/renderer/slices/model/model-selection-utils';
import {
  selectIsModelValidForProvider,
  selectProviderDisplayName,
} from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { store as appStore } from '$store/renderer/store';

export interface CompatibleModelSelectionInput {
  providerId: string;
  availableModels: { value: string; isDefault?: boolean }[];
  currentModel?: string;
  fallbackModel?: string;
}

export interface SelectableProviderIdsInput {
  enabledProviderIds: string[];
  usableProviderIds: string[];
  selectedProviderId?: string;
}

export interface ChatProviderControlVisibilityInput {
  defaultProviderId: string;
  selectableProviderIds: string[];
  selectedProviderId?: string;
}

export function buildProviderDropdownOptions(providerIds: string[]) {
  return providerIds.map((providerId) => ({
    value: providerId,
    label: selectProviderDisplayName.select(appStore.state, providerId),
  }));
}

export function getSelectableProviderIds({
  enabledProviderIds,
  usableProviderIds,
  selectedProviderId,
}: SelectableProviderIdsInput): string[] {
  const usableSet = new Set(usableProviderIds);
  const filteredProviderIds = enabledProviderIds.filter((providerId) => usableSet.has(providerId));
  const providerIds = selectedProviderId
    ? [selectedProviderId, ...filteredProviderIds]
    : filteredProviderIds;

  return [...new Set(providerIds)];
}

export function shouldShowChatProviderControl({
  defaultProviderId,
  selectableProviderIds,
  selectedProviderId,
}: ChatProviderControlVisibilityInput): boolean {
  if (!selectedProviderId) {
    return false;
  }

  if (selectedProviderId !== defaultProviderId) {
    return true;
  }

  return selectableProviderIds.length > 1;
}

export function pickCompatibleModelForProvider({
  providerId,
  availableModels,
  currentModel,
  fallbackModel,
}: CompatibleModelSelectionInput): string | null {
  const availableModelValues = availableModels.map((model) => model.value);
  const defaultModel = resolveDefaultModel(availableModels);
  const candidates = [currentModel, fallbackModel, defaultModel];

  for (const candidate of candidates) {
    if (
      candidate &&
      availableModelValues.includes(candidate) &&
      selectIsModelValidForProvider.select(appStore.state, candidate, providerId)
    ) {
      return candidate;
    }
  }

  return null;
}
