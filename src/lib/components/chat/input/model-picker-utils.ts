import type { AuggieModel } from '$features/auggie/auggie-models.client';
import type { DropdownOption } from '$lib/components/ui/dropdown';
import {
  getDefaultProviderId,
  getProviderConfig,
  parseCompoundModelId,
  resolvePreferredModel,
} from '$shared/config/provider-config';

interface ModelPickerOptionInput {
  value: string;
  label: string;
  description?: string;
  badges?: { color: string; label: string; variant?: string }[];
  costTier?: number;
  effortLevels?: string[];
  isDefault?: boolean;
}

function formatCostTier(tier: number | undefined): string | undefined {
  if (tier === 1) return '$';
  if (tier === 2) return '$$';
  if (tier === 3) return '$$$';
  return undefined;
}

export function toDropdownOptions(models: ModelPickerOptionInput[]): DropdownOption[] {
  return models.map((m) => ({
    value: m.value,
    label: m.label,
    description: m.description,
    data: {
      badges: m.badges,
      costTier: m.costTier,
      costTierLabel: formatCostTier(m.costTier),
      effortLevels: m.effortLevels,
      isDefault: m.isDefault,
    },
  }));
}

export interface IsUserProviderSettledParams {
  /** Models fetched for a disabled agent provider, or null while the fetch is pending. */
  agentProviderModels: AuggieModel[] | null;
  /** Error produced by the disabled agent-provider fetch, or null when none. */
  agentProviderError: string | null;
  /** Raw enabled provider ids; normalized internally through `getProviderConfig(id).id`. */
  enabledProviderIds: string[];
  /** Models per normalized provider id for the "all providers" view. */
  allProviderModels: Record<string, DropdownOption[]>;
  /** The model's provider id, already normalized through `getProviderConfig(id).id`. */
  modelProvider: string;
}

/**
 * Return true only when we're confident loading has settled for the user's
 * model provider, distinguishing a provider that transiently returned `[]`
 * (fetch in flight, network blip, slow provider) from one that has
 * definitively loaded models or errored out.
 *
 * Why this matters: the auto-fallback `$effect` in `ModelPicker.svelte`
 * dispatches `updateAgentSessionFields(agentId, { model })` when it thinks
 * the selected model has disappeared. That dispatch permanently overwrites
 * the persisted `session.model` — including across restarts. Without this
 * guard, a transient empty fetch during boot or a provider refresh looks
 * identical to "model gone" and would silently replace the user's picked
 * model (e.g. Sonnet 4.6 → GPT 5.4) in a way that survives reload.
 *
 * Settled means the enabled provider has successfully loaded at least one
 * model, or the disabled agent-provider fetch has produced a result or error.
 *
 * @param params.agentProviderModels - Models fetched for a disabled agent provider, or `null` while pending.
 * @param params.agentProviderError - Error from the disabled agent-provider fetch, or `null` when none.
 * @param params.enabledProviderIds - Raw enabled provider ids; normalized internally via `getProviderConfig(id).id`.
 * @param params.allProviderModels - Models per normalized provider id for the "all providers" view.
 * @param params.modelProvider - The model's provider id, already normalized through `getProviderConfig(id).id`.
 * @returns `true` only when the user's provider has definitively settled; `false` while still loading.
 */
export function isUserProviderSettled(params: IsUserProviderSettledParams): boolean {
  const {
    agentProviderModels,
    agentProviderError,
    enabledProviderIds,
    allProviderModels,
    modelProvider,
  } = params;

  const normalizedEnabledProviderIds = enabledProviderIds.map((pid) => getProviderConfig(pid).id);
  const providerEnabled = normalizedEnabledProviderIds.includes(modelProvider);
  if (!providerEnabled) return agentProviderModels !== null || agentProviderError !== null;
  return (allProviderModels[modelProvider]?.length ?? 0) > 0;
}

/**
 * Return true when `providerId` is present in `enabledProviderIds`, comparing
 * both sides after normalization through `getProviderConfig(id).id` so raw
 * aliases (e.g. `acp`) match their canonical provider id.
 */
export function isProviderEnabled(enabledProviderIds: string[], providerId: string): boolean {
  const normalizedId = getProviderConfig(providerId).id;
  return enabledProviderIds.some((pid) => getProviderConfig(pid).id === normalizedId);
}

/**
 * Normalize a model ID for equivalence comparison: strip the default-provider
 * prefix so `auggie:sonnet4.6` matches bare `sonnet4.6` (and vice versa) when
 * `auggie` is the default provider. Non-default-provider prefixes are preserved
 * so `opencode:foo` still only matches the compound form.
 */
export function normalizeModelIdForMatch(modelId: string): string {
  const prefix = `${getDefaultProviderId()}:`;
  return modelId.startsWith(prefix) ? modelId.slice(prefix.length) : modelId;
}

export interface FindModelFallbackOptionParams {
  /** Candidate dropdown options (may include the "use default" sentinel). */
  options: DropdownOption[];
  /** Sentinel value to exclude from candidates (the "use default" option). */
  excludeValue?: string;
  /** When set, only consider options belonging to this provider. */
  restrictToProvider?: string;
  /** Preference list of model ids tried first, in order. */
  preferredModels: readonly string[];
  /** The globally selected model, used as a tiebreaker before first-available. */
  globallySelectedModel?: string | null;
}

/**
 * Find the best fallback option: preference list → globally selected model →
 * first available.
 */
export function findModelFallbackOption(
  params: FindModelFallbackOptionParams,
): DropdownOption | undefined {
  const { options, excludeValue, restrictToProvider, preferredModels, globallySelectedModel } =
    params;
  let candidates = options.filter((opt) => opt.value !== excludeValue);

  if (restrictToProvider) {
    candidates = candidates.filter(
      (opt) => parseCompoundModelId(opt.value).providerId === restrictToProvider,
    );
  }

  const optionValues = candidates.map((opt) => opt.value);
  const preferredValue = resolvePreferredModel(preferredModels, optionValues);
  return preferredValue
    ? candidates.find((opt) => opt.value === preferredValue)
    : (candidates.find((opt) => opt.value === globallySelectedModel) ?? candidates[0]);
}
