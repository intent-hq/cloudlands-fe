/**
 * Height ledger — scroll compensation for LazyTurn height changes.
 *
 * When native scroll anchoring is unavailable, a height change of a turn ABOVE
 * the reader's viewport shifts the visible transcript unless scrollTop is
 * compensated manually. The follow action enables native anchoring while an
 * unlocked reader is active and this ledger yields to it. The v2.37.0 fix
 * compensated one-shot at swap-flush time, which
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
 * the visual anchor). The bottom-anchored ABSOLUTE write is gated on the
 * clamp actually having fired (clampShift < 0): for a stationary reader it
 * would equal the classic shift off the clamp too, but during streaming
 * scrollTop routinely moves between the snapshot and account() (user
 * wheel-down chasing the bottom, the followBottom pin) and other content in
 * the same flush changes scrollHeight (the growing tail), and the absolute
 * restore discards both — rewinding the user's scroll just as they reach
 * the bottom (the streaming scroll bounce) or dragging a detached reader
 * toward the new bottom. Off the clamp the classic RELATIVE shift applies
 * instead: it composes with concurrent movement and compensates only this
 * turn's own delta.
 * The ResizeObserver path has no pre-flush snapshot; there, a shrink that
 * left scrollTop pinned at the new max is ambiguous: the reader was either
 * inside the phantom range (the clamp already bottom-anchored them — the
 * delta must NOT be re-applied) or within |delta| of a REAL bottom (the
 * clamp ate their remaining distance). The two are indistinguishable without
 * the pre-change scrollTop, so the ledger skips: the reader near a real
 * bottom ends pinned at the bottom, an error of at most their lost distance
 * (< |delta|, and RO-path settles are small), whereas re-applying the delta
 * would yank phantom-range readers up by the FULL delta — the very snap-back
 * this exists to prevent. The pinned check carries a 1px tolerance because
 * scrollHeight/clientHeight are integer-rounded while scrollTop is a
 * fractional double: at non-integer zoom a natively clamped scroller reads
 * e.g. scrollTop 1699.33 against a computed max of 1700.
 *
 * Caveat — concurrent same-frame changes: the pre-change bottom is
 * reconstructed as `rect.bottom - delta`, corrected by the native clamp's
 * scrollTop movement (without that correction a partial clamp shifts the
 * rect down and can misclassify an above-viewport turn as visible). The
 * clamp shift is derived from geometry — min(0, postMax - preScrollTop) —
 * NOT from the observed scrollTop, because in a same-flush bulk swap the
 * current scrollTop already includes sibling ledgers' compensation writes
 * (those shift rect and scrollTop together and cancel out of the
 * reconstruction). The reconstruction still assumes no OTHER turn's
 * geometry changed since the last account(). When several turns above the
 * viewport change height in the same flush (bulk swap after a scroll jump,
 * container-width re-wrap), a turn accounted while other turns' deltas are
 * still uncompensated has its rect polluted by those pending deltas, so the
 * above/below classification is not exact near the boundary. The
 * compensation magnitude is always this turn's own delta (the ledger never
 * drifts), and each earlier account()'s relative scrollTop write
 * progressively restores the rects for later ones, so any error is
 * boundary-local and self-limiting. Composition properties: the classic
 * path uses RELATIVE writes, so same-flush bulk growths and no-clamp
 * shrinks sum exactly; when a clamp DID fire on the classic path (total
 * shrink exceeding a more-than-a-viewport distance from the bottom), each
 * participating ledger subtracts the flush's clamp shift once, so a bulk
 * clamped classic shrink over-corrects by up to (n-1)·clampShift — bounded,
 * and far rarer than the bulk swaps the relative form protects. Same-flush
 * bulk SHRINKS compose idempotently on the bottom-anchored path — every
 * ledger sharing the pre-flush snapshot derives the same absolute target
 * from the post-flush scrollHeight — but a GROWTH landing in the same flush
 * composes additively on top of that absolute target (the target's
 * post-flush scrollHeight already includes the growth, then the growth's
 * own account() applies += delta again), double-counting it by up to that
 * delta. Like the rect pollution above this is bounded and boundary-local,
 * and it requires a simultaneous under- and overestimated placeholder pair
 * near the bottom.
 */
import { isFollowingBottom, isNativeScrollAnchoringActive } from '$lib/utils/smartScroll';

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
  /** Coalesce observer/swap reconciliation with other ledgers in the next frame. */
  request(preChange?: ScrollerSnapshot | null): void;
  /** Drop any queued reconciliation for a turn that is being unmounted. */
  cancel(): void;
}

interface CompensationPlan {
  scroller: HTMLElement;
  scrollTop: number;
  kind: 'relative' | 'absolute';
  value: number;
}

interface QueuedLedger {
  measureQueued(): CompensationPlan | null;
}

const queuedLedgers = new Set<QueuedLedger>();
let ledgerBatchFrame: number | null = null;

