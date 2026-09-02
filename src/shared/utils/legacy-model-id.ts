/**
 * Legacy compound model id rehydration — the ONLY place the retired
 * `provider:model` compound format is still understood.
 *
 * The FE represents models as a triple (`ModelTriple` in
 * `$shared/types/model-triple`) and the daemon rejects compound ids on the
 * wire; this lenient splitter exists solely so persisted FE state written
 * before the migration (localStorage picker state, store rehydration
 * payloads, settings echoes) keeps rehydrating. Do not use it on new data
 * paths — thread provider and bare model separately instead.
 *
 * `providerId` is `undefined` for bare ids (no `:`); a malformed id with an
 * empty prefix (`:model`) yields an empty-string providerId, matching the
 * legacy parse. Callers falling back to another provider should use
 * `|| fallback` (not `??`) so the empty string never propagates as a "real"
 * provider id.
 */
export function splitLegacyCompoundId(legacyModelId: string): {
  providerId?: string;
  modelId: string;
} {
  if (legacyModelId.includes(':')) {
    const [providerId, ...modelParts] = legacyModelId.split(':');
    return { providerId, modelId: modelParts.join(':') };
  }
  return { modelId: legacyModelId };
}
