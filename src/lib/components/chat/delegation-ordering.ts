/**
 * Pure helpers for the delegation "Waiting for all" footer.
 *
 * Dependency-light by design (structural parameter types, no imports) so the
 * helpers can be shared between AgentSubscriptions.svelte and the per-group
 * DelegationGroupSection.svelte without dragging in slice types.
 */

/** Structural subset of `DelegationGroupStatus` the progress helpers need. */
export interface DelegationGroupProgressInput {
  expectedAgentIds: readonly string[];
  completedAgentIds: readonly string[];
  deletedAgentIds: readonly string[];
  delivered: boolean;
}

/**
 * Sorts still-working agents before finished ones while preserving the
 * existing relative order within each bucket (stable partition), so
 * same-status agents never jump around as siblings finish.
 */
export function sortWorkingAgentsFirst(
  agentIds: readonly string[],
  completedAgentIds: ReadonlySet<string>,
): string[] {
  const working: string[] = [];
  const finished: string[] = [];
  for (const id of agentIds) {
    (completedAgentIds.has(id) ? finished : working).push(id);
  }
  return [...working, ...finished];
}

/** Agents that have finished (completed or deleted) in one delegation group. */
export function groupDoneCount(group: DelegationGroupProgressInput): number {
  return group.completedAgentIds.length + group.deletedAgentIds.length;
}

/**
 * Whether a delegation group finished all expected agents but its aggregated
 * wake has not been delivered yet (the footer's per-group warning state).
 */
export function isGroupDeliveryPending(group: DelegationGroupProgressInput): boolean {
  const total = group.expectedAgentIds.length;
  return total > 0 && groupDoneCount(group) >= total && !group.delivered;
}
