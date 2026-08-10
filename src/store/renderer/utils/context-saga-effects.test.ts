import type { Action } from '@redux-saga/types';
import { channel, runSaga, stdChannel } from 'redux-saga';
import { call, cancelled } from 'typed-redux-saga';
import { describe, expect, it, vi } from 'vitest';

import { takeLatestInContext, takeLeadingInContext } from './context-saga-effects';

type WorkMessage = { context: string; id: string };
type WorkAction = Action<'work'> & WorkMessage;

const isWorkAction = (action: Action): action is WorkAction => action.type === 'work';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function createWorkerHarness() {
  const started: string[] = [];
  const finished: string[] = [];
  const canceled: string[] = [];
  const gates = new Map<string, ReturnType<typeof deferred>>();

  function addGate(id: string) {
    const gate = deferred();
    gates.set(id, gate);
    return gate;
  }

  function* worker(prefix: string, message: WorkMessage): Generator {
    started.push(`${prefix}:${message.id}`);
    try {
      yield* call(() => gates.get(message.id)!.promise);
      finished.push(message.id);
    } finally {
      if (yield* cancelled()) canceled.push(message.id);
    }
  }

  return { addGate, canceled, finished, started, worker };
}

describe('context-scoped saga effects', () => {
  it('runs latest work independently and cancels only stale same-context work', async () => {
    const input = stdChannel();
    const harness = createWorkerHarness();
    const a1 = harness.addGate('a1');
    const b1 = harness.addGate('b1');
    const a2 = harness.addGate('a2');
    harness.addGate('a3');
    const task = runSaga({ channel: input, dispatch: vi.fn(), getState: () => ({}) }, function* () {
      yield* takeLatestInContext(isWorkAction, (action) => action.context, harness.worker, 'run');
    });
    await settle();

    input.put({ type: 'work', context: 'a', id: 'a1' });
    await settle();
    input.put({ type: 'work', context: 'b', id: 'b1' });
    await settle();
    input.put({ type: 'work', context: 'a', id: 'a2' });
    await settle();

    expect(harness.started).toEqual(['run:a1', 'run:b1', 'run:a2']);
    expect(harness.canceled).toEqual(['a1']);

    b1.resolve();
    a2.resolve();
    await settle();
    input.put({ type: 'work', context: 'a', id: 'a3' });
    await settle();

    expect(harness.finished).toEqual(['b1', 'a2']);
    expect(harness.started).toContain('run:a3');

    task.cancel();
    await task.toPromise();
    expect(harness.canceled).toEqual(['a1', 'a3']);
    a1.resolve();
  });

  it('drops leading work only while the same context is running', async () => {
    const input = stdChannel();
    const harness = createWorkerHarness();
    const a1 = harness.addGate('a1');
    harness.addGate('a2');
    harness.addGate('a3');
    harness.addGate('b1');
    const task = runSaga({ channel: input, dispatch: vi.fn(), getState: () => ({}) }, function* () {
      yield* takeLeadingInContext(isWorkAction, (action) => action.context, harness.worker, 'run');
    });
    await settle();

    input.put({ type: 'work', context: 'a', id: 'a1' });
    await settle();
    input.put({ type: 'work', context: 'a', id: 'a2' });
    await settle();
    input.put({ type: 'work', context: 'b', id: 'b1' });
    await settle();

    expect(harness.started).toEqual(['run:a1', 'run:b1']);

    a1.resolve();
    await settle();
    input.put({ type: 'work', context: 'a', id: 'a3' });
    await settle();

    expect(harness.started).toEqual(['run:a1', 'run:b1', 'run:a3']);

    task.cancel();
    await task.toPromise();
    expect(harness.canceled).toHaveLength(2);
    expect(harness.canceled).toEqual(expect.arrayContaining(['b1', 'a3']));
  });

  it('removes completed slots even when workers finish synchronously', async () => {
    const input = stdChannel();
    const handled: string[] = [];
    const task = runSaga({ channel: input, dispatch: vi.fn(), getState: () => ({}) }, function* () {
      yield* takeLeadingInContext(
        isWorkAction,
        (action) => action.context,
        function* worker(action: WorkAction) {
          handled.push(action.id);
        },
      );
    });
    await settle();

    input.put({ type: 'work', context: 'a', id: 'a1' });
    await settle();
    input.put({ type: 'work', context: 'a', id: 'a2' });
    await settle();

    expect(handled).toEqual(['a1', 'a2']);

    task.cancel();
    await task.toPromise();
  });

  it('propagates worker failures through attached watcher tasks', async () => {
    const input = stdChannel();
    const error = new Error('worker failed');
    const onError = vi.fn();
    const task = runSaga(
      { channel: input, dispatch: vi.fn(), getState: () => ({}), onError },
      function* () {
        yield* takeLatestInContext(
          isWorkAction,
          (action) => action.context,
          function* worker() {
            throw error;
          },
        );
      },
    );
    const completion = task.toPromise();
    await settle();

    input.put({ type: 'work', context: 'a', id: 'a1' });

    await expect(completion).rejects.toBe(error);
    expect(onError).toHaveBeenCalledWith(error, expect.any(Object));
  });

  it('runs latest channel work independently and cancels only stale same-context work', async () => {
    const input = channel<WorkMessage>();
    const harness = createWorkerHarness();
    const a1 = harness.addGate('a1');
    const b1 = harness.addGate('b1');
    const a2 = harness.addGate('a2');
    harness.addGate('a3');
    const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, function* () {
      yield* takeLatestInContext(input, (message) => message.context, harness.worker, 'run');
    });
    await settle();

    input.put({ context: 'a', id: 'a1' });
    await settle();
    input.put({ context: 'b', id: 'b1' });
    await settle();
    input.put({ context: 'a', id: 'a2' });
    await settle();

    expect(harness.started).toEqual(['run:a1', 'run:b1', 'run:a2']);
    expect(harness.canceled).toEqual(['a1']);

    b1.resolve();
    a2.resolve();
    await settle();
    input.put({ context: 'a', id: 'a3' });
    await settle();

    expect(harness.finished).toEqual(['b1', 'a2']);
    expect(harness.started).toContain('run:a3');

    task.cancel();
    await task.toPromise();
    expect(harness.canceled).toEqual(['a1', 'a3']);
    a1.resolve();
  });

  it('drops leading channel work only while the same context is running', async () => {
    const input = channel<WorkMessage>();
    const harness = createWorkerHarness();
    const a1 = harness.addGate('a1');
    harness.addGate('a2');
    harness.addGate('a3');
    harness.addGate('b1');
    const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, function* () {
      yield* takeLeadingInContext(input, (message) => message.context, harness.worker, 'run');
    });
    await settle();

    input.put({ context: 'a', id: 'a1' });
    await settle();
    input.put({ context: 'a', id: 'a2' });
    await settle();
    input.put({ context: 'b', id: 'b1' });
    await settle();

    expect(harness.started).toEqual(['run:a1', 'run:b1']);

    a1.resolve();
    await settle();
    input.put({ context: 'a', id: 'a3' });
    await settle();

    expect(harness.started).toEqual(['run:a1', 'run:b1', 'run:a3']);

    task.cancel();
    await task.toPromise();
    expect(harness.canceled).toHaveLength(2);
    expect(harness.canceled).toEqual(expect.arrayContaining(['b1', 'a3']));
  });

  it('reuses channel context keys after synchronous workers complete', async () => {
    const input = channel<WorkMessage>();
    const handled: string[] = [];
    const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, function* () {
      yield* takeLeadingInContext(
        input,
        (message) => message.context,
        function* worker(message: WorkMessage) {
          handled.push(message.id);
        },
      );
    });
    await settle();

    input.put({ context: 'a', id: 'a1' });
    await settle();
    input.put({ context: 'a', id: 'a2' });
    await settle();

    expect(handled).toEqual(['a1', 'a2']);

    task.cancel();
    await task.toPromise();
  });

  it('propagates channel worker failures through attached watcher tasks', async () => {
    const input = channel<WorkMessage>();
    const error = new Error('worker failed');
    const onError = vi.fn();
    const task = runSaga({ dispatch: vi.fn(), getState: () => ({}), onError }, function* () {
      yield* takeLatestInContext(
        input,
        (message) => message.context,
        function* worker() {
          throw error;
        },
      );
    });
    const completion = task.toPromise();
    await settle();

    input.put({ context: 'a', id: 'a1' });

    await expect(completion).rejects.toBe(error);
    expect(onError).toHaveBeenCalledWith(error, expect.any(Object));
  });

  it('cancels attached channel workers with the parent without closing the caller channel', async () => {
    const input = channel<WorkMessage>();
    const close = vi.spyOn(input, 'close');
    const harness = createWorkerHarness();
    harness.addGate('a1');
    const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, function* () {
      yield* takeLatestInContext(input, (message) => message.context, harness.worker, 'run');
    });
    await settle();

    input.put({ context: 'a', id: 'a1' });
    await settle();
    task.cancel();
    await task.toPromise();

    expect(harness.canceled).toEqual(['a1']);
    expect(close).not.toHaveBeenCalled();

    const observer = vi.fn();
    const message = { context: 'after-cancel', id: 'still-open' };
    input.take(observer);
    input.put(message);
    expect(observer).toHaveBeenCalledWith(message);

    input.close();
  });

  it('terminates naturally when the caller closes the channel', async () => {
    const input = channel<WorkMessage>();
    const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, function* () {
      yield* takeLeadingInContext(
        input,
        (message) => message.context,
        function* worker() {},
      );
    });
    await settle();

    input.close();
    await expect(task.toPromise()).resolves.toBeUndefined();
    expect(task.isCancelled()).toBe(false);
  });
});
