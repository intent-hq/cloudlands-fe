/**
 * Height ledger — scroll compensation for LazyTurn height changes.
 *
 * The chat scroll container disables native scroll anchoring
 * (overflow-anchor: none in ChatPanel — required to keep the pinned sticky row
 * from oscillating), so any height change of a turn ABOVE the reader's
 * viewport shifts the visible transcript unless scrollTop is compensated
 * manually. The v2.37.0 fix compensated one-shot at swap-flush time, which
 * missed late-settling content (remounted blocks, images, badges, text-wrap
 * differences vs the cached placeholder height) — each settle showed up as an
 * intermittent 20–30px jump at the top of the chat while scrolling through
 * history.
 *
 * The ledger tracks the turn's last accounted height. `account()` runs after
 * every placeholder<->content swap flush AND every ResizeObserver fire;
 * whoever runs first consumes the delta, so the two paths never
 * double-compensate. A delta is compensated iff the turn sat ENTIRELY above
 * the viewport before the change (pre-change bottom <= container top) —
 * content settling within or below the visible area must flow naturally and
 * never shift the scroller. Compensation preserves every turn's
 * viewport-relative position, so it cannot re-trigger IntersectionObserver
 * swaps or re-enter the sticky compaction feedback loop.
 *
 * Bottom-anchored clamp compensation: a shrink of a turn above the viewport
 * also shrinks scrollHeight, and when the reader sits within the shrink of
 * the maximum scroll position (the "phantom" range created by a stale
 * overestimated placeholder height), the browser natively clamps scrollTop at
 * flush time — before account() runs. Applying the raw delta on top of that
 * clamp double-compensates and yanks the viewport up; across a bulk swap this
 * cascades into the bottom-of-chat snap-back. The swap path therefore passes
 * a pre-flush ScrollerSnapshot so account() can preserve the reader's
 * distance-from-bottom through the clamp when they are near the bottom
 * (within one viewport of the max — where the tail, not the turn above, is
 * the visual anchor). Off the clamp the bottom-anchored target is identical
 * to the classic viewport-preserving shift, so behavior is unchanged there.
 * The ResizeObserver path has no pre-flush snapshot; there, a shrink that
 * left scrollTop pinned at the new max was already bottom-anchored by the
 * native clamp and is skipped (any residual error is < the delta and only
 * occurs when the reader was inside the phantom range).
 *
 * Caveat — concurrent same-frame changes: the pre-change bottom is
 * reconstructed as `rect.bottom - delta`, which assumes the only geometry
 * change since the last account() is this turn's own height change. When
 * several turns above the viewport change height in the same flush (bulk swap
 * after a scroll jump, container-width re-wrap), a turn accounted while other
 * turns' deltas are still uncompensated has its rect polluted by those pending
 * deltas, so the above/below classification is not exact near the boundary.
 * The compensation magnitude is always this turn's own delta (the ledger never
 * drifts), and each earlier account()'s scrollTop write progressively restores
 * the rects for later ones, so any error is boundary-local and self-limiting.
 * The bottom-anchored path composes even better: its target is derived from
 * the post-flush scrollHeight and the shared pre-flush distance, so same-flush
 * shrinks converge on one target idempotently instead of accumulating.
 */
export interface ScrollerSnapshot {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * Capture the scroller's geometry BEFORE a mutation flushes. The swap path
 * hands this to account() so it can tell how much of a shrink the native
 * scrollTop clamp already consumed at flush time.
 */
export function snapshotScroller(
  scroller: HTMLElement | null | undefined,
): ScrollerSnapshot | null {
  if (!scroller) return null;
  return {
    scrollTop: scroller.scrollTop,
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
  };
}

export interface HeightLedger {
  /**
   * Reconcile the element's current height against the ledger and shift the
   * scroller by the delta when the change happened entirely above the
   * viewport. Safe to call redundantly — a zero delta is a no-op.
   * `preChange` is the scroller geometry captured before the mutation
   * flushed; when provided, shrinks near the bottom preserve the reader's
   * distance-from-bottom through the native scrollTop clamp.
   */
  account(preChange?: ScrollerSnapshot | null): void;
}

export function createHeightLedger(
  getScroller: () => HTMLElement | null | undefined,
  getElement: () => HTMLElement | null | undefined,
): HeightLedger {
  let lastHeight: number | null = null;

  return {
    account(preChange?: ScrollerSnapshot | null) {
      const scroller = getScroller();
      const el = getElement();
      if (!scroller || !el || !el.isConnected) return;
      const newHeight = el.offsetHeight;
      if (lastHeight === null) {
        lastHeight = newHeight;
        return;
      }
      const delta = newHeight - lastHeight;
      lastHeight = newHeight;
      if (delta === 0) return;
      const scrollerTop = scroller.getBoundingClientRect().top;
      const bottomBeforeChange = el.getBoundingClientRect().bottom - delta;
      if (bottomBeforeChange > scrollerTop) return;

      if (delta < 0) {
        const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        if (preChange) {
          const preMaxScrollTop = Math.max(0, preChange.scrollHeight - preChange.clientHeight);
          const preDistanceFromBottom = Math.max(0, preMaxScrollTop - preChange.scrollTop);
          if (preDistanceFromBottom <= preChange.clientHeight) {
            // Near the bottom: anchor to the tail. Equals the classic shift
            // when the clamp didn't fire; absorbs it exactly when it did.
            scroller.scrollTop = Math.max(0, maxScrollTop - preDistanceFromBottom);
            return;
          }
        } else if (scroller.scrollTop >= maxScrollTop) {
          // No pre-flush snapshot (ResizeObserver path) and the shrink left
          // the scroller pinned at its new max: the native clamp already
          // bottom-anchored this change — re-applying the delta would yank
          // the viewport up (the snap-back).
          return;
        }
      }
      scroller.scrollTop += delta;
    },
  };
}
