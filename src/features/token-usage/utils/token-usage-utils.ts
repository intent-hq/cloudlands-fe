/**
 * Token Usage Utils
 *
 * Pure, dependency-light helpers for the daemon-owned token usage surface
 * (PROTOCOL §5.23). The local session-file scanning helpers were deleted with
 * the main-process scanner pipeline — usage accounting is daemon-internal.
 * No stores, services, or side effects.
 */

import type { TokenUsageTotals } from '../token-usage-types';

/** Bucket for token totals whose model name cannot be resolved. */
export const UNKNOWN_MODEL = 'unknown';

export function createEmptyTotals(): TokenUsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
}
