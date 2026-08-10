import type { ActionMatchingPattern, ActionPattern, Saga } from '@redux-saga/types';
import type { StoreAction } from '@augmentcode/themis/utils/store/create-action';
import type { TakeableChannel, Task } from 'redux-saga';
import { cancel, fork, take, type SagaGenerator } from 'typed-redux-saga';

type ContextWorker<PrefixArgs extends unknown[], Message> = Saga<[...PrefixArgs, Message]>;
type ContextSource<Message> = ActionPattern | TakeableChannel<Message>;

type WorkerSlot = {
  task?: Task;
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
