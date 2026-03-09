/**
 * Saga effects for working with selector channels.
 *
 * These effects provide a safer, more ergonomic way to react to selector changes in sagas.
 * They automatically handle channel creation and cleanup, preventing memory leaks from
 * unclosed eventChannel subscriptions.
 *
 * Usage:
 * ```typescript
 * // Instead of:
 * const channel = yield* createChannelFromSelector(mySelector, arg);
 * try {
 *   yield* takeEvery(channel, function*({ payload }) { ... });
 * } finally {
 *   channel.close();
 * }
 *
 * // Use (with args):
 * yield* takeEveryFromSelector(mySelector, [arg], function*({ payload }) { ... });
 *
 * // Use (without args):
 * yield* takeEveryFromSelector(mySelector, function*({ payload }) { ... });
 * ```
 *
 * These effects automatically fork themselves, so you don't need to wrap them in fork().
 */
import { take, cancel, fork, getContext as getSagaContext } from "typed-redux-saga";
import { eventChannel, type EventChannel, type Task } from "redux-saga";
import type { StoreSelector, StoreState } from "../types";
import type { Readable } from "svelte/store";
import { shallowEqual } from "fast-equals";
import { createCachedSelector } from "./create-selector";

/**
 * The payload type emitted by selector channels
 */
export type SelectorChannelPayload<R> = {
  payload: R;
  prevPayload: R | undefined | null;
};

/**
 * Worker saga type for selector channel effects
 */
export type SelectorWorkerSaga<R> = (
  payload: SelectorChannelPayload<R>
) => Generator<any, void, any>;

/**
 * Creates an event channel from a selector that emits when the selector value changes.
 * The channel must be closed when no longer needed to prevent memory leaks.
 *
 * Usage:
 * ```typescript
 * const channel = yield* createChannelFromSelector(mySelector, arg1, arg2);
 * try {
 *   while (true) {
 *     const { payload, prevPayload } = yield* take(channel);
 *     // handle value change
 *   }
 * } finally {
 *   channel.close();
 * }
 * ```
 *
 * @param selector - The store selector to watch
 * @param args - Arguments to pass to the selector
 * @returns An event channel that emits { payload, prevPayload } on value changes
 */
export function* createChannelFromSelector<R, ARGS extends any[]>(
  selector: StoreSelector<R, ARGS>,
  ...args: ARGS
): Generator<any, EventChannel<SelectorChannelPayload<R>>, any> {
  const readableStoreState = (yield* getSagaContext("readableStoreState")) as Readable<StoreState>;
  if (!readableStoreState) {
    throw new Error("No Readable Store State available in saga");
  }

  const selectorFunc = selector.select;
  const channel = eventChannel<SelectorChannelPayload<R>>((emitter) => {
    const cachedSelector = createCachedSelector<ARGS, R>(selectorFunc, true);
    let prevValue: R | null = null;
    const unsubscribe = readableStoreState.subscribe((state) => {
      try {
        const payload = cachedSelector(state, ...args);
        if (shallowEqual(prevValue, payload)) {
          return;
        }
        emitter({ payload, prevPayload: prevValue });
        prevValue = payload;
      } catch (e) {
        console.error("Selector channel error", e);
      }
    });
    return unsubscribe;
  });

  return channel;
}

/**
 * Internal implementation for takeEvery pattern with selector channels.
 */
function* takeEveryFromSelectorImpl<R, ARGS extends any[]>(
  selector: StoreSelector<R, ARGS>,
  args: ARGS,
  worker: SelectorWorkerSaga<R>
) {
  const channel = yield* createChannelFromSelector(selector, ...args);
  try {
    while (true) {
      const payload = yield* take(channel);
      yield* fork(worker, payload);
    }
  } finally {
    channel.close();
  }
}

/**
 * Forks a task that spawns a new worker for each selector value change.
 * Similar to `takeEvery` but:
 * - Creates the channel from the selector automatically
 * - Closes the channel when the saga is cancelled or fails
 * - Automatically forks itself (no need to wrap in fork())
 *
 * @param selector - The store selector to watch
 * @param argsOrWorker - Arguments to pass to the selector, or the worker if no args needed
 * @param worker - Worker saga to run for each value change (optional if argsOrWorker is the worker)
 */
export function takeEveryFromSelector<R>(
  selector: StoreSelector<R, []>,
  worker: SelectorWorkerSaga<R>
): Generator<any, Task, any>;

export function takeEveryFromSelector<R, ARGS extends any[]>(
  selector: StoreSelector<R, ARGS>,
  args: ARGS,
  worker: SelectorWorkerSaga<R>
): Generator<any, Task, any>;

