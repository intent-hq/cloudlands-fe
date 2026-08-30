// Keep normal conversations fully materialized. Virtualization has a larger
// payoff only after the transcript is long enough to offset placeholder swaps.
export const LAZY_TURN_THRESHOLD = 20;

// Turn count counts user messages, but the render/dehydration cost is carried
// by assistant messages. Assistant-heavy transcripts — Chief-of-staff threads
// especially, where one user turn spawns long tool/sub-agent runs — stay under
// the turn threshold while carrying far more render weight than a same-turn
// regular chat. Virtualize when the total message count crosses this bound too,
// so those threads engage lazy loading instead of materializing every row.
export const LAZY_MESSAGE_THRESHOLD = 40;

// Chief-of-staff threads are the most assistant-heavy surface and render inside
// the constrained sidebar, so they benefit from engaging virtualization much
// sooner than a full-panel chat. Callers pass this via `messageThreshold`.
export const CHIEF_LAZY_MESSAGE_THRESHOLD = 10;

// Keep a small tail mounted so streaming and short upward reads near the
// bottom do not cross the materialization boundary on every turn.
export const FORCE_VISIBLE_TURN_COUNT = 3;

// Placeholder estimate for unmeasured virtualized user rows. User prompts are
// typically a few lines, far below the default (assistant-sized) estimate;
// an oversized placeholder inflates the scroll extent on first paint.
export const USER_ROW_ESTIMATED_HEIGHT = 80;

export function shouldVirtualizeTurns(
  turnCount: number,
  messageCount = 0,
  messageThreshold = LAZY_MESSAGE_THRESHOLD,
): boolean {
  return turnCount > LAZY_TURN_THRESHOLD || messageCount > messageThreshold;
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
 *
 * `currentCount` is the total message count, which doubles as the message-count
 * virtualization signal (see `LAZY_MESSAGE_THRESHOLD`): an assistant-heavy
 * transcript virtualizes even when its user-turn count stays under the turn
 * threshold. `messageThreshold` lets a caller (Chief-of-staff) engage that
 * signal sooner; it defaults to the shared bound.
 */
export function nextLazyMode(
  tracker: LazyModeTracker,
  currentCount: number,
  currentNewestId: string | undefined,
  turnCount: number,
  messageThreshold = LAZY_MESSAGE_THRESHOLD,
): LazyModeTracker {
  const unchanged = currentCount === tracker.count && currentNewestId === tracker.newestId;
  const latch =
    unchanged ||
    isOlderHistoryPrepend(tracker.count, tracker.newestId, currentCount, currentNewestId);
  const mode = latch
    ? tracker.mode
    : shouldVirtualizeTurns(turnCount, currentCount, messageThreshold);
  return { count: currentCount, newestId: currentNewestId, mode };
}
