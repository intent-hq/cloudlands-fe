export const LAZY_TURN_THRESHOLD = 10;
export const FORCE_VISIBLE_TURN_COUNT = 1;

export function shouldVirtualizeTurns(turnCount: number): boolean {
  return turnCount > LAZY_TURN_THRESHOLD;
}

export function isTurnInRecentWindow(globalIndex: number, totalTurns: number): boolean {
  return globalIndex >= Math.max(0, totalTurns - FORCE_VISIBLE_TURN_COUNT);
}

/**
 * True when a transcript change is purely a prepend of OLDER history: the
 * list grew but the newest row is unchanged (the background older-history
 * backfill after a truncated snapshot). Such changes must stay paint- and
 * scroll-neutral — no auto-scroll and no lazy-mode flip.
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
