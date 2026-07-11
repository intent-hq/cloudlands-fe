/**
 * Shared configuration for agent streaming behavior.
 *
 * Keep this browser-safe and importable from both renderer and main process.
 */

export const AGENT_STREAMING_CONFIG = {
  /**
   * How long (ms) to treat a persisted active stream as reconnectable after a reload.
   * After this, we consider metadata stale and clear it.
   */
  ACTIVE_STREAM_MAX_AGE_MS: 24 * 60 * 60 * 1000, // 24 hours

  /**
   * Interval (ms) between GC passes over completed / marked-for-cleanup stream
   * sessions in the main-process stream manager (consumed as
   * `STREAM_CONFIG.CLEANUP_INTERVAL`). This is a periodic cleanup cadence for
   * reclaiming resources — it does NOT enforce turn lifetime. The daemon
   * (intentd) owns turn lifetime (PROMPT_TIMEOUT); the frontend does not
   * force-terminate in-flight streams on wall-clock grounds. Informational
   * stall detection remains a separate, non-terminal UI concern.
   */
  STREAM_MANAGER_GC_INTERVAL_MS: 60 * 60 * 1000, // 1 hour

  /**
   * Interval (ms) for saving session state to disk during streaming.
   * More frequent saves prevent data loss on refresh.
   */
  SAVE_INTERVAL_MS: 5000, // 5 seconds

  /**
   * Maximum number of stall recovery attempts before forcing completion.
   * Set to 10 to allow more recovery attempts for long-running tasks.
   */
  MAX_STALL_RETRIES: 10,
} as const;

/**
 * Retry configuration for agent operations
 */
export const AGENT_RETRY_CONFIG = {
  /**
   * Maximum number of retry attempts
   */
  MAX_ATTEMPTS: 5,

  /**
   * Initial delay (ms) before first retry
   */
  INITIAL_DELAY_MS: 200,

  /**
   * Maximum delay (ms) between retries
   */
  MAX_DELAY_MS: 2000,

  /**
   * Backoff multiplier for exponential backoff
   */
  BACKOFF_MULTIPLIER: 2,

  /**
   * Whether to add jitter to retry delays
   */
  USE_JITTER: true,

  /**
   * Maximum jitter (ms) to add to retry delays
   */
  MAX_JITTER_MS: 100,

  /**
   * Patterns that should trigger retry
   */
  RETRYABLE_ERRORS: [
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'ENETUNREACH',
    'timeout',
    'network',
    'stream',
  ],

  /**
   * Patterns that should NOT trigger retry, checked case-insensitively against error messages.
   * Includes Node.js system error codes, generic fatal indicators,
   * Intent-specific error strings surfaced by agent providers, and rate-limit errors.
   */
  NON_RETRYABLE_ERRORS: [
    'EACCES',
    'EPERM',
    'ENOSPC',
    'EMFILE',
    'permission',
    'memory',
    'fatal',
    'process died',
    'not available on your current plan',
    'agent binary',
    'rate limit',
    'too many requests',
    'hit your limit',
    "you've hit your limit",
    'quota exceeded',
  ],
} as const;

/**
 * Check if an error message matches any non-retryable patterns.
 * Checks case-insensitively against AGENT_RETRY_CONFIG.NON_RETRYABLE_ERRORS.
 */
export function isFatalError(errorMessage: string): boolean {
  const lower = errorMessage.toLowerCase();
  for (const pattern of AGENT_RETRY_CONFIG.NON_RETRYABLE_ERRORS) {
    if (lower.includes(pattern.toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * Error message returned when a prompt is dropped because the agent already has
 * one in flight. Shared so backend producers and renderer/adapter consumers stay
 * in sync instead of matching against duplicated string literals.
 */
export const IN_FLIGHT_PROMPT_DROPPED_ERROR =
  'Agent already has an in-flight prompt. Message was not delivered.';

export type AgentStreamingConfig = typeof AGENT_STREAMING_CONFIG;
export type AgentRetryConfig = typeof AGENT_RETRY_CONFIG;
