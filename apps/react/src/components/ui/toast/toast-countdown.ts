import type { CSSProperties } from 'react';

export const TOAST_COUNTDOWN_CLASS = 'toast-countdown';
export const TOAST_COUNTDOWN_NO_HOVER_PAUSE_CLASS = 'toast-countdown-no-hover-pause';

interface CountdownToastOptions {
  duration?: number;
  className?: string;
  style?: CSSProperties;
}

/** Match the toast duration; independent deadlines must keep running on hover. */
export function withToastCountdown<T extends CountdownToastOptions>(
  options: T,
  { pauseOnHover = true }: { pauseOnHover?: boolean } = {},
): T {
  const { duration } = options;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) return options;
  const countdownClass = pauseOnHover
    ? TOAST_COUNTDOWN_CLASS
    : `${TOAST_COUNTDOWN_CLASS} ${TOAST_COUNTDOWN_NO_HOVER_PAUSE_CLASS}`;
  return {
    ...options,
    className: options.className ? `${options.className} ${countdownClass}` : countdownClass,
    style: { ...options.style, '--toast-countdown-duration': `${duration}ms` },
  };
}
