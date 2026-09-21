import type { AuggieModel } from '$features/auggie/auggie-models.client';
import type { DropdownOption } from '$lib/components/ui/dropdown';
import { splitLegacyCompoundId } from '$shared/utils/legacy-model-id';
import {
  selectEffectiveDefaultProviderId,
  selectNormalizedProviderId,
} from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
import { store as appStore } from '$store/renderer/store';

export interface ModelPickerOptionInput {
  value: string;
  label: string;
  description?: string;
  badges?: { color: string; label: string; variant?: string }[];
  costTier?: number;
  effortLevels?: string[];
  isDefault?: boolean;
  isLegacyModel?: boolean;
}

const CODEX_EFFORT_LADDER = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'none'];
const CODEX_EFFORTS = new Set(CODEX_EFFORT_LADDER);

function stripTrailingEffort(
  value: string,
  delimiters: [string, string][],
): {
  base: string;
  effort?: string;
} {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();

  for (const effort of CODEX_EFFORT_LADDER) {
    for (const [open, close] of delimiters) {
      const suffix = `${open}${effort}${close}`;
      if (lower.endsWith(suffix) && trimmed.length > suffix.length) {
        return { base: trimmed.slice(0, -suffix.length).trimEnd(), effort };
      }
    }
  }

  return { base: trimmed };
}

function orderedEffortUnion(levels: string[]): string[] {
  const normalized = new Map<string, string>();
  for (const level of levels) {
    const key = level.toLowerCase();
    if (!normalized.has(key)) normalized.set(key, CODEX_EFFORTS.has(key) ? key : level);
  }
  return [
    ...CODEX_EFFORT_LADDER.filter((level) => normalized.delete(level)),
    ...normalized.values(),
  ];
}

function descriptionHasEffortLevel(description: string): boolean {
  const words = description.toLowerCase().split(/[^a-z0-9]+/);
  return words.some((word) => CODEX_EFFORTS.has(word));
}

function preferredDescription(current?: string, candidate?: string): string | undefined {
  const currentText = current?.trim();
  const candidateText = candidate?.trim();
  if (!currentText) return candidateText || undefined;
  if (!candidateText) return currentText;

  const currentIsSpecific = descriptionHasEffortLevel(currentText);
  const candidateIsSpecific = descriptionHasEffortLevel(candidateText);
  if (currentIsSpecific !== candidateIsSpecific) {
    return candidateIsSpecific ? currentText : candidateText;
  }
  return candidateText.length > currentText.length ? candidateText : currentText;
}

export function collapseCodexEffortModels(
  models: ModelPickerOptionInput[],
): ModelPickerOptionInput[] {
  const collapsed: ModelPickerOptionInput[] = [];
  const groupIndexes = new Map<string, number>();

  for (const model of models) {
    const { providerId, modelId } = splitLegacyCompoundId(model.value);
    if (providerId?.toLowerCase() !== 'codex') {
      collapsed.push(model);
      continue;
    }

    const parsedId = stripTrailingEffort(modelId, [
      ['[', ']'],
      ['/', ''],
      [':', ''],
    ]);
    const parsedLabel = stripTrailingEffort(model.label, [['(', ')']]);
    const baseValue = `${providerId}:${parsedId.base}`;
    const key = `${providerId.toLowerCase()}:${parsedId.base.toLowerCase()}`;
    const levels = orderedEffortUnion([
      ...(model.effortLevels ?? []),
      ...(parsedId.effort ? [parsedId.effort] : []),
      ...(parsedLabel.effort ? [parsedLabel.effort] : []),
    ]);
    const existingIndex = groupIndexes.get(key);

    if (existingIndex === undefined) {
      groupIndexes.set(key, collapsed.length);
      collapsed.push({
        ...model,
        value: baseValue,
        label: parsedLabel.base || parsedId.base,
        effortLevels: levels.length > 0 ? levels : model.effortLevels,
      });
      continue;
    }

    const existing = collapsed[existingIndex];
    collapsed[existingIndex] = {
      ...existing,
      description: preferredDescription(existing.description, model.description),
      effortLevels: orderedEffortUnion([...(existing.effortLevels ?? []), ...levels]),
      isDefault: existing.isDefault || model.isDefault,
    };
  }

  return collapsed;
}

function formatCostTier(tier: number | undefined): string | undefined {
  if (tier === 1) return '$';
  if (tier === 2) return '$$';
  if (tier === 3) return '$$$';
  return undefined;
}

/**
 * True when a value's model-id part is the `default` pseudo-row id (bare
 * `default` or `<provider>:default`, case-insensitive). The daemon resolves
 * this pseudo-row away and marks the real row `isDefault`; older daemons can
 * still serve it, so the picker filters it defensively.
 */
export function isDefaultPseudoModelId(value: string): boolean {
  return splitLegacyCompoundId(value).modelId.toLowerCase() === 'default';
}

/**
 * Display-only filter: drop `default` pseudo-rows from a provider's option
 * list. Last resort (D1): pseudo-rows are kept only when no real rows remain
 * (all of them, in the degenerate case of several pseudo-rows), so a provider
 * group is never rendered empty — mirroring the daemon-side rule.
 */
