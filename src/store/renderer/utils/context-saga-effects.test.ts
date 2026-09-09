import type { Action } from '@redux-saga/types';
import { buffers, channel, runSaga, stdChannel } from 'redux-saga';
import { call, cancelled } from 'typed-redux-saga';
import { describe, expect, it, vi } from 'vitest';

import {
  takeEveryByContextFIFO,
  takeLatestByContext,
  takeLatestInContext,
  takeLeadingInContext,
  takeSingleFlightInContext,
} from './context-saga-effects';

type WorkMessage = { context: string; id: string; cancel?: boolean; generation?: number };
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

  it('deduplicates active generations and replaces them only with newer context work', async () => {
    const input = stdChannel();
    const harness = createWorkerHarness();
    harness.addGate('a1');
    harness.addGate('a1-duplicate');
    harness.addGate('a0');
    harness.addGate('b1');
    harness.addGate('a2');
    const task = runSaga({ channel: input, dispatch: vi.fn(), getState: () => ({}) }, function* () {
      yield* takeLatestByContext(
        isWorkAction,
        (action) => ({ context: action.context, generation: action.generation ?? 0 }),
        harness.worker,
        'run',
      );
    });
    await settle();

    input.put({ type: 'work', context: 'a', id: 'a1', generation: 1 });
    await settle();
    input.put({ type: 'work', context: 'a', id: 'a1-duplicate', generation: 1 });
    input.put({ type: 'work', context: 'a', id: 'a0', generation: 0 });
    input.put({ type: 'work', context: 'b', id: 'b1', generation: 1 });
    await settle();
    input.put({ type: 'work', context: 'a', id: 'a2', generation: 2 });
    await settle();

    expect(harness.started).toEqual(['run:a1', 'run:b1', 'run:a2']);
    expect(harness.canceled).toEqual(['a1']);

    task.cancel();
    await task.toPromise();
    expect(harness.canceled).toEqual(['a1', 'b1', 'a2']);
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

  it('runs one latest trailing message per busy context without blocking other contexts', async () => {
    const input = stdChannel();
    const harness = createWorkerHarness();
    const a1 = harness.addGate('a1');
    harness.addGate('a2');
    const a3 = harness.addGate('a3');
    const b1 = harness.addGate('b1');
    const task = runSaga({ channel: input, dispatch: vi.fn(), getState: () => ({}) }, function* () {
      yield* takeSingleFlightInContext(
        isWorkAction,
        (action) => action.context,
        harness.worker,
        'run',
      );
    });
    await settle();

    input.put({ type: 'work', context: 'a', id: 'a1' });
    await settle();
    input.put({ type: 'work', context: 'a', id: 'a2' });
    input.put({ type: 'work', context: 'a', id: 'a3' });
    input.put({ type: 'work', context: 'b', id: 'b1' });
    await settle();

    expect(harness.started).toEqual(['run:a1', 'run:b1']);
    a1.resolve();
    await settle();
    expect(harness.started).toEqual(['run:a1', 'run:b1', 'run:a3']);

    a3.resolve();
    b1.resolve();
    await settle();
    expect(harness.finished).toEqual(expect.arrayContaining(['a1', 'a3', 'b1']));
    expect(harness.started).not.toContain('run:a2');

    task.cancel();
    await task.toPromise();
  });

  it('cancels a context without restarting trailing work and permits later key reuse', async () => {
    const input = stdChannel();
    const harness = createWorkerHarness();
    harness.addGate('a1');
    harness.addGate('a2');
    harness.addGate('a3');
    const task = runSaga({ channel: input, dispatch: vi.fn(), getState: () => ({}) }, function* () {
      yield* takeSingleFlightInContext(
        isWorkAction,
        (action) => (action.cancel ? { context: action.context, cancel: true } : action.context),
        harness.worker,
        'run',
      );
    });
    await settle();

    input.put({ type: 'work', context: 'a', id: 'a1' });
    await settle();
    input.put({ type: 'work', context: 'a', id: 'a2' });
    input.put({ type: 'work', context: 'a', id: 'cancel', cancel: true });
    await settle();

    expect(harness.started).toEqual(['run:a1']);
    expect(harness.canceled).toEqual(['a1']);
    input.put({ type: 'work', context: 'a', id: 'a3' });
    await settle();
    expect(harness.started).toEqual(['run:a1', 'run:a3']);

    task.cancel();
    await task.toPromise();
    expect(harness.canceled).toEqual(['a1', 'a3']);
  });

  it('processes lossless same-context bursts in FIFO order while other contexts run', async () => {
    const input = stdChannel();
    const harness = createWorkerHarness();
    const a1 = harness.addGate('a1');
    const a2 = harness.addGate('a2');
    const a3 = harness.addGate('a3');
    const b1 = harness.addGate('b1');
    const task = runSaga({ channel: input, dispatch: vi.fn(), getState: () => ({}) }, function* () {
      yield* takeEveryByContextFIFO(
        isWorkAction,
        (action) => action.context,
        harness.worker,
        {},
        'run',
      );
    });
    await settle();

    input.put({ type: 'work', context: 'a', id: 'a1' });
    input.put({ type: 'work', context: 'a', id: 'a2' });
    input.put({ type: 'work', context: 'a', id: 'a3' });
    input.put({ type: 'work', context: 'b', id: 'b1' });
    await settle();

    expect(harness.started).toEqual(['run:a1', 'run:b1']);
    b1.resolve();
    await settle();
    expect(harness.finished).toEqual(['b1']);
    expect(harness.started).toEqual(['run:a1', 'run:b1']);

    a1.resolve();
    await settle();
    expect(harness.started).toEqual(['run:a1', 'run:b1', 'run:a2']);
    a2.resolve();
    await settle();
    expect(harness.started).toEqual(['run:a1', 'run:b1', 'run:a2', 'run:a3']);
    a3.resolve();
    await settle();
    expect(harness.finished).toEqual(['b1', 'a1', 'a2', 'a3']);

    task.cancel();
    await task.toPromise();
  });

  it('reuses FIFO context keys after synchronous workers complete', async () => {
    const input = stdChannel();
    const handled: string[] = [];
    const task = runSaga({ channel: input, dispatch: vi.fn(), getState: () => ({}) }, function* () {
      yield* takeEveryByContextFIFO(
        isWorkAction,
        (action) => action.context,
        function* worker(action: WorkAction) {
          handled.push(action.id);
        },
        {},
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

  it('cancels active FIFO work, discards pending messages once, and preserves caller channels', async () => {
    const input = channel<WorkMessage>(buffers.expanding());
    const close = vi.spyOn(input, 'close');
    const harness = createWorkerHarness();
    harness.addGate('a1');
    harness.addGate('a2');
    harness.addGate('a3');
    const discarded: string[] = [];
    const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, function* () {
      yield* takeEveryByContextFIFO(
        input,
        (message) => message.context,
        harness.worker,
        {
          onDiscardPending: function* discard(message) {
            discarded.push(message.id);
          },
        },
        'run',
      );
    });
    await settle();

    input.put({ context: 'a', id: 'a1' });
    await settle();
    input.put({ context: 'a', id: 'a2' });
    await settle();
    input.put({ context: 'a', id: 'a3' });
    await settle();
    task.cancel();
    await task.toPromise();

    expect(harness.canceled).toEqual(['a1']);
    expect(discarded).toEqual(['a2', 'a3']);
    expect(close).not.toHaveBeenCalled();
    const observer = vi.fn();
    const message = { context: 'after-cancel', id: 'still-open' };
    input.take(observer);
    input.put(message);
    expect(observer).toHaveBeenCalledWith(message);
    input.close();
  });

  it('runs every pending cleanup after one fails and propagates the first cleanup error', async () => {
    const input = stdChannel();
    const cleanupError = new Error('pending cleanup failed');
    const workerError = new Error('worker failed before pending cleanup');
    let rejectWorker!: (error: Error) => void;
    const workerGate = new Promise<void>((_resolve, reject) => {
      rejectWorker = reject;
    });
    const onError = vi.fn();
    const discarded: string[] = [];
    const task = runSaga(
      { channel: input, dispatch: vi.fn(), getState: () => ({}), onError },
      function* () {
        yield* takeEveryByContextFIFO(
          isWorkAction,
          (action) => action.context,
          function* worker() {
            yield* call(() => workerGate);
          },
          {
            onDiscardPending: function* discard(action) {
              discarded.push(action.id);
              if (action.id === 'a2') throw cleanupError;
            },
          },
        );
      },
    );
    const completion = task.toPromise();
    await settle();

    input.put({ type: 'work', context: 'a', id: 'a1' });
    await settle();
    input.put({ type: 'work', context: 'a', id: 'a2' });
    await settle();
    input.put({ type: 'work', context: 'a', id: 'a3' });
    await settle();
    rejectWorker(workerError);

    await expect(completion).rejects.toBe(cleanupError);
    expect(discarded).toEqual(['a2', 'a3']);
    expect(onError).toHaveBeenCalledWith(cleanupError, expect.any(Object));
  });

  it('discards pending FIFO work and propagates worker failures through attached tasks', async () => {
    const input = stdChannel();
    const workerError = new Error('FIFO worker failed');
    let rejectWorker!: (error: Error) => void;
    const workerGate = new Promise<void>((_resolve, reject) => {
      rejectWorker = reject;
    });
    const discarded: string[] = [];
    const onError = vi.fn();
    const task = runSaga(
      { channel: input, dispatch: vi.fn(), getState: () => ({}), onError },
      function* () {
        yield* takeEveryByContextFIFO(
          isWorkAction,
          (action) => action.context,
          function* worker() {
            yield* call(() => workerGate);
          },
          {
            onDiscardPending: function* discard(action) {
              discarded.push(action.id);
            },
          },
        );
      },
    );
    const completion = task.toPromise();
    await settle();

    input.put({ type: 'work', context: 'a', id: 'a1' });
    input.put({ type: 'work', context: 'a', id: 'a2' });
    await settle();
    rejectWorker(workerError);

    await expect(completion).rejects.toBe(workerError);
    expect(discarded).toEqual(['a2']);
    expect(onError).toHaveBeenCalledWith(workerError, expect.any(Object));
  });

  it('drains accepted FIFO channel work after END without closing the caller channel again', async () => {
    const input = channel<WorkMessage>();
    const close = vi.spyOn(input, 'close');
    const harness = createWorkerHarness();
    const a1 = harness.addGate('a1');
    const a2 = harness.addGate('a2');
    const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, function* () {
      yield* takeEveryByContextFIFO(input, (message) => message.context, harness.worker, {}, 'run');
    });
    const completion = task.toPromise();
    await settle();

    input.put({ context: 'a', id: 'a1' });
    input.put({ context: 'a', id: 'a2' });
    await settle();
    input.close();
    await settle();
    expect(harness.started).toEqual(['run:a1']);

    a1.resolve();
    await settle();
    expect(harness.started).toEqual(['run:a1', 'run:a2']);
    a2.resolve();

    await expect(completion).resolves.toBeUndefined();
    expect(task.isCancelled()).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('completes an idle single-flight watcher on caller-owned channel END', async () => {
    const input = channel<WorkMessage>();
    const close = vi.spyOn(input, 'close');
    const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, function* () {
      yield* takeSingleFlightInContext(
        input,
        (message) => message.context,
        function* worker() {},
      );
    });
    const completion = task.toPromise();
    await settle();

    input.close();

    await expect(completion).resolves.toBeUndefined();
    expect(task.isCancelled()).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('drains accepted single-flight trailing work once after caller-owned channel END', async () => {
    const input = channel<WorkMessage>();
    const close = vi.spyOn(input, 'close');
    const harness = createWorkerHarness();
    const a1 = harness.addGate('a1');
    const a2 = harness.addGate('a2');
    const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, function* () {
      yield* takeSingleFlightInContext(input, (message) => message.context, harness.worker, 'run');
    });
    const completion = task.toPromise();
    await settle();

    input.put({ context: 'a', id: 'a1' });
    await settle();
    input.put({ context: 'a', id: 'a2' });
    await settle();
    input.close();
    input.put({ context: 'a', id: 'a3' });
    await settle();

    expect(harness.started).toEqual(['run:a1']);
    a1.resolve();
    await settle();
    expect(harness.started).toEqual(['run:a1', 'run:a2']);
    a2.resolve();

    await expect(completion).resolves.toBeUndefined();
    expect(harness.finished).toEqual(['a1', 'a2']);
    expect(task.isCancelled()).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('propagates unhandled single-flight worker failures through attached tasks', async () => {
    const input = stdChannel();
    const error = new Error('single-flight worker failed');
    const onError = vi.fn();
    const task = runSaga(
      { channel: input, dispatch: vi.fn(), getState: () => ({}), onError },
      function* () {
        yield* takeSingleFlightInContext(
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

  it('keeps single-flight channel workers attached without closing the caller channel', async () => {
    const input = channel<WorkMessage>();
    const close = vi.spyOn(input, 'close');
    const harness = createWorkerHarness();
    harness.addGate('a1');
    harness.addGate('a2');
    const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, function* () {
      yield* takeSingleFlightInContext(input, (message) => message.context, harness.worker, 'run');
    });
    await settle();

    input.put({ context: 'a', id: 'a1' });
    await settle();
    input.put({ context: 'a', id: 'a2' });
    task.cancel();
    await task.toPromise();

    expect(harness.started).toEqual(['run:a1']);
    expect(harness.canceled).toEqual(['a1']);
    expect(close).not.toHaveBeenCalled();
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
