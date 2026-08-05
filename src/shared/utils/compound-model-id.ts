/**
 * Compound model id utilities — pure string helpers with no catalog
 * dependency, shared by main and renderer.
 *
 * Compound format: `{providerId}:{modelId}` (e.g. `opencode:claude-sonnet-4`).
 * Bare ids belong to the default provider; the daemon's registry owns the
 * default (`providers.catalog`, PROTOCOL §5.38), so callers thread
 * `defaultProviderId` in explicitly instead of this module hardcoding it.
 */

/**
 * Split a compound model id into its raw parts. `providerId` is `undefined`
 * for bare ids (no `:`); a malformed id with an empty prefix (`:model`)
 * yields an empty-string providerId, matching the legacy parse. Callers
 * falling back to another provider should use `|| fallback` (not `??`) so
 * the empty string never propagates as a "real" provider id.
 */
export function splitCompoundModelId(compoundModelId: string): {
  providerId?: string;
  modelId: string;
} {
  if (compoundModelId.includes(':')) {
    const [providerId, ...modelParts] = compoundModelId.split(':');
    return { providerId, modelId: modelParts.join(':') };
  }
  return { modelId: compoundModelId };
}

/**
 * Parse a compound model id into provider and model parts, attributing bare
 * ids to `defaultProviderId` (backwards-compatible with pre-catalog parsing).
 */
export function parseCompoundModelId(
  compoundModelId: string,
  defaultProviderId: string,
): { providerId: string; modelId: string } {
  const { providerId, modelId } = splitCompoundModelId(compoundModelId);
  return { providerId: providerId ?? defaultProviderId, modelId };
}

/**
 * Check if a model id (compound or bare) is compatible with a target
 * provider. Bare ids belong to `defaultProviderId`; compound ids belong to
 * their explicit prefix provider.
 */
export function isModelValidForProvider(
  model: string,
  targetProviderId: string,
  defaultProviderId: string,
): boolean {
  return parseCompoundModelId(model, defaultProviderId).providerId === targetProviderId;
}

