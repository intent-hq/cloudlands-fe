import { describe, expect, it, vi } from 'vitest';

import {
  createActionRingBufferMiddleware,
  createActionTypeRingBuffer,
  rendererActionTypeRingBuffer,
} from './action-ring-buffer';

/** Contract from the task spec: the shared renderer buffer keeps the last 20 action types. */
const SPEC_DEFAULT_CAPACITY = 20;

function dispatchThrough(
  middleware: ReturnType<typeof createActionRingBufferMiddleware>,
  action: unknown,
) {
  const store = { getState: () => ({}), dispatch: vi.fn() };
  const next = vi.fn((a: unknown) => a);
  const result = (middleware as any)(store)(next)(action);
  return { next, result };
}

describe('createActionTypeRingBuffer', () => {
  it('returns types oldest first and drops the oldest past capacity', () => {
    const buffer = createActionTypeRingBuffer(3);
    buffer.push('a');
    buffer.push('b');
    expect(buffer.snapshot()).toEqual(['a', 'b']);

    buffer.push('c');
    buffer.push('d');
    buffer.push('e');
    expect(buffer.snapshot()).toEqual(['c', 'd', 'e']);
  });

  it('clears retained types', () => {
    const buffer = createActionTypeRingBuffer(2);
    buffer.push('a');
    buffer.clear();
    expect(buffer.snapshot()).toEqual([]);
    buffer.push('b');
    expect(buffer.snapshot()).toEqual(['b']);
  });

  it('rejects a non-positive capacity', () => {
    expect(() => createActionTypeRingBuffer(0)).toThrow();
    expect(() => createActionTypeRingBuffer(1.5)).toThrow();
  });
});

describe('createActionRingBufferMiddleware', () => {
  it('records action types only and passes the action through unchanged', () => {
    const buffer = createActionTypeRingBuffer(5);
    const middleware = createActionRingBufferMiddleware(buffer);
    const action = { type: 'tabState/setCurrentTab', payload: { secret: 'body' } };

    const { next, result } = dispatchThrough(middleware, action);

    expect(next).toHaveBeenCalledWith(action);
    expect(result).toBe(action);
    expect(buffer.snapshot()).toEqual(['tabState/setCurrentTab']);
    expect(JSON.stringify(buffer.snapshot())).not.toContain('secret');
  });

  it('skips actions without a string type but still forwards them', () => {
    const buffer = createActionTypeRingBuffer(5);
    const middleware = createActionRingBufferMiddleware(buffer);
    const thunk = () => undefined;

    dispatchThrough(middleware, thunk);
    dispatchThrough(middleware, { type: 42 });
    dispatchThrough(middleware, null);
    const { next } = dispatchThrough(middleware, { type: 'ok/action' });

    expect(next).toHaveBeenCalledWith({ type: 'ok/action' });
    expect(buffer.snapshot()).toEqual(['ok/action']);
  });

  it('retains at most the buffer capacity across many dispatches', () => {
    const buffer = createActionTypeRingBuffer(4);
    const middleware = createActionRingBufferMiddleware(buffer);

    for (let i = 0; i < 10; i++) {
      dispatchThrough(middleware, { type: `t/${i}` });
    }

    expect(buffer.snapshot()).toEqual(['t/6', 't/7', 't/8', 't/9']);
  });

  it('defaults to the shared renderer buffer holding the last 20 action types', () => {
    rendererActionTypeRingBuffer.clear();
    const middleware = createActionRingBufferMiddleware();

    for (let i = 0; i < SPEC_DEFAULT_CAPACITY + 5; i++) {
      dispatchThrough(middleware, { type: `t/${i}` });
    }

    const snapshot = rendererActionTypeRingBuffer.snapshot();
    expect(snapshot).toHaveLength(SPEC_DEFAULT_CAPACITY);
    expect(snapshot[0]).toBe('t/5');
    expect(snapshot.at(-1)).toBe(`t/${SPEC_DEFAULT_CAPACITY + 4}`);
    rendererActionTypeRingBuffer.clear();
  });
});
