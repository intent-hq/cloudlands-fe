/**
 * Main-process equivalent of the renderer's selector-channel effects.
 *
 * Emits `{ payload, prevPayload }` when a selector's output changes,
 * backed directly by `store.subscribe()` on the main Redux store
 * (no Svelte readable, no saga context).
 *
 * Usage:
 * ```typescript
 * const channel = createChannelFromSelector(mySelector, arg);
 * try {
 *   const { payload, prevPayload } = yield* take(channel);
 * } finally {
 *   channel.close();
 * }
 *
 * // or, with a wrapper:
 * yield* takeEveryFromSelector(mySelector, [arg], function*({ payload }) { ... });
 * ```
 */
import { take, cancel, fork } from "typed-redux-saga";
import { eventChannel, type EventChannel, type Task } from "redux-saga";
import { shallowEqual } from "fast-equals";

import { createCachedSelector } from "../../utils/create-cached-selector";
import { getMainStore } from "../redux-store-bridge";
import type { MainStoreState } from "../types";
import type { MainStoreSelector } from "./create-selector";

export type SelectorChannelPayload<R> = {
  payload: R;
  prevPayload: R | undefined | null;
};

export type SelectorChannelIsEqual<R> = (
  prev: R | undefined | null,
  next: R,
) => boolean;

export type SelectorChannelOptions<R> = {
  isEqual?: SelectorChannelIsEqual<R>;
};

export type SelectorWorkerSaga<R> = (
  payload: SelectorChannelPayload<R>,
) => Generator<any, void, any>;

const defaultIsEqual: SelectorChannelIsEqual<unknown> = (prev, next) =>
  shallowEqual(prev, next);

function isSelectorChannelOptions(value: unknown): value is SelectorChannelOptions<unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.isEqual !== "function") return false;
  for (const key of Object.keys(record)) {
    if (key !== "isEqual") return false;
  }
  return true;
}

/**
 * Creates an event channel from a main-process selector that emits when the
 * selector value changes. The channel must be closed when no longer needed
 * to prevent memory leaks.
 *
 * Equality defaults to `shallowEqual` from `fast-equals`. A custom comparer
 * can be supplied via an options object placed before the selector args:
 *
 * ```typescript
 * createChannelFromSelector(selector, arg1, arg2);
 * createChannelFromSelector(selector, { isEqual: myCompare }, arg1, arg2);
 * ```
 */
export function createChannelFromSelector<R, ARGS extends any[]>(
  selector: MainStoreSelector<R, ARGS>,
  ...args: ARGS
): EventChannel<SelectorChannelPayload<R>>;

export function createChannelFromSelector<R, ARGS extends any[]>(
  selector: MainStoreSelector<R, ARGS>,
  options: SelectorChannelOptions<R>,
  ...args: ARGS
): EventChannel<SelectorChannelPayload<R>>;

export function createChannelFromSelector<R, ARGS extends any[]>(
  selector: MainStoreSelector<R, ARGS>,
  ...rest: unknown[]
): EventChannel<SelectorChannelPayload<R>> {
  const hasOptions = rest.length > 0 && isSelectorChannelOptions(rest[0]);
  const options = (hasOptions ? rest[0] : {}) as SelectorChannelOptions<R>;
  const args = (hasOptions ? rest.slice(1) : rest) as ARGS;
  const isEqual =
    options.isEqual ?? (defaultIsEqual as SelectorChannelIsEqual<R>);

  const store = getMainStore();
  const selectorFunc = selector.select;

  return eventChannel<SelectorChannelPayload<R>>((emitter) => {
    const cachedSelector = createCachedSelector<MainStoreState, ARGS, R>(selectorFunc);
    let prevValue: R | undefined | null = null;

    const compute = () => {
      try {
        const state = store.getState();
        const payload = cachedSelector(state, ...args);
        if (isEqual(prevValue, payload)) return;
        emitter({ payload, prevPayload: prevValue });
        prevValue = payload;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("Selector channel error", e);
      }
    };

    compute();
    return store.subscribe(compute);
  });
}

function* takeEveryFromSelectorImpl<R, ARGS extends any[]>(
  selector: MainStoreSelector<R, ARGS>,
  args: ARGS,
  worker: SelectorWorkerSaga<R>,
) {
  const channel = createChannelFromSelector(selector, ...args);
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
 * Mirrors the renderer's `takeEveryFromSelector` API.
 */
export function takeEveryFromSelector<R>(
  selector: MainStoreSelector<R, []>,
  worker: SelectorWorkerSaga<R>,
): Generator<any, Task, any>;

export function takeEveryFromSelector<R, ARGS extends any[]>(
  selector: MainStoreSelector<R, ARGS>,
  args: ARGS,
  worker: SelectorWorkerSaga<R>,
): Generator<any, Task, any>;

export function* takeEveryFromSelector<R, ARGS extends any[]>(
  selector: MainStoreSelector<R, ARGS>,
  argsOrWorker: ARGS | SelectorWorkerSaga<R>,
  worker?: SelectorWorkerSaga<R>,
): Generator<any, Task, any> {
  const actualArgs = (typeof argsOrWorker === "function" ? [] : argsOrWorker) as ARGS;
  const actualWorker = (
    typeof argsOrWorker === "function" ? argsOrWorker : worker
  ) as SelectorWorkerSaga<R>;

  return yield* fork(takeEveryFromSelectorImpl, selector, actualArgs, actualWorker);
}

function* takeLatestFromSelectorImpl<R, ARGS extends any[]>(
  selector: MainStoreSelector<R, ARGS>,
  args: ARGS,
  worker: SelectorWorkerSaga<R>,
) {
  const channel = createChannelFromSelector(selector, ...args);
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
 * Forks a task that cancels previous worker and spawns a new one for each
 * selector value change. Mirrors the renderer's `takeLatestFromSelector` API.
 */
export function takeLatestFromSelector<R>(
  selector: MainStoreSelector<R, []>,
  worker: SelectorWorkerSaga<R>,
): Generator<any, Task, any>;

export function takeLatestFromSelector<R, ARGS extends any[]>(
  selector: MainStoreSelector<R, ARGS>,
  args: ARGS,
  worker: SelectorWorkerSaga<R>,
): Generator<any, Task, any>;

export function* takeLatestFromSelector<R, ARGS extends any[]>(
  selector: MainStoreSelector<R, ARGS>,
  argsOrWorker: ARGS | SelectorWorkerSaga<R>,
  worker?: SelectorWorkerSaga<R>,
): Generator<any, Task, any> {
  const actualArgs = (typeof argsOrWorker === "function" ? [] : argsOrWorker) as ARGS;
  const actualWorker = (
    typeof argsOrWorker === "function" ? argsOrWorker : worker
  ) as SelectorWorkerSaga<R>;

  return yield* fork(takeLatestFromSelectorImpl, selector, actualArgs, actualWorker);
}