function applyCompensationPlans(plans: CompensationPlan[]) {
  const initialByScroller = new Map<HTMLElement, number>();
  const nextByScroller = new Map<HTMLElement, number>();
  for (const plan of plans) {
    if (!initialByScroller.has(plan.scroller)) {
      initialByScroller.set(plan.scroller, plan.scrollTop);
      nextByScroller.set(plan.scroller, plan.scrollTop);
    }
    const current = nextByScroller.get(plan.scroller) ?? plan.scrollTop;
    nextByScroller.set(plan.scroller, plan.kind === 'absolute' ? plan.value : current + plan.value);
  }
  for (const [scroller, next] of nextByScroller) {
    if (next !== initialByScroller.get(scroller)) scroller.scrollTop = next;
  }
}

function flushLedgerBatch() {
  ledgerBatchFrame = null;
  const batch = [...queuedLedgers];
  queuedLedgers.clear();
  const plans = batch.map((ledger) => ledger.measureQueued()).filter((plan) => plan !== null);
  applyCompensationPlans(plans);
}

function scheduleLedgerBatch() {
  if (ledgerBatchFrame !== null) return;
  // The sentinel also makes synchronous test RAF shims safe.
  ledgerBatchFrame = -1;
  const frame = requestAnimationFrame(flushLedgerBatch);
  if (ledgerBatchFrame !== null) ledgerBatchFrame = frame;
}

export function createHeightLedger(
  getScroller: () => HTMLElement | null | undefined,
  getElement: () => HTMLElement | null | undefined,
): HeightLedger {
  let lastHeight: number | null = null;
  let queued = false;
  let queuedPreChange: ScrollerSnapshot | null = null;

  function measure(preChange?: ScrollerSnapshot | null): CompensationPlan | null {
    const scroller = getScroller();
    const el = getElement();
    if (!scroller || !el || !el.isConnected) return null;
    const newHeight = el.offsetHeight;
    if (lastHeight === null) {
      lastHeight = newHeight;
      return null;
    }
    const delta = newHeight - lastHeight;
    lastHeight = newHeight;
    if (delta === 0) return null;
    // Keep the baseline current, but never compete with either scroll
    // authority: followBottom owns the locked bottom and the browser owns
    // the visible reading anchor while native anchoring is active.
    if (isFollowingBottom(scroller) || isNativeScrollAnchoringActive(scroller)) return null;
    const scrollTop = scroller.scrollTop;
    const scrollerTop = scroller.getBoundingClientRect().top;
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    // How far the native clamp moved scrollTop at flush time: it fires
    // exactly when the post-flush max fell below the pre-flush scrollTop.
    // Derived from geometry — NOT from the current scrollTop, which in a
    // same-flush bulk swap already includes sibling ledgers' compensation
    // writes (sibling deltas shift the rect and scrollTop together, so
    // they cancel out of the reconstruction below; the clamp's movement
    // is the only part that must be corrected explicitly).
    const clampShift = preChange ? Math.min(0, maxScrollTop - preChange.scrollTop) : 0;
    // The element rect reflects the current scrollTop; the clamp's
    // movement shifted it down by |clampShift|. Undo that so the
    // pre-change bottom is reconstructed at the pre-change scroll
    // position — otherwise a partial clamp can misclassify an
    // above-viewport turn as visible, skipping compensation entirely.
    const bottomBeforeChange = el.getBoundingClientRect().bottom - delta + clampShift;
    if (bottomBeforeChange > scrollerTop) return null;

    if (delta < 0) {
      if (preChange && clampShift < 0) {
        const preMaxScrollTop = Math.max(0, preChange.scrollHeight - preChange.clientHeight);
        const preDistanceFromBottom = Math.max(0, preMaxScrollTop - preChange.scrollTop);
        if (preDistanceFromBottom <= preChange.clientHeight) {
          return {
            scroller,
            scrollTop,
            kind: 'absolute',
            value: Math.max(0, maxScrollTop - preDistanceFromBottom),
          };
        }
      } else if (!preChange && scrollTop >= maxScrollTop - 1) {
        return null;
      }
    }
    return { scroller, scrollTop, kind: 'relative', value: delta - clampShift };
  }

  const queuedLedger: QueuedLedger = {
    measureQueued() {
      queued = false;
      const preChange = queuedPreChange;
      queuedPreChange = null;
      return measure(preChange);
    },
  };

  return {
    account(preChange?: ScrollerSnapshot | null) {
      const plan = measure(preChange);
      if (plan) applyCompensationPlans([plan]);
    },
    request(preChange?: ScrollerSnapshot | null) {
      if (preChange && queuedPreChange === null) queuedPreChange = preChange;
      if (queued) return;
      queued = true;
      queuedLedgers.add(queuedLedger);
      scheduleLedgerBatch();
    },
    cancel() {
      queued = false;
      queuedPreChange = null;
      queuedLedgers.delete(queuedLedger);
      if (queuedLedgers.size === 0 && ledgerBatchFrame !== null) {
        if (ledgerBatchFrame >= 0) cancelAnimationFrame(ledgerBatchFrame);
        ledgerBatchFrame = null;
      }
    },
  };
}
