/**
 * Viewport gate for the HUD grid's per-workspace daemon reads.
 *
 * The grid renders one card per registered workspace and each card joins in a
 * `tasks` + `tokenUsage` rollup it has to ask the daemon for, so a profile with
 * ~130 workspaces used to put ~130 reads on the wire in a single tick. The
 * bounded read scheduler queues that fan-out; this gate stops most of it from
 * being issued at all — a card the user has not scrolled to asks for nothing.
 *
 * `IntersectionObserver` clips against ancestor overflow, so the default
 * (document) root already reports cards scrolled out of the grid's own
 * scroll container and no explicit root wiring is needed. Where the API is
 * missing (non-DOM environments) every observed card is reported immediately,
 * which is the pre-gate behaviour — degrade to more reads, never to none.
 */

/**
 * Cards this far outside the viewport count as visible, so a card is already
 * loaded by the time a scroll brings it into view.
 */
export const CARD_VISIBILITY_ROOT_MARGIN = '200px 0px';

/** Svelte action return shape for {@link CardVisibilityGate.observe}. */
export interface CardVisibilityHandle {
  update(workspaceId: string): void;
  destroy(): void;
}

export interface CardVisibilityGate {
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
  let observer: IntersectionObserver | null = null;
  let destroyed = false;

  function ensureObserver(): IntersectionObserver | null {
    if (observer || destroyed) return observer;
    if (typeof IntersectionObserver === 'undefined') return null;
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const workspaceId = workspaceIds.get(entry.target);
          if (workspaceId) onVisible(workspaceId);
        }
      },
      { rootMargin: CARD_VISIBILITY_ROOT_MARGIN },
    );
    return observer;
  }

  return {
    observe(node: HTMLElement, workspaceId: string): CardVisibilityHandle {
      workspaceIds.set(node, workspaceId);
      const active = ensureObserver();
      if (active) active.observe(node);
      else onVisible(workspaceId);
      return {
        update(next: string) {
          if (workspaceIds.get(node) === next) return;
          workspaceIds.set(node, next);
          if (!active) onVisible(next);
        },
        destroy() {
          workspaceIds.delete(node);
          active?.unobserve(node);
        },
      };
    },
    destroy() {
      destroyed = true;
      workspaceIds.clear();
      observer?.disconnect();
      observer = null;
    },
  };
}
