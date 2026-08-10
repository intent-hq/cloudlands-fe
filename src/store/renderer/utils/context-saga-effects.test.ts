import type { Action } from '@redux-saga/types';
import { runSaga, stdChannel } from 'redux-saga';
import { call, cancelled } from 'typed-redux-saga';
import { describe, expect, it, vi } from 'vitest';

import { takeLatestInContext, takeLeadingInContext } from './context-saga-effects';

type WorkAction = Action<'work'> & { context: string; id: string };

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

  function* worker(prefix: string, action: WorkAction): Generator {
    started.push(`${prefix}:${action.id}`);
    try {
      yield* call(() => gates.get(action.id)!.promise);
      finished.push(action.id);
    } finally {
      if (yield* cancelled()) canceled.push(action.id);
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
});