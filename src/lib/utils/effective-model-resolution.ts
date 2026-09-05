/**
 * Submit-triple derivation for the workspace-creation path
 * (workspace creation shell).
 *
 * Default-model resolution is daemon-owned (single resolver, PROTOCOL §5.11):
 * clients send `model` only on an explicit user pick and display the
 * daemon-computed `resolvedModel`/`resolvedProvider` preview fields from
 * `specialist.get`/`specialist.list`. The former client-side tier/preference
 * fallback logic that lived here was removed with that change.
 */
import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';

/**
 * Normalize an explicit user-picked model into the submit triple legs — a
 * bare model id plus its provider — so FE intent and daemon spawn can never
 * diverge. This is the ONE sanctioned legacy boundary for the form: new picks
 * are already bare and paired with `selectedProvider`, while a persisted
 * pre-triple compound id (`provider:model`) is split here — a non-empty
 * prefix wins as the provider, an empty prefix like ':sonnet' falls back to
 * the form's selected provider. With no explicit model the daemon resolves
 * the default in `selectedProvider`'s context.
 */
export function resolveSubmitModelAndProvider(
  explicitModel: string | undefined,
  selectedProvider: string,
): { model: string | undefined; provider: string } {
  if (!explicitModel) return { model: undefined, provider: selectedProvider };
  const { providerId, modelId } = splitLegacyCompoundId(explicitModel);
  return { model: modelId || undefined, provider: providerId || selectedProvider };
}
