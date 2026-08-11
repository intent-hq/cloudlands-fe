import type { ActionMatchingPattern, ActionPattern, Saga } from '@redux-saga/types';
import type { StoreAction } from '@augmentcode/themis/utils/store/create-action';
import type { TakeableChannel, Task } from 'redux-saga';
import { cancel, fork, take, type SagaGenerator } from 'typed-redux-saga';

type ContextWorker<PrefixArgs extends unknown[], Message> = Saga<[...PrefixArgs, Message]>;
type ContextSource<Message> = ActionPattern | TakeableChannel<Message>;
type ContextDirective = string | { context: string; cancel: true };

type WorkerSlot = {
  task?: Task;
};

type SingleFlightSlot<Message> = WorkerSlot & {
  hasTrailing: boolean;
  trailing?: Message;
};

function* watchInContext<Message, PrefixArgs extends unknown[]>(
  mode: 'latest' | 'leading',
  source: ContextSource<Message>,
  getContext: (message: Message) => string,
  worker: ContextWorker<PrefixArgs, Message>,
  args: PrefixArgs,
): SagaGenerator<never> {
  const slots = new Map<string, WorkerSlot>();

  while (true) {
    const message = yield* take(source as TakeableChannel<Message>);
    const context = getContext(message);
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
        yield* worker(...args, message);
      } finally {
        if (slots.get(context) === slot) slots.delete(context);
      }
    });
    slot.task = task;

    if (!task.isRunning() && slots.get(context) === slot) slots.delete(context);
  }
}

function* watchSingleFlightInContext<Message, PrefixArgs extends unknown[]>(
  source: ContextSource<Message>,
  getContext: (message: Message) => ContextDirective,
  worker: ContextWorker<PrefixArgs, Message>,
  args: PrefixArgs,
): SagaGenerator<never> {
  const slots = new Map<string, SingleFlightSlot<Message>>();

  try {
    while (true) {
      const message = yield* take(source as TakeableChannel<Message>);
      const directive = getContext(message);
      const context = typeof directive === 'string' ? directive : directive.context;
      const current = slots.get(context);

      if (typeof directive !== 'string') {
        if (current) {
          slots.delete(context);
          if (current.task?.isRunning()) yield* cancel(current.task);
        }
        continue;
      }
      if (current) {
        current.trailing = message;
        current.hasTrailing = true;
        continue;
      }

      const slot: SingleFlightSlot<Message> = { hasTrailing: false };
      slots.set(context, slot);
      const task = yield* fork(function* singleFlightContextWorker() {
        let next = message;
        try {
          while (true) {
            yield* worker(...args, next);
            if (slots.get(context) !== slot || !slot.hasTrailing) return;
            next = slot.trailing as Message;
            slot.trailing = undefined;
            slot.hasTrailing = false;
          }
        } finally {
          if (slots.get(context) === slot) slots.delete(context);
        }
      });
      slot.task = task;

      if (!task.isRunning() && slots.get(context) === slot) slots.delete(context);
    }
  } finally {
    slots.clear();
  }
}

export function takeLatestInContext<P extends ActionPattern, PrefixArgs extends unknown[]>(
  pattern: P,
  getContext: (action: ActionMatchingPattern<P>) => string,
  worker: ContextWorker<PrefixArgs, ActionMatchingPattern<P>>,
  ...args: PrefixArgs
): SagaGenerator<Task>;
export function takeLatestInContext<Message, PrefixArgs extends unknown[]>(
  channel: TakeableChannel<Message>,
  getContext: (message: Message) => string,
  worker: ContextWorker<PrefixArgs, Message>,
  ...args: PrefixArgs
): SagaGenerator<Task>;
export function* takeLatestInContext<Message, PrefixArgs extends unknown[]>(
  source: ContextSource<Message>,
  getContext: (message: Message) => string,
  worker: ContextWorker<PrefixArgs, Message>,
  ...args: PrefixArgs
): SagaGenerator<Task> {
  return yield* fork(function* latestInContextWatcher() {
    yield* watchInContext('latest', source, getContext, worker, args);
  });
}

