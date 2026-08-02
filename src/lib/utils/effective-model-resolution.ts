/**
 * Submit-provider derivation for the workspace-creation path
 * (CompactWorkspaceInitializer).
 *
 * Default-model resolution is daemon-owned (single resolver, PROTOCOL §5.11):
 * clients send `model` only on an explicit user pick and display the
 * daemon-computed `resolvedModel`/`resolvedProvider` preview fields from
 * `specialist.get`/`specialist.list`. The former client-side tier/preference
 * fallback logic that lived here was removed with that change.
 */
import { parseCompoundModelId } from '$shared/utils/compound-model-id';

/**
 * Derive the provider to submit alongside an explicit user-picked model so FE
 * intent and daemon spawn can never diverge. Mirrors the daemon's
 * resolve_provider_id precedence: a non-empty compound model prefix wins, and
 * with no explicit model (or an empty prefix like ':sonnet', which the daemon
 * also filters) the form's selected provider is kept. Note the daemon resolves
 * a bare model id to the submitted provider field — it is this function that
 * pre-resolves the provider field for bare ids (parseCompoundModelId maps them
 * to the default provider), so FE intent and daemon spawn agree on the default
 * provider for bare model ids.
 */
export function resolveSubmitProvider(
  resolvedModel: string | undefined,
  selectedProvider: string,
  defaultProviderId: string,
): string {
  if (!resolvedModel) return selectedProvider;
  return parseCompoundModelId(resolvedModel, defaultProviderId).providerId || selectedProvider;
}
