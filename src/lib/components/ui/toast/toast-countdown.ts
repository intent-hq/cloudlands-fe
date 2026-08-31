/**
 * Countdown progress bar opt-in for svelte-sonner toasts.
 *
 * `withToastCountdown` shapes toast options so the toast renders a thin bar
 * along its bottom edge that shrinks linearly over the toast's own
 * `duration` and, by default, pauses whenever sonner pauses its dismiss
 * timer (toaster hover). The rendering lives in `Toast.svelte`, keyed off
 * `TOAST_COUNTDOWN_CLASS` and the `--toast-countdown-duration` custom
 * property this helper derives from the same `duration` passed to the toast.
 *
 * Options without a finite, positive `duration` are returned unchanged —
 * there is nothing to count down.
 */

export const TOAST_COUNTDOWN_CLASS = 'toast-countdown';
export const TOAST_COUNTDOWN_NO_HOVER_PAUSE_CLASS = 'toast-countdown-no-hover-pause';

interface CountdownToastOptions {
  duration?: number;
  class?: string;
  style?: string;
}

interface CountdownConfig {
  /**
   * Whether the bar pauses while sonner pauses its dismiss timer (toaster
   * hover). Defaults to `true`, which is right when the countdown's deadline
   * IS sonner's own dismiss timer (the undo stays valid for the toast's whole
   * visible lifetime). Pass `false` when the countdown mirrors an
   * independent deadline — a saga `delay`, `setTimeout`, or daemon
   * `undoDelayMs` undo window — that keeps running while sonner is paused:
   * the bar then keeps shrinking toward the real deadline instead of showing
   * remaining time after the action has already become final.
   */
  pauseOnHover?: boolean;
}

export function withToastCountdown<T extends CountdownToastOptions>(
  options: T,
  { pauseOnHover = true }: CountdownConfig = {},
): T {
  const { duration } = options;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    return options;
  }
  const countdownClass = pauseOnHover
    ? TOAST_COUNTDOWN_CLASS
    : `${TOAST_COUNTDOWN_CLASS} ${TOAST_COUNTDOWN_NO_HOVER_PAUSE_CLASS}`;
  const durationVar = `--toast-countdown-duration: ${duration}ms`;
  return {
    ...options,
    class: options.class ? `${options.class} ${countdownClass}` : countdownClass,
    style: options.style ? `${options.style}; ${durationVar}` : durationVar,
  };
}
