import { END, type Channel, type EventChannel, type Task } from 'redux-saga';
import type { NotUndefined } from '@redux-saga/types';
import { call, cancel, delay, fork, take } from 'typed-redux-saga';

type TakeWithBackoffChannel<T extends NotUndefined> = Channel<T> | EventChannel<T>;

export type TakeWithBackoffOptions<T extends NotUndefined> = {
  initialDelayMs: number;
  maxDelayMs: number;
  initialPrevious?: T | null;
  shouldBackoff: (value: T, previous: T | null) => boolean;
};

export type TakeWithBackoffWorker<T extends NotUndefined> = (value: T) => Generator;

function* delayedWorker<T extends NotUndefined>(
  delayMs: number,
  value: T,
  worker: TakeWithBackoffWorker<T>,
): Generator {
  yield* delay(delayMs);
  yield* call(worker, value);
}

export function* takeWithBackoff<T extends NotUndefined>(
  channel: TakeWithBackoffChannel<T>,
  worker: TakeWithBackoffWorker<T>,
  options: TakeWithBackoffOptions<T>,
): Generator<any, void, any> {
  let previous: T | null = options.initialPrevious ?? null;
  let nextDelayMs = options.initialDelayMs;
  let pendingTask: Task | null = null;

  try {
    while (true) {
      const value: T = yield* take(channel);
      if (value === (END as unknown as T)) break;

      if (options.shouldBackoff(value, previous)) {
        if (pendingTask) yield* cancel(pendingTask);
        const delayMs = nextDelayMs;
        nextDelayMs = Math.min(delayMs * 2, options.maxDelayMs);
        pendingTask = yield* fork(delayedWorker<T>, delayMs, value, worker);
      } else {
        if (pendingTask) {
          yield* cancel(pendingTask);
          pendingTask = null;
        }
        nextDelayMs = options.initialDelayMs;
        yield* call(worker, value);
      }

      previous = value;
    }
  } finally {
    if (pendingTask) yield* cancel(pendingTask);
  }
}
