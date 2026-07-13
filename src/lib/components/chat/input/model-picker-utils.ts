import type { AuggieModel } from '$features/auggie/auggie-models.client';
import type { DropdownOption } from '$lib/components/ui/dropdown';
import { getProviderConfig } from '$shared/config/provider-config';

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
  /** True when the agent's provider differs from the global active provider. */
  isAgentProviderOverride: boolean;
  /** Models fetched for the agent's provider, or null while the fetch is pending. */
  agentProviderModels: AuggieModel[] | null;
  /** Error produced by the agent-provider fetch, or null when none. */
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
 * Settled means one of:
 *   - override mode: the agent's provider fetch has produced a result
 *     (models or an explicit error).
 *   - non-override: the user's provider is either no longer enabled
 *     (genuinely gone) or has successfully loaded ≥1 model.
 *
 * @param params.isAgentProviderOverride - True when the agent's provider differs from the global active provider.
 * @param params.agentProviderModels - Models fetched for the agent's provider, or `null` while the fetch is pending.
 * @param params.agentProviderError - Error from the agent-provider fetch, or `null` when none.
 * @param params.enabledProviderIds - Raw enabled provider ids; normalized internally via `getProviderConfig(id).id`.
 * @param params.allProviderModels - Models per normalized provider id for the "all providers" view.
 * @param params.modelProvider - The model's provider id, already normalized through `getProviderConfig(id).id`.
 * @returns `true` only when the user's provider has definitively settled; `false` while still loading.
 */
export function isUserProviderSettled(params: IsUserProviderSettledParams): boolean {
  const {
    isAgentProviderOverride,
    agentProviderModels,
    agentProviderError,
    enabledProviderIds,
    allProviderModels,
    modelProvider,
  } = params;

  if (isAgentProviderOverride) {
    return agentProviderModels !== null || agentProviderError !== null;
  }
  const normalizedEnabledProviderIds = enabledProviderIds.map((pid) => getProviderConfig(pid).id);
  const providerEnabled = normalizedEnabledProviderIds.includes(modelProvider);
  if (!providerEnabled) return true;
  return (allProviderModels[modelProvider]?.length ?? 0) > 0;
}
