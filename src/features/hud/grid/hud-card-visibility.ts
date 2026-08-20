/**
 * Viewport gate for the HUD grid's per-workspace daemon reads.
 *
 * The grid renders one card per registered workspace and each card joins in a
 * `tasks` + `tokenUsage` rollup it has to ask the daemon for, so a profile with
 * ~130 workspaces used to put ~130 reads on the wire in a single tick. The
 * bounded read scheduler queues that fan-out; this gate stops most of it from
 * being issued at all — a card the user has not scrolled to asks for nothing.
 *
 * The observer is rooted at the grid's own scroll container, which it must be
 * for the preload margin to do anything: `IntersectionObserver` intersects the
 * target against every clipping ancestor *unexpanded* and applies `rootMargin`
 * only to the root's rectangle. Under the implicit (document) root the grid's
 * `overflow-y: auto` clip therefore discards a below-the-fold card before the
 * margin is ever consulted, and the preload silently never happens. Hence
 * `setRoot`: the observer is not created until the scroller is known, and
 * cards observed before then wait rather than being observed against the
 * wrong root.
 *
 * Where `IntersectionObserver` is missing (non-DOM environments) every
 * observed card is reported immediately, which is the pre-gate behaviour —
 * degrade to more reads, never to none.
 */

/**
 * How far outside the scroller a card counts as visible, so a card is already
 * loaded by the time a scroll brings it into view.
 */
export const CARD_VISIBILITY_ROOT_MARGIN = '200px 0px';

/** Svelte action return shape for {@link CardVisibilityGate.observe}. */
interface CardVisibilityHandle {
  update(workspaceId: string): void;
  destroy(): void;
}

export interface CardVisibilityGate {
  /**
   * Points the gate at the scroll container the cards live in. Until this is
   * called with an element, observed cards are held pending — they are never
   * measured against the document root, whose margin would not apply to them.
   * Passing a different element rebuilds the observer; passing `null` (the
   * scroller unmounted) tears it down.
   */
  setRoot(root: Element | null): void;
  /**
   * Svelte action for a card slot: reports the slot's workspace the first time
   * the slot enters the viewport, and on every re-entry after that (callers
   * that only want the first read dedupe on their side).
   */
  observe(node: HTMLElement, workspaceId: string): CardVisibilityHandle;
  /** Idempotent. Drops the observer and everything it watches. */
  destroy(): void;
}

export function createCardVisibilityGate(
  onVisible: (workspaceId: string) => void,
): CardVisibilityGate {
  const workspaceIds = new Map<Element, string>();
  /** Observed cards still waiting for a root (or for the fallback report). */
  const pending = new Set<Element>();
  let observer: IntersectionObserver | null = null;
  let root: Element | null = null;
  let destroyed = false;

  function report(node: Element): void {
    const workspaceId = workspaceIds.get(node);
    if (workspaceId) onVisible(workspaceId);
  }

  function flush(): void {
    if (destroyed || pending.size === 0) return;
    // No IntersectionObserver at all: fall back to reading every card.
    if (typeof IntersectionObserver === 'undefined') {
      for (const node of pending) report(node);
      pending.clear();
      return;
    }
    if (!observer) return;
    for (const node of pending) observer.observe(node);
    pending.clear();
  }

  return {
    setRoot(next: Element | null): void {
      if (destroyed || next === root) return;
      root = next;
      observer?.disconnect();
      observer = null;
      if (next && typeof IntersectionObserver !== 'undefined') {
        observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) report(entry.target);
            }
          },
          { root: next, rootMargin: CARD_VISIBILITY_ROOT_MARGIN },
        );
        // Everything already mounted has to be re-observed under the new root.
        for (const node of workspaceIds.keys()) pending.add(node);
      }
      flush();
    },

    observe(node: HTMLElement, workspaceId: string): CardVisibilityHandle {
      workspaceIds.set(node, workspaceId);
      pending.add(node);
      flush();
      return {
        update(next: string) {
          if (workspaceIds.get(node) === next) return;
          workspaceIds.set(node, next);
          if (pending.has(node)) flush();
        },
        destroy() {
          workspaceIds.delete(node);
          pending.delete(node);
          observer?.unobserve(node);
        },
      };
    },

    destroy() {
      destroyed = true;
      workspaceIds.clear();
      pending.clear();
      observer?.disconnect();
      observer = null;
      root = null;
    },
  };
}
