/**
 * FLIP slide-down insertion for the HUD right-column lists (mock's `slide()`):
 * on insert the list renders shifted up with no transition (`prep`), is
 * released a frame later to slide down (`run`, 450ms cubic-bezier(0.16,1,0.3,1)),
 * then settles (`idle`). Disabled entirely under reduced motion.
 */

export type HudSlidePhase = "idle" | "prep" | "run";

/** Matches the mock's release delay (40ms) and settle timeout (600ms). */
const RELEASE_MS = 40;
const SETTLE_MS = 600;

export class HudSlide {
  phase = $state<HudSlidePhase>("idle");
  #releaseTimer: ReturnType<typeof setTimeout> | undefined;
  #settleTimer: ReturnType<typeof setTimeout> | undefined;

  /** Kick one prep → run → idle cycle (restarts if one is in flight). */
  trigger(): void {
    clearTimeout(this.#releaseTimer);
    clearTimeout(this.#settleTimer);
    this.phase = "prep";
    this.#releaseTimer = setTimeout(() => {
      this.phase = "run";
    }, RELEASE_MS);
    this.#settleTimer = setTimeout(() => {
      this.phase = "idle";
    }, SETTLE_MS);
  }

  dispose(): void {
    clearTimeout(this.#releaseTimer);
    clearTimeout(this.#settleTimer);
    this.phase = "idle";
  }
}

/**
 * Reactive `prefers-reduced-motion` flag. Call from component init; returns
 * a getter plus the cleanup to run on unmount.
 */
export function watchReducedMotion(): { readonly current: boolean; cleanup: () => void } {
  let reduced = $state(false);
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return {
      get current() {
        return reduced;
      },
      cleanup: () => {},
    };
  }
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  reduced = query.matches;
  const onChange = (event: MediaQueryListEvent) => {
    reduced = event.matches;
  };
  query.addEventListener("change", onChange);
  return {
    get current() {
      return reduced;
    },
    cleanup: () => query.removeEventListener("change", onChange),
  };
}
