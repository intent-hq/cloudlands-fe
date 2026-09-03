import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';

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
 * Rehydrate-boundary splitter for a provider→model map: legacy persisted
 * values may still carry a `provider:model` compound shape, so each value is
 * split leniently down to its bare model id. The map key is the provider —
 * a compound prefix inside a value is legacy noise and is dropped. In-store
 * values are always bare; this is the only place compound values enter.
 */
export function toBareProviderModels(models: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(models).map(([providerId, model]) => [
      providerId,
      splitLegacyCompoundId(model).modelId,
    ]),
  );
}
