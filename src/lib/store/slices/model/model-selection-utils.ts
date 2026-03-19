import { MODEL_DEFAULTS } from "$shared/constants/agent-services";
import { getDefaultProviderId, parseCompoundModelId } from "$shared/config/provider-config";

const DEFAULT_PROVIDER_ID = getDefaultProviderId();

export function normalizeModelForProvider(providerId: string, model: string): string {
  const { modelId } = parseCompoundModelId(model);

  if (providerId === DEFAULT_PROVIDER_ID) {
    return modelId;
  }

  return `${providerId}:${modelId}`;
}

export function normalizeProviderModels(models: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(models).map(([providerId, model]) => [
      providerId,
      normalizeModelForProvider(providerId, model),
    ])
  );
}

export function findAvailableModelMatch(
  availableValues: string[],
  providerId: string,
  model: string
): string | undefined {
  const normalizedModel = normalizeModelForProvider(providerId, model);
  if (availableValues.includes(normalizedModel)) {
    return normalizedModel;
  }

  const { modelId: targetModelId } = parseCompoundModelId(normalizedModel);

  return availableValues.find((availableValue) => {
    const { modelId } = parseCompoundModelId(availableValue);
    return availableValue === targetModelId || modelId === targetModelId;
  });
}

export function resolvePreferredModelForProvider(
  availableValues: string[]
): string | undefined {
  for (const preferredModel of MODEL_DEFAULTS.UI_MODEL_PREFERENCE) {
    const match = availableValues.find((availableValue) => {
      const { modelId } = parseCompoundModelId(availableValue);
      return availableValue === preferredModel || modelId === preferredModel;
    });

    if (match) {
      return match;
    }
  }

  return availableValues[0];
}