/**
 * Pure ordering helper for the delegation "Waiting for all" list.
 *
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
