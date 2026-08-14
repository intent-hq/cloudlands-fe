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
 */
export interface HeightLedger {
  /**
   * Reconcile the element's current height against the ledger and shift the
   * scroller by the delta when the change happened entirely above the
   * viewport. Safe to call redundantly — a zero delta is a no-op.
   */
  account(): void;
}

export function createHeightLedger(
  getScroller: () => HTMLElement | null | undefined,
  getElement: () => HTMLElement | null | undefined,
): HeightLedger {
  let lastHeight: number | null = null;

  return {
    account() {
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
      if (bottomBeforeChange <= scrollerTop) {
        scroller.scrollTop += delta;
      }
    },
  };
}
