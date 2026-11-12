/**
 * Shared configuration for agent streaming behavior.
 *
 * Keep this browser-safe and importable from both renderer and main process.
 */

/**
 * Retry configuration for agent operations
 */
const AGENT_RETRY_CONFIG = {
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
