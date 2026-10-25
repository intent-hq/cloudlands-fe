import type { MentionCandidate, MentionSystemConfig, MentionType } from './types';

/** Placeholder in a kind order marking where unlisted kinds rank. */
const OTHER_MENTION_KINDS = '*';

type MentionKindOrder = NonNullable<MentionSystemConfig['typeOrder']>;

/**
 * Section order of the chat `@` menu: results rank by kind first, then by
 * score. Kinds not listed rank at the `*` slot, so specialists always stay last.
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

function kindRank(type: MentionType, order: MentionKindOrder): number {
  const index = order.indexOf(type);
  if (index !== -1) return index;
  const otherIndex = order.indexOf(OTHER_MENTION_KINDS);
  return otherIndex !== -1 ? otherIndex : order.length;
}

/**
 * Sort candidates by kind rank, then by descending score. An empty order sorts
 * by score alone. Returns a new array; ties keep their input order.
 */
export function sortByKindThenScore(
  candidates: readonly MentionCandidate[],
  order: MentionKindOrder,
): MentionCandidate[] {
  return [...candidates].sort((a, b) => {
    if (order.length > 0) {
      const byKind = kindRank(a.type, order) - kindRank(b.type, order);
      if (byKind !== 0) return byKind;
    }
    return (b.score ?? 0) - (a.score ?? 0);
  });
}
