/**
 * Wire `ModelInfo` (PROTOCOL §5.30 / §6.7) — the daemon's canonical model row
 * shape for `models.list`, shared by the renderer transport client and the
 * main-process IPC handlers.
 *
 * Wire-boundary rename: PROTOCOL documents `id` on the wire as the reference
 * FE's `shortName`/`value` and `name` as `displayName`/`label`. The FE keeps
 * the historical `value`/`label` names, so `wireModelToProviderModel` performs
 * the documented mapping — the FE never sees the wire names mixed with the
 * historical names elsewhere.
 */

export interface WireModelBadge {
  color: string;
  label: string;
  variant?: string;
}

/** Wire `ModelInfo` row as returned by `models.list`. */
export interface WireModelInfo {
  id?: string;
  name?: string;
  provider?: string;
  description?: string;
  modelGroupPriority?: number;
  costTier?: number;
  badges?: WireModelBadge[];
  effortLevels?: string[];
  isDefault?: boolean;
  priority?: number;
}

/** FE model row shape (historical `value`/`label` names). */
export interface ProviderModelInfo {
  value: string;
  label: string;
  description?: string;
  modelGroupPriority?: number;
  costTier?: number;
  badges?: WireModelBadge[];
  effortLevels?: string[];
  isDefault?: boolean;
  priority?: number;
}

/**
 * `models.list` response envelope (PROTOCOL §6.7). `providerId`, `stale`, and
 * `warning` are present only on the per-provider path / fallback branches.
 */
export interface WireModelsListResult {
  providerId?: string;
  models?: WireModelInfo[];
  source?: string;
  stale?: boolean;
  warning?: string;
}

/** Map a wire row to the FE model shape; `null` when key fields are missing. */
export function wireModelToProviderModel(wire: WireModelInfo): ProviderModelInfo | null {
  if (typeof wire?.id !== 'string' || !wire.id) return null;
  if (typeof wire?.name !== 'string' || !wire.name) return null;
  const model: ProviderModelInfo = { value: wire.id, label: wire.name };
  if (typeof wire.description === 'string') model.description = wire.description;
  if (typeof wire.modelGroupPriority === 'number') {
    model.modelGroupPriority = wire.modelGroupPriority;
  }
  if (typeof wire.costTier === 'number') model.costTier = wire.costTier;
  if (Array.isArray(wire.badges)) model.badges = wire.badges;
  if (Array.isArray(wire.effortLevels)) model.effortLevels = wire.effortLevels;
  if (wire.isDefault === true) model.isDefault = true;
  if (typeof wire.priority === 'number') model.priority = wire.priority;
  return model;
}

/** Map a `models.list` result's rows, dropping malformed entries. */
export function wireModelsToProviderModels(result: WireModelsListResult): ProviderModelInfo[] {
  if (!Array.isArray(result?.models)) return [];
  return result.models.flatMap((row) => wireModelToProviderModel(row) ?? []);
}

/** The curated claude-code `default` alias row (matches the daemon tier table's `smart` tier). */
export const CLAUDE_CODE_DEFAULT_MODEL: ProviderModelInfo = {
  value: 'default',
  label: 'Default (Claude Code)',
  description: 'Use Claude Code default model',
};

/**
 * STOPGAP (see cloudlands-fe PR #216 review, finding 1): the daemon's live
 * claude-code ACP parse does not inject the curated `default` alias — it only
 * appears in the daemon's static tier fallback. The pre-thin-client FE merged
 * it into live lists so `claude-code:default` (the `smart` tier) validated
 * and the picker kept its "Default" row. Merge it here at the shared wire
 * seam until intentd injects the alias in `fetch_claude_code_models`, at
 * which point this becomes a no-op and can be deleted.
 *
 * Only non-empty live lists are augmented: an empty list is an honest
 * "unavailable" terminal state whose warning semantics must be preserved.
 */
export function withProviderAliasRows(
  providerId: string,
  models: ProviderModelInfo[],
): ProviderModelInfo[] {
  if (providerId !== 'claude-code' || models.length === 0) return models;
  if (models.some((m) => m.value === CLAUDE_CODE_DEFAULT_MODEL.value)) return models;
  return [...models, CLAUDE_CODE_DEFAULT_MODEL];
}
