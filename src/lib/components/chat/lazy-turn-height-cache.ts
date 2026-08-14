/**
 * Width-validated LazyTurn height cache.
 *
 * Cached turn heights are only valid at the wrap width they were measured
 * at — a different width re-wraps text and turns every entry into an
 * over/underestimate, which is what fabricates phantom space at the bottom
 * of the chat (stale overestimated placeholders extending scrollHeight past
 * the real content). Each entry therefore carries its measurement width and
 * every read validates it, instead of clearing the cache on width change: a
 * per-scroller clear cannot see width changes that happen while no scroller
 * is mounted (panel remount — the global cache outlives any scroller
 * element), and breaks down when two panels sit at different stable widths
 * writing mixed-width entries into the one shared cache.
 *
 * Kept pure and dependency-free (except the globalThis-backed accessor) so
 * the validation rules are unit-testable (lazy-turn-height-cache.test.ts).
 */

export interface CachedTurnHeight {
  height: number;
  width: number;
}

export type TurnHeightCache = Map<string, CachedTurnHeight>;

/**
 * Widths within this tolerance are the same wrap width: zoom / display
 * scaling rounds contentRect widths by fractions of a pixel without moving
 * where text wraps.
 */
export const WIDTH_TOLERANCE_PX = 1;

/**
 * PERF: single module-level cache shared by every LazyTurn instance, using a
 * plain Map (NOT SvelteMap!) — SvelteMap causes O(n²) reactivity where any
 * turn's height update re-evaluates every LazyTurn's $derived.
 */
export function getTurnHeightCache(): TurnHeightCache {
  const g = globalThis as { __lazyTurnHeightWidthCache?: TurnHeightCache };
  return (g.__lazyTurnHeightWidthCache ??= new Map());
}

/**
 * Read a cached height, validated against the reader's wrap width.
 * `width === null` means the caller cannot know its width yet (component
 * init, before the DOM exists) — the entry is returned unvalidated and MUST
 * be re-validated once the width is measurable (LazyTurn does so onMount).
 */
export function readCachedHeight(
  cache: TurnHeightCache,
  turnKey: string,
  width: number | null,
): number | null {
  const entry = cache.get(turnKey);
  if (!entry) return null;
  if (width !== null && Math.abs(entry.width - width) > WIDTH_TOLERANCE_PX) return null;
  return entry.height;
}

/** Store a measured height together with the wrap width it was measured at. */
export function writeCachedHeight(
  cache: TurnHeightCache,
  turnKey: string,
  height: number,
  width: number,
): void {
  cache.set(turnKey, { height, width });
}
