/**
 * Message Accumulator Saga (Main Process)
 *
 * Manages timer-based side effects:
 * - Stale accumulator cleanup (periodic sweep)
 */

import {
  delay,
  put,
} from "typed-redux-saga";
import { Logger } from "../../../../../shared/logger";
import { cleanupStaleAccumulators } from "../message-accumulator-slice";
import {
  selectActiveSessionIds,
  selectAccumulator,
} from "../message-accumulator-selectors";

const logger = new Logger("MessageAccumulatorSaga");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STALE_ACCUMULATOR_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const STALE_CLEANUP_INTERVAL_MS = 60 * 1000;         // Check every minute

// ---------------------------------------------------------------------------
// Stale accumulator cleanup (periodic sweep)
// ---------------------------------------------------------------------------

export function* staleCleanupLoop() {
  while (true) {
    yield* delay(STALE_CLEANUP_INTERVAL_MS);

    const sessionIds = yield* selectActiveSessionIds.effect();
    if (sessionIds.length === 0) continue;

    const now = Date.now();
    const staleIds: string[] = [];

    for (const sid of sessionIds) {
      const acc = yield* selectAccumulator.effect(sid);
      if (acc && now - acc.lastUpdateTime > STALE_ACCUMULATOR_TIMEOUT_MS) {
        staleIds.push(sid);
      }
    }

    if (staleIds.length > 0) {
      logger.info("Cleaning up stale accumulators", {
        count: staleIds.length,
        sessionIds: staleIds,
      });
      yield* put(cleanupStaleAccumulators(staleIds));
    }
  }
}
