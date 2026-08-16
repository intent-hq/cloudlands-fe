/**
 * Damped visibility for the chat scroll-to-bottom button.
 *
 * The raw `distanceFromBottom` metric jitters when transient scrollHeight
 * changes (lazy-turn placeholder swaps, image loads, late layout settles)
 * move the scroll geometry per frame. Rendering the button straight off a
 * single threshold turns that jitter into a visible strobe (and re-triggers
 * the decorative re-lock confirmation on every crossing).
 *
 * This controller commits visibility changes through two damping layers:
 *
 * - **Hysteresis band**: showing requires the distance to exceed
 *   `atBottomThreshold + showHysteresis`, while hiding keeps the original
 *   `<= atBottomThreshold` contract (button hidden at bottom, PR #1263/#1270).
 *   Jitter confined to the band flips nothing.
 * - **Show settle window**: a show only commits after the distance has stayed
 *   beyond the show threshold for `showSettleMs`. Any sample back at/below it
 *   cancels the pending show, so large-amplitude per-frame oscillation can
 *   never strobe the button in.
 *
 * Hides commit immediately (the at-bottom contract stays prompt), and the
 * re-lock callback fires only on a committed shown → hidden transition — a
 * jitter burst that never commits a show can never flash the confirmation.
 */

export const SCROLL_BUTTON_SHOW_HYSTERESIS_PX = 30;
export const SCROLL_BUTTON_SHOW_SETTLE_MS = 150;

export interface ScrollBottomButtonVisibilityOptions {
  /** Distance at/below which the view counts as at-bottom and the button hides. */
  atBottomThreshold: number;
  /** Extra distance beyond the threshold required before a show is considered. */
  showHysteresis?: number;
  /** How long the distance must hold beyond the show threshold before showing. */
  showSettleMs?: number;
  /** Committed visibility changed. */
  onVisibilityChange: (visible: boolean) => void;
  /** A committed shown state returned to the bottom (re-lock crossing). */
  onRelock?: () => void;
}

export interface ScrollBottomButtonVisibility {
  /** Feed the latest distance-from-bottom sample (from a scroll event). */
  update(distanceFromBottom: number): void;
  /** Whether the button is currently committed visible. */
  readonly visible: boolean;
  /** Cancel any pending show; call on teardown. */
  destroy(): void;
}

export function createScrollBottomButtonVisibility(
  options: ScrollBottomButtonVisibilityOptions,
): ScrollBottomButtonVisibility {
  const {
    atBottomThreshold,
    showHysteresis = SCROLL_BUTTON_SHOW_HYSTERESIS_PX,
    showSettleMs = SCROLL_BUTTON_SHOW_SETTLE_MS,
    onVisibilityChange,
    onRelock,
  } = options;
  const showThreshold = atBottomThreshold + showHysteresis;

  let visible = false;
  let pendingShowTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelPendingShow(): void {
    if (pendingShowTimer !== null) {
      clearTimeout(pendingShowTimer);
      pendingShowTimer = null;
    }
  }

  return {
    update(distanceFromBottom: number): void {
      if (visible) {
        if (distanceFromBottom <= atBottomThreshold) {
          visible = false;
          onVisibilityChange(false);
          onRelock?.();
        }
        return;
      }
      if (distanceFromBottom > showThreshold) {
        if (pendingShowTimer === null) {
          pendingShowTimer = setTimeout(() => {
            pendingShowTimer = null;
            visible = true;
            onVisibilityChange(true);
          }, showSettleMs);
        }
      } else {
        cancelPendingShow();
      }
    },
    get visible(): boolean {
      return visible;
    },
    destroy(): void {
      cancelPendingShow();
    },
  };
}
