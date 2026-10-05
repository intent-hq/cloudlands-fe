import { splitLegacyCompoundId } from './legacy-model-id';

/** Only unwrap a legacy prefix belonging to this provider; colons can be part of a bare ID. */
export function modelIdForDisplay(
  modelId: string,
  providerId: string,
  normalizeProvider: (id: string) => string,
): string {
  const split = splitLegacyCompoundId(modelId);
  return split.providerId && normalizeProvider(split.providerId) === providerId
    ? split.modelId
    : modelId;
}

/** Exact identities win. Only recognized legacy effort suffixes fall back to a base label. */
export function resolveModelDisplayName(
  modelId: string,
  lookup: (id: string) => string | undefined,
): string | undefined {
  const exact = lookup(modelId);
  if (exact) return exact;
  const match = /\/(low|medium|high|xhigh|max|ultra|none)$/i.exec(modelId);
  if (!match || match.index === 0) return undefined;
  const label = lookup(modelId.slice(0, match.index));
  const effort = match[1].toLowerCase();
  return label ? `${label} (${effort.charAt(0).toUpperCase()}${effort.slice(1)})` : undefined;
}
