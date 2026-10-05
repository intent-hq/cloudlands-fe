/** Display labels only: never use this cache for availability or capabilities. */
export type LearnedModelNames = Record<string, Record<string, string>>;

export const MODEL_NAMES_STORAGE_KEY = 'intent.learnedModelNames';

function validKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value !== '__proto__' &&
    value !== 'constructor' &&
    value !== 'prototype'
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Versioned storage boundary. Ignore invalid entries and never retain metadata. */
export function readModelNames(value: unknown): LearnedModelNames {
  if (!record(value) || value.version !== 1 || !record(value.names)) return {};
  const names: LearnedModelNames = {};
  for (const [providerId, models] of Object.entries(value.names)) {
    if (!validKey(providerId) || !record(models)) continue;
    const labels = Object.fromEntries(
      Object.entries(models).filter(
        ([modelId, label]) =>
          validKey(modelId) && typeof label === 'string' && label.trim().length > 0,
      ),
    ) as Record<string, string>;
    if (Object.keys(labels).length) names[providerId] = labels;
  }
  return names;
}

/** Catalog IDs are bare and kept verbatim, including meaningful slashes/colons. */
export function learnModelNames(
  names: LearnedModelNames,
  providerId: string,
  models: readonly { value: string; label: string }[],
): LearnedModelNames {
  if (!validKey(providerId)) return names;
  const previous = Object.hasOwn(names, providerId) ? names[providerId] : {};
  let labels = previous;
  for (const { value, label } of models) {
    if (!validKey(value) || typeof label !== 'string' || !label.trim()) continue;
    if (Object.hasOwn(labels, value) && labels[value] === label) continue;
    if (labels === previous) labels = { ...previous };
    labels[value] = label;
  }
  return labels === previous ? names : { ...names, [providerId]: labels };
}

export function learnedModelName(
  names: LearnedModelNames,
  providerId: string,
  modelId: string,
): string | undefined {
  if (!validKey(providerId) || !validKey(modelId) || !Object.hasOwn(names, providerId)) return;
  const labels = names[providerId];
  return Object.hasOwn(labels, modelId) ? labels[modelId] : undefined;
}
