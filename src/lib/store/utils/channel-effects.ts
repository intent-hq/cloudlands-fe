/**
 * Saga effects for consuming any redux-saga EventChannel.
 *
 * These effects provide a safer, more ergonomic way to consume event channels in sagas.
 * They automatically handle the take loop and channel cleanup, preventing memory leaks
 * from unclosed channels.
 *
 * Usage:
 * ```typescript
 * // Instead of:
 * const channel = createListenSyncChannel<MyEvent>('my:event');
 * try {
 *   while (true) {
 *     const data = yield* take(channel);
 *     yield* call(handleEvent, data);
 *   }
 * } finally {
 *   channel.close();
 * }
 *
 * // Use:
 * const channel = createListenSyncChannel<MyEvent>('my:event');
 * yield* takeEveryFromChannel(channel, function* (data) {
 *   yield* call(handleEvent, data);
 * });
 * ```
 *
 * These effects automatically fork themselves, so you don't need to wrap them in fork().
 */
import {
  take,
  cancel,
  fork,
} from "typed-redux-saga";
import { END } from "redux-saga";
import type { EventChannel, Task } from "redux-saga";
import type { NotUndefined } from "@redux-saga/types";

/**
 * Worker saga type for channel effects
 */
export type ChannelWorkerSaga<T extends NotUndefined> = (data: T) => Generator<any, void, any>;

/**
 * Internal implementation for takeEvery pattern with event channels.
 * Takes from the channel in a loop, forking a new worker for each event.
 * Closes the channel in the finally block when cancelled.
 */
function* takeEveryFromChannelImpl<T extends NotUndefined>(
  channel: EventChannel<T>,
  worker: ChannelWorkerSaga<T>,
) {
  try {
    while (true) {
      const data = yield* take(channel);
      if (data === (END as unknown as T)) break;
      yield* fork(worker, data);
    }
  } finally {
    channel.close();
  }
}

/**
 * Forks a task that spawns a new worker for each event from an EventChannel.
 * Similar to `takeEvery` but for any EventChannel:
 * - Consumes events from the channel in a loop
 * - Forks a new worker for each event (concurrent handling)
 * - Closes the channel when the saga is cancelled or fails
 * - Automatically forks itself (no need to wrap in fork())
 *
 * @param channel - The EventChannel to consume
 * @param worker - Worker saga to run for each event
 * @returns A forked Task
 */
export function* takeEveryFromChannel<T extends NotUndefined>(
  channel: EventChannel<T>,
  worker: ChannelWorkerSaga<T>,
): Generator<any, Task, any> {
  return yield* fork(takeEveryFromChannelImpl, channel, worker);
}

/**
 * Internal implementation for takeLatest pattern with event channels.
 * Takes from the channel in a loop, cancelling the previous worker before
 * forking a new one for each event. Closes the channel in the finally block.
 */
function* takeLatestFromChannelImpl<T extends NotUndefined>(
  channel: EventChannel<T>,
  worker: ChannelWorkerSaga<T>,
) {
  let lastTask: Task | null = null;
  try {
    while (true) {
      const data = yield* take(channel);
      if (data === (END as unknown as T)) break;
      if (lastTask) {
        yield* cancel(lastTask);
      }
      lastTask = yield* fork(worker, data);
    }
  } finally {
    channel.close();
  }
}

/**
 * Forks a task that cancels the previous worker and spawns a new one for each
 * event from an EventChannel. Similar to `takeLatest` but for any EventChannel:
 * - Consumes events from the channel in a loop
 * - Cancels the previously forked worker before starting a new one
 * - Closes the channel when the saga is cancelled or fails
 * - Automatically forks itself (no need to wrap in fork())
 *
 * @param channel - The EventChannel to consume
 * @param worker - Worker saga to run for each event
 * @returns A forked Task
 */
export function* takeLatestFromChannel<T extends NotUndefined>(
  channel: EventChannel<T>,
  worker: ChannelWorkerSaga<T>,
): Generator<any, Task, any> {
  return yield* fork(takeLatestFromChannelImpl, channel, worker);
}

