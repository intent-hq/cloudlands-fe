/**
 * Message Accumulator Saga (Main Process)
 *
 * Manages timer-based side effects:
 * - Flush timers (periodic content flush notifications)
 * - Checkpoint timers (periodic save notifications)
 * - Stale accumulator cleanup (periodic sweep)
 *
 * TextEncoder is kept as a saga-local variable (non-serializable).
 */

import { delay, fork, put, select, takeEvery, cancel } from "typed-redux-saga";
import type { Task } from "redux-saga";
import { Logger } from "../../../../../shared/logger";
import {
  startAccumulation,
  clearAccumulator,
  clearAllAccumulators,
  cleanupStaleAccumulators,
} from "../message-accumulator-slice";
import { selectActiveSessionIds, selectAccumulator } from "../message-accumulator-selectors";

const logger = new Logger("MessageAccumulatorSaga");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STALE_ACCUMULATOR_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const STALE_CLEANUP_INTERVAL_MS = 60 * 1000;         // Check every minute
const FLUSH_INTERVAL_MS = 5000;                       // 5 seconds
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CHECKPOINT_INTERVAL_MS = 1000;                  // 1 second

// ---------------------------------------------------------------------------
// Saga-local state (non-serializable)
// ---------------------------------------------------------------------------

/** Track flush timer tasks per session */
const flushTasks = new Map<string, Task>();

// ---------------------------------------------------------------------------
// Flush timer saga (per session)
// ---------------------------------------------------------------------------

function* flushTimerSaga(sessionId: string) {
  while (true) {
    yield* delay(FLUSH_INTERVAL_MS);
    const acc = yield* select(selectAccumulator.select, sessionId);
    if (!acc || acc.isComplete) return;
    logger.debug("Flushing accumulator", { sessionId });
    // Flush is informational — the content is already in Redux state.
    // Consumers can read state directly.
  }
}

// ---------------------------------------------------------------------------
// Handle start: spawn flush timer
// ---------------------------------------------------------------------------

function* handleStart(action: ReturnType<typeof startAccumulation>) {
  const { sessionId } = action.payload;

  // Cancel existing flush task for this session if any
  const existingTask = flushTasks.get(sessionId);
  if (existingTask) {
    yield* cancel(existingTask);
    flushTasks.delete(sessionId);
  }

  // Spawn a new flush timer
  const task = yield* fork(flushTimerSaga, sessionId);
  flushTasks.set(sessionId, task);
}

// ---------------------------------------------------------------------------
// Handle clear: cancel flush timer
// ---------------------------------------------------------------------------

function* handleClear(action: ReturnType<typeof clearAccumulator>) {
  const [sessionId] = action.payload;
  const task = flushTasks.get(sessionId);
  if (task) {
    yield* cancel(task);
    flushTasks.delete(sessionId);
  }
}

function* handleClearAll() {
  for (const [sessionId, task] of flushTasks.entries()) {
    yield* cancel(task);
    flushTasks.delete(sessionId);
  }
}

// ---------------------------------------------------------------------------
// Stale accumulator cleanup (periodic sweep)
// ---------------------------------------------------------------------------

function* staleCleanupLoop() {
  while (true) {
    yield* delay(STALE_CLEANUP_INTERVAL_MS);

    const sessionIds = yield* select(selectActiveSessionIds.select);
    if (sessionIds.length === 0) continue;

    const now = Date.now();
    const staleIds: string[] = [];

    for (const sid of sessionIds) {
      const acc = yield* select(selectAccumulator.select, sid);
      if (acc && now - acc.lastUpdateTime > STALE_ACCUMULATOR_TIMEOUT_MS) {
        staleIds.push(sid);
      }
    }

    if (staleIds.length > 0) {
      logger.info("Cleaning up stale accumulators", {
        count: staleIds.length,
        sessionIds: staleIds,
      });
      // Cancel flush tasks for stale sessions
      for (const sid of staleIds) {
        const task = flushTasks.get(sid);
        if (task) {
          yield* cancel(task);
          flushTasks.delete(sid);
        }
      }
      yield* put(cleanupStaleAccumulators(staleIds));
    }
  }
}

// ---------------------------------------------------------------------------
// Root saga
// ---------------------------------------------------------------------------

export function* messageAccumulatorSaga() {
  // Reset module-level state on (re)start
  flushTasks.clear();

  yield* fork(staleCleanupLoop);
  yield* takeEvery(startAccumulation, handleStart);
  yield* takeEvery(clearAccumulator, handleClear);
  yield* takeEvery(clearAllAccumulators, handleClearAll);
}