export function filterDefaultPseudoOptions(options: DropdownOption[]): DropdownOption[] {
  const filtered = options.filter((opt) => !isDefaultPseudoModelId(opt.value));
  return filtered.length > 0 ? filtered : options;
}

export function toDropdownOptions(models: ModelPickerOptionInput[]): DropdownOption[] {
  return collapseCodexEffortModels(models).map((m) => ({
    value: m.value,
    label: m.label,
    description: m.description,
    data: {
      badges: m.badges,
      costTier: m.costTier,
      costTierLabel: formatCostTier(m.costTier),
      effortLevels: m.effortLevels,
      isDefault: m.isDefault,
      isLegacyModel: m.isLegacyModel,
    },
  }));
}

export interface IsUserProviderSettledParams {
  /** Models fetched for a disabled agent provider, or null while the fetch is pending. */
  agentProviderModels: AuggieModel[] | null;
  /** Error produced by the disabled agent-provider fetch, or null when none. */
  agentProviderError: string | null;
  /** Raw enabled provider ids; normalized internally through the catalog. */
  enabledProviderIds: string[];
  /** Models per normalized provider id for the "all providers" view. */
  allProviderModels: Record<string, DropdownOption[]>;
  /** The model's provider id, already normalized through the catalog. */
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
 * @param params.enabledProviderIds - Raw enabled provider ids; normalized internally via the catalog.
 * @param params.allProviderModels - Models per normalized provider id for the "all providers" view.
 * @param params.modelProvider - The model's provider id, already normalized through the catalog.
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

  const normalizedEnabledProviderIds = enabledProviderIds.map((pid) =>
    selectNormalizedProviderId.select(appStore.state, pid),
  );
  const providerEnabled = normalizedEnabledProviderIds.includes(modelProvider);
  if (!providerEnabled) return agentProviderModels !== null || agentProviderError !== null;
  return (allProviderModels[modelProvider]?.length ?? 0) > 0;
}

/**
 * Return true when `providerId` is present in `enabledProviderIds`, comparing
 * both sides after catalog normalization so raw aliases (e.g. `acp`) match
 * their canonical provider id.
 */
export function isProviderEnabled(enabledProviderIds: string[], providerId: string): boolean {
  const normalizedId = selectNormalizedProviderId.select(appStore.state, providerId);
  return enabledProviderIds.some(
    (pid) => selectNormalizedProviderId.select(appStore.state, pid) === normalizedId,
  );
}

/**
 * Normalize a model ID for equivalence comparison. Explicit compound ids use
 * their canonical provider; bare ids use the picker's effective provider when
 * supplied, then the global default. This keeps a valid bare session model
 * matched while the global default is unresolved without conflating models
 * from different providers.
 */
export function normalizeModelIdForMatch(modelId: string, bareProviderId?: string): string {
  const { providerId: explicitProviderId, modelId: baseModelId } = splitLegacyCompoundId(modelId);
  const defaultProviderId = selectEffectiveDefaultProviderId.select(appStore.state);
  const providerId = explicitProviderId || bareProviderId || defaultProviderId;
  if (!providerId) return baseModelId;
  const normalizedProviderId = selectNormalizedProviderId.select(appStore.state, providerId);
  return `${normalizedProviderId}:${baseModelId}`;
}

export interface FindModelFallbackOptionParams {
  /** Candidate dropdown options (may include the "use default" sentinel). */
  options: DropdownOption[];
  /** Sentinel value to exclude from candidates (the "use default" option). */
  excludeValue?: string;
  /** When set, only consider options belonging to this provider. */
  restrictToProvider?: string;
  /** The user's globally selected model — the top-priority fallback pick. */
  globallySelectedModel?: string | null;
}

/**
 * Find the best fallback option: the user's globally selected model →
 * the provider CLI's marked default → first available.
 *
 * The CLI-marked default is a *default*, not an override — the user's
 * explicitly configured global model outranks it (coordinator ruling on the
 * PR #759 review, recorded in the spec's Decisions section).
 *
 * `default` pseudo-rows are removed from the candidate list before the
 * precedence runs (so a globally selected `<provider>:default` degrades to
 * the isDefault find), and D1 here applies to the whole candidate list: a
 * pseudo-row survives only when it is the sole candidate overall, not merely
 * the sole row of its provider as in the rendered groups.
 */
export function findModelFallbackOption(
  params: FindModelFallbackOptionParams,
): DropdownOption | undefined {
  const { options, excludeValue, restrictToProvider, globallySelectedModel } = params;
  let candidates = options.filter((opt) => opt.value !== excludeValue);

  if (restrictToProvider) {
    const defaultProviderId = selectEffectiveDefaultProviderId.select(appStore.state);
    candidates = candidates.filter(
      (opt) =>
        (splitLegacyCompoundId(opt.value).providerId ?? defaultProviderId) === restrictToProvider,
    );
  }

  // Never fall back to a `default` pseudo-row that the picker hides from the
  // list — pseudo-rows are kept only when no real candidates remain (D1).
  candidates = filterDefaultPseudoOptions(candidates);

  return (
    candidates.find((opt) => opt.value === globallySelectedModel) ??
    candidates.find((opt) => opt.data?.isDefault) ??
    candidates[0]
  );
}
