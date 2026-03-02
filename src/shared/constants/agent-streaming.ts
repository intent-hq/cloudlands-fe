/**
 * Shared configuration for agent streaming behavior.
 *
 * Keep this browser-safe and importable from both renderer and main process.
 */

export const AGENT_STREAMING_CONFIG = {
  /**
   * Maximum time (ms) the backend will keep a stream open without explicit completion
   * before synthesizing a completion event.
   * NOTE: Set to 30 minutes to allow for long-running tasks. Streams should complete
   * naturally when the agent finishes, not be forcibly terminated by timeout.
   */
  BACKEND_STREAM_TIMEOUT_MS: 30 * 60 * 1000, // 30 minutes

  /**
   * Extra grace period (ms) the frontend keeps listening after backend timeout to
   * capture any final events and cleanly tear down handlers.
   */
  FRONTEND_STREAM_CLEANUP_GRACE_MS: 15000, // 15 seconds

  /**
   * How long (ms) to treat a persisted active stream as reconnectable after a reload.
   * After this, we consider metadata stale and clear it.
   */
  ACTIVE_STREAM_MAX_AGE_MS: 24 * 60 * 60 * 1000, // 24 hours

  /**
   * Inactivity window (ms) used by providers to infer that a stream has completed
   * when using inactivity-based detection.
   * NOTE: Set to 1 hour to allow for very long-running operations. This is a
   * FALLBACK ONLY for detecting truly dead connections. Streams should complete
   * naturally when Auggie sends a stopReason, not be forcibly terminated by timeout.
   * The frontend has its own stall detection (90 seconds) that shows UI warnings,
   * but that doesn't stop the stream - it just informs the user.
   *
   * IMPORTANT: Do not reduce this value. Agents may execute complex multi-step
   * operations (e.g., large refactors, test suites, deployments) that can take
   * many minutes without emitting streaming chunks. Premature timeout causes
   * the "agent stops and needs to be prodded" bug.
   */
  COMPLETION_DETECTION_MS: 60 * 60 * 1000, // 1 hour - only for detecting dead connections

  /**
   * Timeout (ms) for ACP prompt responses.
   * Set to 30 minutes to match backend stream timeout.
   */
  PROMPT_RESPONSE_TIMEOUT_MS: 30 * 60 * 1000, // 30 minutes

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
   * Intent-specific error strings from acp-provider.ts, and rate-limit errors.
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

export type AgentStreamingConfig = typeof AGENT_STREAMING_CONFIG;
export type AgentRetryConfig = typeof AGENT_RETRY_CONFIG;
