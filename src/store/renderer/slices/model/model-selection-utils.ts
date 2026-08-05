import { splitCompoundModelId } from "$shared/utils/compound-model-id";

/**
 * Resolve the default model from a provider's catalog rows: the row the
 * provider CLI marks `isDefault`, else the first row. Empty list → `''`
 * (no selection — never a fabricated model id).
 */
export function resolveDefaultModel(
  models: readonly { value: string; isDefault?: boolean }[],
): string {
  return (models.find((m) => m.isDefault) ?? models[0])?.value ?? '';
}

/**
 * Normalize a model id for storage under `providerId`: bare iff the provider
 * is the registry default, `provider:model` otherwise. `defaultProviderId`
 * comes from the providerCatalog hydration (threaded by the model slice).
 */
export function normalizeModelForProvider(
  providerId: string,
  model: string,
  defaultProviderId: string,
): string {
  const { modelId } = splitCompoundModelId(model);

  if (providerId === defaultProviderId) {
    return modelId;
  }

  return `${providerId}:${modelId}`;
}

export function normalizeProviderModels(
  models: Record<string, string>,
  defaultProviderId: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(models).map(([providerId, model]) => [
      providerId,
      normalizeModelForProvider(providerId, model, defaultProviderId),
    ])
  );
}

export function findAvailableModelMatch(
  availableValues: string[],
  providerId: string,
  model: string,
  defaultProviderId: string,
): string | undefined {
  const normalizedModel = normalizeModelForProvider(providerId, model, defaultProviderId);
  if (availableValues.includes(normalizedModel)) {
    return normalizedModel;
  }

  const { modelId: targetModelId } = splitCompoundModelId(normalizedModel);

  return availableValues.find((availableValue) => {
    const { modelId } = splitCompoundModelId(availableValue);
    return availableValue === targetModelId || modelId === targetModelId;
  });
}