export function* takeEveryFromSelector<R, ARGS extends any[]>(
  selector: StoreSelector<R, ARGS>,
  argsOrWorker: ARGS | SelectorWorkerSaga<R>,
  worker?: SelectorWorkerSaga<R>
): Generator<any, Task, any> {
  // Handle overloaded signatures
  const actualArgs = (typeof argsOrWorker === "function" ? [] : argsOrWorker) as ARGS;
  const actualWorker = (
    typeof argsOrWorker === "function" ? argsOrWorker : worker
  ) as SelectorWorkerSaga<R>;

  return yield* fork(takeEveryFromSelectorImpl, selector, actualArgs, actualWorker);
}

/**
 * Internal implementation for takeLatest pattern with selector channels.
 */
function* takeLatestFromSelectorImpl<R, ARGS extends any[]>(
  selector: StoreSelector<R, ARGS>,
  args: ARGS,
  worker: SelectorWorkerSaga<R>
) {
  const channel = yield* createChannelFromSelector(selector, ...args);
  let lastTask: Task | null = null;
  try {
    while (true) {
      const payload = yield* take(channel);
      if (lastTask) {
        yield* cancel(lastTask);
      }
      lastTask = yield* fork(worker, payload);
    }
  } finally {
    channel.close();
  }
}

/**
 * Forks a task that cancels previous worker and spawns a new one for each selector value change.
 * Similar to `takeLatest` but:
 * - Creates the channel from the selector automatically
 * - Closes the channel when the saga is cancelled or fails
 * - Automatically forks itself (no need to wrap in fork())
 *
 * @param selector - The store selector to watch
 * @param argsOrWorker - Arguments to pass to the selector, or the worker if no args needed
 * @param worker - Worker saga to run for each value change (optional if argsOrWorker is the worker)
 */
export function takeLatestFromSelector<R>(
  selector: StoreSelector<R, []>,
  worker: SelectorWorkerSaga<R>
): Generator<any, Task, any>;

export function takeLatestFromSelector<R, ARGS extends any[]>(
  selector: StoreSelector<R, ARGS>,
  args: ARGS,
  worker: SelectorWorkerSaga<R>
): Generator<any, Task, any>;

export function* takeLatestFromSelector<R, ARGS extends any[]>(
  selector: StoreSelector<R, ARGS>,
  argsOrWorker: ARGS | SelectorWorkerSaga<R>,
  worker?: SelectorWorkerSaga<R>
): Generator<any, Task, any> {
  // Handle overloaded signatures
  const actualArgs = (typeof argsOrWorker === "function" ? [] : argsOrWorker) as ARGS;
  const actualWorker = (
    typeof argsOrWorker === "function" ? argsOrWorker : worker
  ) as SelectorWorkerSaga<R>;

  return yield* fork(takeLatestFromSelectorImpl, selector, actualArgs, actualWorker);
}

/**
 * Internal implementation for takeLeading pattern with selector channels.
 */
function* takeLeadingFromSelectorImpl<R, ARGS extends any[]>(
  selector: StoreSelector<R, ARGS>,
  args: ARGS,
  worker: SelectorWorkerSaga<R>
) {
  const channel = yield* createChannelFromSelector(selector, ...args);
  let isRunning = false;
  try {
    while (true) {
      const payload = yield* take(channel);
      if (!isRunning) {
        isRunning = true;
        yield* fork(function* () {
          try {
            yield* worker(payload);
          } finally {
            isRunning = false;
          }
        });
      }
    }
  } finally {
    channel.close();
  }
}

/**
 * Forks a task that ignores new values while a worker is running.
 * Similar to `takeLeading` but:
 * - Creates the channel from the selector automatically
 * - Closes the channel when the saga is cancelled or fails
 * - Automatically forks itself (no need to wrap in fork())
 *
 * @param selector - The store selector to watch
 * @param argsOrWorker - Arguments to pass to the selector, or the worker if no args needed
 * @param worker - Worker saga to run (optional if argsOrWorker is the worker)
 */
export function takeLeadingFromSelector<R>(
  selector: StoreSelector<R, []>,
  worker: SelectorWorkerSaga<R>
): Generator<any, Task, any>;

export function takeLeadingFromSelector<R, ARGS extends any[]>(
  selector: StoreSelector<R, ARGS>,
  args: ARGS,
  worker: SelectorWorkerSaga<R>
): Generator<any, Task, any>;

export function* takeLeadingFromSelector<R, ARGS extends any[]>(
  selector: StoreSelector<R, ARGS>,
  argsOrWorker: ARGS | SelectorWorkerSaga<R>,
  worker?: SelectorWorkerSaga<R>
): Generator<any, Task, any> {
  // Handle overloaded signatures
  const actualArgs = (typeof argsOrWorker === "function" ? [] : argsOrWorker) as ARGS;
  const actualWorker = (
    typeof argsOrWorker === "function" ? argsOrWorker : worker
  ) as SelectorWorkerSaga<R>;

  return yield* fork(takeLeadingFromSelectorImpl, selector, actualArgs, actualWorker);
}
