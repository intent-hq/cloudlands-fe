/** How a `screencapture -i` window/region selection ended. */
export type DockSelectionOutcome = 'image' | 'cancelled' | 'timeout' | 'failed';

interface SelectionExit {
  /** The `execFile` callback error: spawn failures carry a string code, exits a number. */
  error: { code?: unknown; killed?: boolean; signal?: unknown } | null;
  wroteImage: boolean;
}

/**
 * Escape (or clicking away) leaves no file and exits 0 or 1. A process that could
 * not start, was stopped at the deadline, or exited otherwise is a failure, never
 * a silent cancellation.
 */
export function dockSelectionOutcome({ error, wroteImage }: SelectionExit): DockSelectionOutcome {
  if (error && typeof error.code === 'string') return 'failed';
  if (error && (error.killed || error.signal)) return 'timeout';
  if (wroteImage) return 'image';
  const code = error ? error.code : 0;
  return code === 0 || code === 1 ? 'cancelled' : 'failed';
}
