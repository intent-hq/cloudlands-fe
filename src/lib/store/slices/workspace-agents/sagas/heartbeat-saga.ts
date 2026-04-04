/**
 * Heartbeat Saga
 *
 * Monitors agent session health and connectivity using saga-managed timers.
 * Replaces the old singleton HeartbeatService.
 *
 * Timers (non-serializable) are kept as saga-local state — no Redux state needed.
 */

import { createLogger } from '$lib/utils/client-logger';
import { eventChannel, type EventChannel, type Task } from 'redux-saga';
import { call, cancel, fork, put, take, takeEvery } from 'typed-redux-saga';
import {
  heartbeatReceived,
  heartbeatTimedOut,
  startHeartbeat,
  stopAllHeartbeats,
  stopHeartbeat,
} from '../workspace-agents-slice';

const logger = createLogger('Heartbeat');

const DEFAULT_INTERVAL_MS = 30_000;
const TIMEOUT_MS = 60_000;

/**
 * Creates an event channel that emits at a fixed interval.
 * The channel auto-closes when cancelled by the saga runtime.
 */
function createTickChannel(intervalMs: number): EventChannel<number> {
  return eventChannel<number>((emitter) => {
    const id = setInterval(() => emitter(Date.now()), intervalMs);
    return () => clearInterval(id);
  });
}

/**
 * Watches a single heartbeat session.
 * Emits `heartbeatTimedOut` if no beat is received within TIMEOUT_MS.
 * Cancelled externally via `stopHeartbeat` or `stopAllHeartbeats`.
 */
/** @internal Exported for testing only. */
export function* watchSingleHeartbeat(sessionId: string, intervalMs: number) {
  let lastBeat = Date.now();

  // Fork a listener that updates lastBeat on incoming beats
  const beatListenerTask: Task = yield* fork(function* () {
    while (true) {
      const action: ReturnType<typeof heartbeatReceived> = yield* take(heartbeatReceived);
      if (action.payload[0] === sessionId) {
        lastBeat = Date.now();
        logger.debug('Heartbeat received', { sessionId });
      }
    }
  });

  const tickChannel = createTickChannel(intervalMs);

  try {
    while (true) {
      yield* take(tickChannel);
      const now = Date.now();
      const timeSinceLastBeat = now - lastBeat;

      if (timeSinceLastBeat > TIMEOUT_MS) {
        logger.warn('Heartbeat timeout', { sessionId, timeSinceLastBeat });
        yield* put(heartbeatTimedOut(sessionId));
        return; // Stop monitoring this session after timeout
      }
    }
  } finally {
    tickChannel.close();
    yield* cancel(beatListenerTask);
    logger.debug('Stopped heartbeat', { sessionId });
  }
}

/**
 * Root heartbeat saga.
 * Manages per-session heartbeat watcher tasks keyed by sessionId.
 */
export function* heartbeatSaga() {
  const activeTasks = new Map<string, Task>();

  function* stopSession(sessionId: string) {
    const task = activeTasks.get(sessionId);
    if (task) {
      yield* cancel(task);
      activeTasks.delete(sessionId);
    }
  }

  function* stopAll() {
    for (const task of activeTasks.values()) {
      yield* cancel(task);
    }
    activeTasks.clear();
    logger.info('Stopped all heartbeats');
  }

  function* handleStart(action: ReturnType<typeof startHeartbeat>) {
    const [sessionId, intervalMs] = action.payload;
    // Stop any existing heartbeat for this session before starting a new one
    yield* call(stopSession, sessionId);
    const task: Task = yield* fork(watchSingleHeartbeat, sessionId, intervalMs ?? DEFAULT_INTERVAL_MS);
    activeTasks.set(sessionId, task);
  }

  function* handleStop(action: ReturnType<typeof stopHeartbeat>) {
    const [sessionId] = action.payload;
    yield* call(stopSession, sessionId);
  }

  function* handleStopAll() {
    yield* call(stopAll);
  }

  try {
    yield* takeEvery(startHeartbeat, handleStart);
    yield* takeEvery(stopHeartbeat, handleStop);
    yield* takeEvery(stopAllHeartbeats, handleStopAll);
  } finally {
    // Cleanup all timers when saga is cancelled (e.g. workspace switch)
    for (const task of activeTasks.values()) {
      yield* cancel(task);
    }
    activeTasks.clear();
  }
}

