import type { ActionMatchingPattern, ActionPattern, Saga } from '@redux-saga/types';
import type { StoreAction } from '@augmentcode/themis/utils/store/create-action';
import type { TakeableChannel, Task } from 'redux-saga';
import { call, cancel, cancelled, fork, take, type SagaGenerator } from 'typed-redux-saga';

type ContextWorker<PrefixArgs extends unknown[], Message> = Saga<[...PrefixArgs, Message]>;
type ContextSource<Message> = ActionPattern | TakeableChannel<Message>;
type ContextDirective = string | { context: string; cancel: true };
type VersionedContext = { context: string; generation: number };

type WorkerSlot = {
  task?: Task;
};

type VersionedWorkerSlot = WorkerSlot & {
  generation: number;
};

type SingleFlightSlot<Message> = WorkerSlot & {
  hasTrailing: boolean;
  trailing?: Message;
};

type ContextFIFOOptions<Message> = {
  onDiscardPending?: Saga<[Message]>;
};

type FIFOSlot<Message> = {
  pending: Message[];
};

type PendingCleanupResult =
  | { failed: false }
  | {
      failed: true;
      error: unknown;
    };

function* discardPendingMessages<Message>(
  pending: Message[],
  onDiscardPending: Saga<[Message]> | undefined,
): SagaGenerator<PendingCleanupResult> {
  let result: PendingCleanupResult = { failed: false };
  while (pending.length > 0) {
    const message = pending.shift() as Message;
    if (!onDiscardPending) continue;
    try {
      yield* call(onDiscardPending, message);
    } catch (error) {
      if (!result.failed) result = { failed: true, error };
    }
  }
  return result;
}

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

function* watchLatestByContext<Message, PrefixArgs extends unknown[]>(
  source: ContextSource<Message>,
  getContext: (message: Message) => VersionedContext,
  worker: ContextWorker<PrefixArgs, Message>,
  args: PrefixArgs,
): SagaGenerator<never> {
  const slots = new Map<string, VersionedWorkerSlot>();

  while (true) {
    const message = yield* take(source as TakeableChannel<Message>);
    const { context, generation } = getContext(message);
    const current = slots.get(context);
    if (current && current.generation >= generation) continue;
    if (current?.task?.isRunning()) yield* cancel(current.task);

    const slot: VersionedWorkerSlot = { generation };
    slots.set(context, slot);
    const task = yield* fork(function* latestByContextWorker() {
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
    if (yield* cancelled()) slots.clear();
  }
}

function* watchEveryByContextFIFO<Message, PrefixArgs extends unknown[]>(
  source: ContextSource<Message>,
  getContext: (message: Message) => string,
  worker: ContextWorker<PrefixArgs, Message>,
  options: ContextFIFOOptions<Message>,
  args: PrefixArgs,
): SagaGenerator<never> {
  const slots = new Map<string, FIFOSlot<Message>>();

  try {
    while (true) {
      const message = yield* take(source as TakeableChannel<Message>);
      const context = getContext(message);
      const current = slots.get(context);
      if (current) {
        current.pending.push(message);
        continue;
      }

      const slot: FIFOSlot<Message> = { pending: [] };
      slots.set(context, slot);
      const task = yield* fork(function* fifoContextWorker() {
        let next = message;
        try {
          while (true) {
            yield* call(worker, ...args, next);
            if (slot.pending.length === 0) return;
            next = slot.pending.shift() as Message;
          }
        } catch (error) {
          const cleanup = yield* discardPendingMessages(slot.pending, options.onDiscardPending);
          if (cleanup.failed) throw cleanup.error;
          throw error;
        } finally {
          try {
            const cleanup = yield* discardPendingMessages(slot.pending, options.onDiscardPending);
            if (cleanup.failed) throw cleanup.error;
          } finally {
            if (slots.get(context) === slot) slots.delete(context);
          }
        }
      });

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

/**
 * Runs at most one generation per context at a time. Duplicate or older generations
 * are dropped while work is active; a newer generation cancels and replaces it.
 */
export function takeLatestByContext<P extends ActionPattern, PrefixArgs extends unknown[]>(
  pattern: P,
  getContext: (action: ActionMatchingPattern<P>) => VersionedContext,
  worker: ContextWorker<PrefixArgs, ActionMatchingPattern<P>>,
  ...args: PrefixArgs
): SagaGenerator<Task>;
export function takeLatestByContext<Message, PrefixArgs extends unknown[]>(
  channel: TakeableChannel<Message>,
  getContext: (message: Message) => VersionedContext,
  worker: ContextWorker<PrefixArgs, Message>,
  ...args: PrefixArgs
): SagaGenerator<Task>;
export function* takeLatestByContext<Message, PrefixArgs extends unknown[]>(
  source: ContextSource<Message>,
  getContext: (message: Message) => VersionedContext,
  worker: ContextWorker<PrefixArgs, Message>,
  ...args: PrefixArgs
): SagaGenerator<Task> {
  return yield* fork(function* latestByContextWatcher() {
    yield* watchLatestByContext(source, getContext, worker, args);
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
 * are never closed. Natural channel END stops new intake and drains accepted trailing work.
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

/**
 * Runs every accepted message in strict FIFO order within its string context while
 * allowing different contexts to run concurrently. Context workers are attached to
 * the watcher, idle contexts retain no task or Map entry, and caller-owned channels
 * are never closed.
 *
 * On cancellation or worker failure, `onDiscardPending` runs exactly once in FIFO
 * order for each accepted message that has not started. Cleanup continues after hook
 * failures; the first hook failure becomes the context-worker error under native saga
 * error/cancellation propagation. Natural channel END stops new intake but lets
 * accepted work drain normally.
 */
export function takeEveryByContextFIFO<P extends ActionPattern, PrefixArgs extends unknown[]>(
  pattern: P,
  getContext: (action: ActionMatchingPattern<P>) => string,
  worker: ContextWorker<PrefixArgs, ActionMatchingPattern<P>>,
  options: ContextFIFOOptions<ActionMatchingPattern<P>>,
  ...args: PrefixArgs
): SagaGenerator<Task>;
export function takeEveryByContextFIFO<Message, PrefixArgs extends unknown[]>(
  channel: TakeableChannel<Message>,
  getContext: (message: Message) => string,
  worker: ContextWorker<PrefixArgs, Message>,
  options: ContextFIFOOptions<Message>,
  ...args: PrefixArgs
): SagaGenerator<Task>;
export function* takeEveryByContextFIFO<Message, PrefixArgs extends unknown[]>(
  source: ContextSource<Message>,
  getContext: (message: Message) => string,
  worker: ContextWorker<PrefixArgs, Message>,
  options: ContextFIFOOptions<Message>,
  ...args: PrefixArgs
): SagaGenerator<Task> {
  return yield* fork(function* everyByContextFIFOWatcher() {
    yield* watchEveryByContextFIFO(source, getContext, worker, options, args);
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
