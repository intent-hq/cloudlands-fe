/**
 * Pure helper producing a per-mount-stable shuffled order for the onboarding
 * provider catalog.
 *
 * The catalog selector returns a fresh array reference on every emission and
 * the catalog is fully re-hydrated on every daemon reconnect, so a naive
 * `shuffle(entries)` re-runs (and visibly reorders cards) far more than once
 * per mount. This helper keys the shuffle on the *set* of entry ids: while
 * the id set is unchanged, the cached shuffled id order is reused and the
 * **current** entry objects are mapped into it (fresh rows from re-hydration
 * are still rendered); only when ids are added or removed is a new shuffle
 * drawn.
 *
 * Inputs are plain values and the cache is caller-owned, so this stays a
 * dependency-light pure function suitable for unit testing.
 */
export interface StableShuffleCache {
  /** Canonical (sorted) id-set key the cached order was computed from. */
  key: string;
  /** Shuffled entry ids, in render order. */
  order: string[];
}

/** Fisher-Yates shuffle (returns a new array; input is not mutated). */
export function shuffleArray<T>(array: readonly T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Order `entries` by the cached shuffle when the id set matches `cache`,
 * otherwise draw a fresh shuffle. Returns the ordered **current** entry
 * objects plus the cache to carry into the next call.
 */
export function stableShuffleOrder<T extends { id: string }>(
  entries: readonly T[],
  cache: StableShuffleCache | null,
  shuffle: (ids: readonly string[]) => string[] = shuffleArray,
): { entries: T[]; cache: StableShuffleCache } {
  const ids = entries.map((entry) => entry.id);
  const key = [...ids].sort().join(',');
  const order = cache !== null && cache.key === key ? cache.order : shuffle(ids);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const ordered: T[] = [];
  for (const id of order) {
    const entry = byId.get(id);
    if (entry !== undefined) ordered.push(entry);
  }
  return { entries: ordered, cache: { key, order } };
}