export function takeLeadingInContext<P extends ActionPattern, PrefixArgs extends unknown[]>(
  pattern: P,
  getContext: (action: ActionMatchingPattern<P>) => string,
  worker: ContextWorker<PrefixArgs, ActionMatchingPattern<P>>,
  ...args: PrefixArgs
): SagaGenerator<Task>;
export function takeLeadingInContext<Message, PrefixArgs extends unknown[]>(
  channel: TakeableChannel<Message>,
  getContext: (message: Message) => string,
  worker: ContextWorker<PrefixArgs, Message>,
  ...args: PrefixArgs
): SagaGenerator<Task>;
export function* takeLeadingInContext<Message, PrefixArgs extends unknown[]>(
  source: ContextSource<Message>,
  getContext: (message: Message) => string,
  worker: ContextWorker<PrefixArgs, Message>,
  ...args: PrefixArgs
): SagaGenerator<Task> {
  return yield* fork(function* leadingInContextWatcher() {
    yield* watchInContext('leading', source, getContext, worker, args);
  });
}

/**
 * Starts the first message for each context immediately and retains only the latest
 * message received while that context is running for one trailing rerun. Returning
 * `{ context, cancel: true }` cancels and retires that context without running queued
 * trailing work. Workers remain attached to the watcher, and caller-owned channels
 * are never closed.
 */
export function takeSingleFlightInContext<P extends ActionPattern, PrefixArgs extends unknown[]>(
  pattern: P,
  getContext: (action: ActionMatchingPattern<P>) => ContextDirective,
  worker: ContextWorker<PrefixArgs, ActionMatchingPattern<P>>,
  ...args: PrefixArgs
): SagaGenerator<Task>;
export function takeSingleFlightInContext<Message, PrefixArgs extends unknown[]>(
  channel: TakeableChannel<Message>,
  getContext: (message: Message) => ContextDirective,
  worker: ContextWorker<PrefixArgs, Message>,
  ...args: PrefixArgs
): SagaGenerator<Task>;
export function* takeSingleFlightInContext<Message, PrefixArgs extends unknown[]>(
  source: ContextSource<Message>,
  getContext: (message: Message) => ContextDirective,
  worker: ContextWorker<PrefixArgs, Message>,
  ...args: PrefixArgs
): SagaGenerator<Task> {
  return yield* fork(function* singleFlightInContextWatcher() {
    yield* watchSingleFlightInContext(source, getContext, worker, args);
  });
}

export function* takeLatestByWorkspace<P extends ActionPattern, PrefixArgs extends unknown[]>(
  pattern: ActionMatchingPattern<P> extends StoreAction<[string, ...unknown[]]> ? P : never,
  worker: ContextWorker<PrefixArgs, ActionMatchingPattern<P>>,
  ...args: PrefixArgs
): SagaGenerator<Task> {
  return yield* takeLatestInContext(
    pattern,
    (action) => (action as StoreAction<[string, ...unknown[]]>).payload[0],
    worker,
    ...args,
  );
}

export function* takeLeadingByWorkspace<P extends ActionPattern, PrefixArgs extends unknown[]>(
  pattern: ActionMatchingPattern<P> extends StoreAction<[string, ...unknown[]]> ? P : never,
  worker: ContextWorker<PrefixArgs, ActionMatchingPattern<P>>,
  ...args: PrefixArgs
): SagaGenerator<Task> {
  return yield* takeLeadingInContext(
    pattern,
    (action) => (action as StoreAction<[string, ...unknown[]]>).payload[0],
    worker,
    ...args,
  );
}

export function* takeLatestByAgent<P extends ActionPattern, PrefixArgs extends unknown[]>(
  pattern: ActionMatchingPattern<P> extends StoreAction<{ agentId: string }> ? P : never,
  worker: ContextWorker<PrefixArgs, ActionMatchingPattern<P>>,
  ...args: PrefixArgs
): SagaGenerator<Task> {
  return yield* takeLatestInContext(
    pattern,
    (action) => (action as StoreAction<{ agentId: string }>).payload.agentId,
    worker,
    ...args,
  );
}

export function* takeLeadingByAgent<P extends ActionPattern, PrefixArgs extends unknown[]>(
  pattern: ActionMatchingPattern<P> extends StoreAction<{ agentId: string }> ? P : never,
  worker: ContextWorker<PrefixArgs, ActionMatchingPattern<P>>,
  ...args: PrefixArgs
): SagaGenerator<Task> {
  return yield* takeLeadingInContext(
    pattern,
    (action) => (action as StoreAction<{ agentId: string }>).payload.agentId,
    worker,
    ...args,
  );
}
