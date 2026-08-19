export const LAZY_TURN_THRESHOLD = 10;
export const FORCE_VISIBLE_TURN_COUNT = 1;

export function shouldVirtualizeTurns(turnCount: number): boolean {
  return turnCount > LAZY_TURN_THRESHOLD;
}

export function isTurnInRecentWindow(globalIndex: number, totalTurns: number): boolean {
  return globalIndex >= Math.max(0, totalTurns - FORCE_VISIBLE_TURN_COUNT);
}

/**
 * True when the list grew without changing the newest row. The canonical
 * producer is the background older-history backfill after a truncated
 * snapshot (a pure prepend), but interior insertions match too: a
 * late-arriving row with an older timestamp that sorts mid-list, or the
 * near-simultaneous-send ordering repair placing the user's echo above an
 * assistant run. All of these must stay paint- and scroll-neutral — no
 * auto-scroll and no lazy-mode flip — so the broader match is intentional.
 * (Skipping the pending-send transition kick on the repair case is safe:
 * the matcher retries on its own interval until timeout.)
 */
export function isOlderHistoryPrepend(
  previousCount: number,
  previousNewestId: string | undefined,
  currentCount: number,
  currentNewestId: string | undefined,
): boolean {
  return (
    previousCount > 0 &&
    currentCount > previousCount &&
    currentNewestId !== undefined &&
    currentNewestId === previousNewestId
  );
}

export interface LazyModeTracker {
  count: number;
  newestId: string | undefined;
  mode: boolean;
}

export const INITIAL_LAZY_MODE_TRACKER: LazyModeTracker = {
  count: 0,
  newestId: undefined,
  mode: false,
};

/**
 * Advance the latched lazy-loading decision for a transcript update. The mode
 * follows `shouldVirtualizeTurns` except across an older-history prepend,
 * where flipping it on would rewrap every already-rendered turn in LazyTurn:
 * the prepend keeps the mode decided at reveal. The latch is best-effort — it
 * only sees observed transitions, so a prepend coalesced with an append (or a
 * newest-row dedup rename) recomputes from the threshold, failing open to the
 * pre-latch behavior. Holding the mode has a known deferred cost: a
 * sub-threshold reveal followed by a large backfill renders the whole
 * transcript unvirtualized until the next genuine append flips the mode and
 * rewraps non-recent turns in one pass (while the user is at the bottom).
 */
export function nextLazyMode(
  tracker: LazyModeTracker,
  currentCount: number,
  currentNewestId: string | undefined,
  turnCount: number,
): LazyModeTracker {
  const unchanged = currentCount === tracker.count && currentNewestId === tracker.newestId;
  const latch =
    unchanged ||
    isOlderHistoryPrepend(tracker.count, tracker.newestId, currentCount, currentNewestId);
  const mode = latch ? tracker.mode : shouldVirtualizeTurns(turnCount);
  return { count: currentCount, newestId: currentNewestId, mode };
}
