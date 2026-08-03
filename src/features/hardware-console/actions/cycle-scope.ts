/**
 * Per-family scope control for the global agent-cycle action keys: whether
 * a cycle family walks ALL agents (top-level + delegated sub-agents) or
 * top-level agents only.
 *
 * Only the status-filtered families are togglable. `cycle-unread-agents`
 * has no scope: unread tracking is top-level by nature (the
 * `newAssistantMessage` reducer in unread-tracking-slice gates out
 * background agents), so a sub-agent can never be unread.
 * `cycle-workspace-agents` keeps its fixed top-level walk.
 *
 * Persisted as the `cycleScopeByFamily` field of the shared
 * `hardwareConsole.state` daemon settings bag.
 *
 * Pure web code — no Electron imports, no store imports.
 */

import type { ActionKeyActionId } from './action-mapping';

/** The togglable cycle families, in catalog order. */
export const CYCLE_SCOPE_FAMILY_IDS = [
  'cycle-in-progress-agents',
  'cycle-attention-agents',
  'cycle-idle-agents',
  'cycle-failed-agents',
] as const satisfies readonly ActionKeyActionId[];

export type CycleScopeFamilyId = (typeof CYCLE_SCOPE_FAMILY_IDS)[number];

/** `all` = top-level + sub-agents; `top-level` = foreground agents only. */
export type CycleScope = 'all' | 'top-level';

/** Factory defaults: everything cycles sub-agents too, except idle. */
export const DEFAULT_CYCLE_SCOPES: Record<CycleScopeFamilyId, CycleScope> = {
  'cycle-in-progress-agents': 'all',
  'cycle-attention-agents': 'all',
  'cycle-idle-agents': 'top-level',
  'cycle-failed-agents': 'all',
};

export function isCycleScopeFamilyId(value: unknown): value is CycleScopeFamilyId {
  return (
    typeof value === 'string' && (CYCLE_SCOPE_FAMILY_IDS as readonly string[]).includes(value)
  );
}

function isCycleScope(value: unknown): value is CycleScope {
  return value === 'all' || value === 'top-level';
}

/**
 * Normalize an arbitrary persisted `cycleScopeByFamily` value to a complete
 * record: unknown/missing entries fall back to the family's default.
 */
export function normalizeCycleScopeByFamily(
  value: unknown,
): Record<CycleScopeFamilyId, CycleScope> {
  const record =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const result = {} as Record<CycleScopeFamilyId, CycleScope>;
  for (const familyId of CYCLE_SCOPE_FAMILY_IDS) {
    const entry = record[familyId];
    result[familyId] = isCycleScope(entry) ? entry : DEFAULT_CYCLE_SCOPES[familyId];
  }
  return result;
}
