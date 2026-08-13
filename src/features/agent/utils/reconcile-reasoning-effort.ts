const REASONING_EFFORT_LADDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

const REASONING_EFFORT_RANK = new Map<string, number>(
  REASONING_EFFORT_LADDER.map((effort, rank) => [effort, rank]),
);

/**
 * Reconcile a session's effort when its model changes.
 *
 * Keeps an advertised current effort. Otherwise, picks the closest advertised
 * level on the canonical ladder (preferring the lower level on a tie), or
 * clears to the provider default when no canonical fallback exists.
 */
export function reconcileReasoningEffort(
  currentEffort: string | null | undefined,
  supportedEfforts: readonly string[] | null | undefined,
): string | null {
  if (!currentEffort || !supportedEfforts?.length) return null;
  if (supportedEfforts.includes(currentEffort)) return currentEffort;

  const currentRank = REASONING_EFFORT_RANK.get(currentEffort);
  if (currentRank === undefined) return null;

  let nearest: string | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const effort of REASONING_EFFORT_LADDER) {
    if (!supportedEfforts.includes(effort)) continue;
    const distance = Math.abs((REASONING_EFFORT_RANK.get(effort) ?? currentRank) - currentRank);
    if (distance < nearestDistance) {
      nearest = effort;
      nearestDistance = distance;
    }
  }

  return nearest;
}
