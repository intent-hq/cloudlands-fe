/**
 * Countdown progress bar opt-in for svelte-sonner toasts.
 *
 * `withToastCountdown` shapes toast options so the toast renders a thin bar
 * along its bottom edge that shrinks linearly over the toast's own
 * `duration` and pauses whenever sonner pauses its dismiss timer (toaster
 * hover/focus). The rendering lives in `Toast.svelte`, keyed off
 * `TOAST_COUNTDOWN_CLASS` and the `--toast-countdown-duration` custom
 * property this helper derives from the same `duration` passed to the toast.
 *
 * Options without a finite, positive `duration` are returned unchanged —
 * there is nothing to count down.
 */

export const TOAST_COUNTDOWN_CLASS = 'toast-countdown';

interface CountdownToastOptions {
  duration?: number;
  class?: string;
  style?: string;
}

export function withToastCountdown<T extends CountdownToastOptions>(options: T): T {
  const { duration } = options;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    return options;
  }
  const durationVar = `--toast-countdown-duration: ${duration}ms`;
  return {
    ...options,
    class: options.class ? `${options.class} ${TOAST_COUNTDOWN_CLASS}` : TOAST_COUNTDOWN_CLASS,
    style: options.style ? `${options.style}; ${durationVar}` : durationVar,
  };
}
