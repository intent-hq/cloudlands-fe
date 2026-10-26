import type { MentionCandidate, MentionSystemConfig, MentionType } from './types';

/** Placeholder in a kind order marking where unlisted kinds rank. */
const OTHER_MENTION_KINDS = '*';

type MentionKindOrder = NonNullable<MentionSystemConfig['typeOrder']>;

/**
 * Section order of every `@` menu backed by `MentionSystem`: results rank by
 * kind first, then by score. Kinds not listed rank at the `*` slot, so
 * specialists always stay last.
 */
export const MENTION_KIND_ORDER: MentionKindOrder = [
  'member',
  'note',
  'agent',
  'file',
  'folder',
  'script',
  'terminal',
  OTHER_MENTION_KINDS,
  'specialist',
];

/**
 * Sort candidates by kind rank, then by descending score. An empty order sorts
 * by score alone. Returns a new array; ties keep their input order.
 */
export function sortByKindThenScore(
  candidates: readonly MentionCandidate[],
  order: MentionKindOrder,
): MentionCandidate[] {
  if (order.length === 0) {
    return [...candidates].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }
  const ranks = new Map(order.map((kind, index) => [kind, index]));
  const unlistedRank = ranks.get(OTHER_MENTION_KINDS) ?? order.length;
  return candidates
    .map((candidate) => ({ candidate, rank: ranks.get(candidate.type) ?? unlistedRank }))
    .sort((a, b) => a.rank - b.rank || (b.candidate.score ?? 0) - (a.candidate.score ?? 0))
    .map(({ candidate }) => candidate);
}

/**
 * Keep at most `perKind` candidates of each kind, preserving order. Used
 * instead of one global cap under kind ordering, where a global cap would drop
 * whole late-ranked kinds (terminals, specialists) from the tail.
 */
export function capPerKind(
  candidates: readonly MentionCandidate[],
  perKind: number,
): MentionCandidate[] {
  const counts = new Map<MentionType, number>();
  return candidates.filter((candidate) => {
    const count = counts.get(candidate.type) ?? 0;
    counts.set(candidate.type, count + 1);
    return count < perKind;
  });
}
