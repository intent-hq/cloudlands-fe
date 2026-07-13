/**
 * Streaming Invariant Assertions
 *
 * Lightweight runtime assertions for critical streaming pipeline points.
 * These catch regressions in production by logging clear error messages.
 *
 * IMPORTANT: Assertions log `console.error` but NEVER throw — we don't
 * want to crash the app due to an invariant violation.
 */

const STREAMING_INVARIANTS_ENABLED = true; // can be toggled for perf

/**
 * Assert a streaming invariant condition.
 * Logs a console.error if the condition is false, but never throws.
 *
 * @param condition - The invariant condition that should be true
 * @param message - Human-readable description of the violated invariant
 * @param context - Optional structured context for debugging
 */
export function assertStreamingInvariant(
  condition: boolean,
  message: string,
  context?: Record<string, unknown>,
): void {
  if (STREAMING_INVARIANTS_ENABLED && !condition) {
    let contextStr = '';
    if (context) {
      try {
        contextStr = ` | ${JSON.stringify(context)}`;
      } catch {
        contextStr = ' | [unserializable context]';
      }
    }
    console.error(`[STREAMING INVARIANT VIOLATION] ${message}${contextStr}`);
  }
}

/**
 * Health summary returned by AgentService.getStreamingHealth().
 */
export interface StreamingHealthSummary {
  activeIpcHandlers: number;
  activeDomHandlers: number;
  pendingQueueSessions: number;
  totalPendingEvents: number;
  orphanedHandlers: string[]; // IPC handlers without matching DOM handlers
}

