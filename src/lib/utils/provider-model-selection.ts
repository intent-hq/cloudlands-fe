import {
  getProviderConfig,
  isModelValidForProvider,
  resolvePreferredModel,
} from '$shared/config/provider-config';
import { MODEL_DEFAULTS } from '$shared/constants/agent-services';
import { getModelsForProvider } from '$store/renderer/slices/model/model-utils';

export interface CompatibleModelSelectionInput {
  providerId: string;
  availableModelValues: string[];
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
    label: getProviderConfig(providerId).displayName,
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

export async function resolveUsableProviderIds(providerIds: string[]): Promise<string[]> {
  const usableProviders = await Promise.all(
    providerIds.map(async (providerId) => {
      try {
        const models = await getModelsForProvider(providerId);
        return models.length > 0 ? providerId : null;
      } catch {
        return null;
      }
    }),
  );

  return usableProviders.filter((providerId): providerId is string => providerId !== null);
}

export function pickCompatibleModelForProvider({
  providerId,
  availableModelValues,
  currentModel,
  fallbackModel,
}: CompatibleModelSelectionInput): string | null {
  const preferredModel = resolvePreferredModel(MODEL_DEFAULTS.UI_MODEL_PREFERENCE, availableModelValues);
  const candidates = [currentModel, fallbackModel, preferredModel, availableModelValues[0]];

  for (const candidate of candidates) {
    if (
      candidate &&
      availableModelValues.includes(candidate) &&
      isModelValidForProvider(candidate, providerId)
    ) {
      return candidate;
    }
  }

  return null;
}

export async function resolveCompatibleModelForProvider(
  providerId: string,
  {
    currentModel,
    fallbackModel,
  }: {
    currentModel?: string;
    fallbackModel?: string;
  } = {},
): Promise<string | null> {
  let availableModels: Awaited<ReturnType<typeof getModelsForProvider>>;
  try {
    availableModels = await getModelsForProvider(providerId);
  } catch {
    return null;
  }

  return pickCompatibleModelForProvider({
    providerId,
    availableModelValues: availableModels.map((model) => model.value),
    currentModel,
    fallbackModel,
  });
}
