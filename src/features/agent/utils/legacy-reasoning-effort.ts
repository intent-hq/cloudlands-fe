export function buildLegacyReasoningEffortModelId(
  modelId: string | null | undefined,
  effort: string | null,
  advertisedEffortLevels: readonly string[] | null | undefined,
): string | null {
  if (!modelId || !advertisedEffortLevels?.length) return null;
  const effortLevels = new Set(advertisedEffortLevels);
  if (effort !== null && !effortLevels.has(effort)) return null;

  const slashIndex = modelId.lastIndexOf('/');
  const suffix = slashIndex >= 0 ? modelId.slice(slashIndex + 1) : '';
  const base = effortLevels.has(suffix) ? modelId.slice(0, slashIndex) : modelId;

  return effort === null ? base : `${base}/${effort}`;
}
