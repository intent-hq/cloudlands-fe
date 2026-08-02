/**
 * Hard-exit watchdog for graceful shutdown (intent-hq/monorepo#1300).
 *
 * Races an async cleanup routine against a hard deadline: if the routine has
 * not settled by `timeoutMs`, `onTimeout` fires (callers force-exit there).
 * The timer is unref()ed so the watchdog never keeps the process alive, and
 * cleared once the routine settles so it cannot fire after a clean exit.
 */
export function runWithHardExitTimeout<T>(
  run: () => Promise<T>,
  onTimeout: () => void,
  timeoutMs: number,
): Promise<T> {
  const timer = setTimeout(onTimeout, timeoutMs);
  (timer as { unref?: () => void }).unref?.();
  let result: Promise<T>;
  try {
    result = Promise.resolve(run());
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
  return result.finally(() => clearTimeout(timer));
}
