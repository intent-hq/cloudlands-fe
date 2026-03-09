import { call, delay, race } from "typed-redux-saga";

export type RetryWithTimeoutOutcome = "success" | "retries-exhausted" | "timeout";

export interface RetryWithTimeoutOptions {
  /** Maximum number of retries (total attempts = maxRetries + 1). */
  maxRetries: number;
  /** Total timeout in milliseconds for all attempts combined. */
  timeoutMs: number;
  /** Returns delay in ms before the next retry. Defaults to progressive: `1000 * (attempt + 1)`. */
  getDelayMs?: (attempt: number) => number;
  /**
   * Called on each failed attempt, before the retry delay.
   * Errors thrown by this callback are silently caught so they don't abort the retry loop.
   */
  onAttemptError?: (error: unknown, attempt: number, totalAttempts: number) => void;
}

/**
 * Retry a saga function with progressive delay and an overall timeout.
 *
 * Returns the outcome so the caller can handle success/failure/timeout
 * with domain-specific logic (notifications, flags, etc.).
 *
 * The function being retried must be idempotent — on retry, it will be
 * called again from scratch.
 *
 * @example
 * ```typescript
 * const outcome = yield* retryWithTimeout(
 *   function* () { yield* call(doWork); },
 *   {
 *     maxRetries: 2,
 *     timeoutMs: 30_000,
 *     onAttemptError: (e, attempt, total) =>
 *       console.error(`Attempt ${attempt + 1}/${total} failed`, e),
 *   }
 * );
 * if (outcome !== "success") {
 *   // handle failure or timeout
 * }
 * ```
 */
export function* retryWithTimeout(
  fn: () => Generator<any, void, any>,
  options: RetryWithTimeoutOptions
): Generator<any, RetryWithTimeoutOutcome, any> {
  const {
    maxRetries: rawMaxRetries,
    timeoutMs,
    getDelayMs = (attempt: number) => 1000 * (attempt + 1),
    onAttemptError,
  } = options;

  const maxRetries = Math.max(0, rawMaxRetries);
  const totalAttempts = maxRetries + 1;

  const result = yield* race({
    outcome: call(function* (): Generator<any, RetryWithTimeoutOutcome, any> {
      for (let attempt = 0; attempt < totalAttempts; attempt++) {
        try {
          yield* call(fn);
          return "success";
        } catch (e) {
          try {
            onAttemptError?.(e, attempt, totalAttempts);
          } catch {
            // Don't let a callback bug abort the retry loop.
          }
          if (attempt < maxRetries) {
            yield* delay(getDelayMs(attempt));
          }
        }
      }
      return "retries-exhausted";
    }),
    timeout: delay(timeoutMs),
  });

  return result.outcome ?? "timeout";
}
