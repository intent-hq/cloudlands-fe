/** Specialists remembered as recently used (New workspace, agent composer); the oldest drop first. */
export const MAX_RECENT_SPECIALISTS = 50;

/**
 * Record `specialistId` as the most recently used specialist. The list is
 * newest first, deduplicated, and capped at `MAX_RECENT_SPECIALISTS`. A null
 * or blank id (General) returns the list unchanged (same reference).
 */
export function rememberRecentSpecialist(
  recentIds: string[],
  specialistId: string | null | undefined,
): string[] {
  if (!specialistId) return recentIds;
  return [specialistId, ...recentIds.filter((id) => id !== specialistId)].slice(
    0,
    MAX_RECENT_SPECIALISTS,
  );
}

/** Merge a persisted list under in-session uses (which are newer), keeping the cap. */
export function mergeRecentSpecialists(
  persisted: readonly string[],
  session: readonly string[],
): string[] {
  return [...new Set([...session, ...persisted])].slice(0, MAX_RECENT_SPECIALISTS);
}

/** Read a persisted list, dropping malformed entries. */
export function readRecentSpecialists(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = value.filter((id): id is string => typeof id === 'string' && id.length > 0);
  return [...new Set(ids)].slice(0, MAX_RECENT_SPECIALISTS);
}

/**
 * Order `specialists` by recent use: used ones first (newest first), then the
 * never-used ones in their original order. Ids no longer in `specialists` are
 * ignored.
 */
export function sortSpecialistsByRecency<T extends { id: string }>(
  specialists: readonly T[],
  recentIds: readonly string[],
): T[] {
  const rank = new Map<string, number>();
  recentIds.forEach((id, index) => {
    if (!rank.has(id)) rank.set(id, index);
  });
  return specialists
    .map((specialist, index) => ({ specialist, index }))
    .sort((a, b) => {
      const rankA = rank.get(a.specialist.id) ?? Number.POSITIVE_INFINITY;
      const rankB = rank.get(b.specialist.id) ?? Number.POSITIVE_INFINITY;
      if (rankA !== rankB) return rankA - rankB;
      return a.index - b.index;
    })
    .map(({ specialist }) => specialist);
}
