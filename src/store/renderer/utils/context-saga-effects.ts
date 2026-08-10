import type { ActionMatchingPattern, ActionPattern, Saga } from '@redux-saga/types';
import type { Task } from 'redux-saga';
import { cancel, fork, take, type SagaGenerator } from 'typed-redux-saga';

type ContextWorker<PrefixArgs extends unknown[], Action> = Saga<[...PrefixArgs, Action]>;

type WorkerSlot = {
  task?: Task;
};

function* watchInContext<P extends ActionPattern, PrefixArgs extends unknown[]>(
  mode: 'latest' | 'leading',
  pattern: P,
  getContext: (action: ActionMatchingPattern<P>) => string,
  worker: ContextWorker<PrefixArgs, ActionMatchingPattern<P>>,
  args: PrefixArgs,
): SagaGenerator<never> {
  const slots = new Map<string, WorkerSlot>();

  while (true) {
    const action = (yield* take(pattern)) as ActionMatchingPattern<P>;
    const context = getContext(action);
    const current = slots.get(context);

    if (mode === 'leading' && (current?.task?.isRunning() || (current && !current.task))) {
      continue;
    }
    if (current?.task?.isRunning()) {
      yield* cancel(current.task);
    }

    const slot: WorkerSlot = {};
    slots.set(context, slot);
    const task = yield* fork(function* contextWorker() {
      try {
        yield* worker(...args, action);
      } finally {
        if (slots.get(context) === slot) slots.delete(context);
      }
    });
    slot.task = task;

    if (!task.isRunning() && slots.get(context) === slot) slots.delete(context);
  }
}

export function* takeLatestInContext<P extends ActionPattern, PrefixArgs extends unknown[]>(
  pattern: P,
  getContext: (action: ActionMatchingPattern<P>) => string,
  worker: ContextWorker<PrefixArgs, ActionMatchingPattern<P>>,
  ...args: PrefixArgs
): SagaGenerator<Task> {
  return yield* fork(function* latestInContextWatcher() {
    yield* watchInContext('latest', pattern, getContext, worker, args);
  });
}

export function* takeLeadingInContext<P extends ActionPattern, PrefixArgs extends unknown[]>(
  pattern: P,
  getContext: (action: ActionMatchingPattern<P>) => string,
  worker: ContextWorker<PrefixArgs, ActionMatchingPattern<P>>,
  ...args: PrefixArgs
): SagaGenerator<Task> {
  return yield* fork(function* leadingInContextWatcher() {
    yield* watchInContext('leading', pattern, getContext, worker, args);
  });
}
