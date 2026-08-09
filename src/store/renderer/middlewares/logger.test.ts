import { beforeEach, describe, expect, it, vi } from 'vitest';

type ChangesPayloadForTest = {
  changes: Record<string, { prev: unknown; next: unknown }>;
};

type NoChangesPayloadForTest = {
  state: unknown;
};

function expectGetterDescriptor(object: object, property: string, enumerable = false) {
  const descriptor = Object.getOwnPropertyDescriptor(object, property);
  expect(descriptor?.get).toEqual(expect.any(Function));
  expect(descriptor?.value).toBeUndefined();
  expect(descriptor?.enumerable).toBe(enumerable);
}

function expectChangesPayloadClassInstance(payload: ChangesPayloadForTest) {
  const prototype = Object.getPrototypeOf(payload);
  expect(prototype).not.toBe(Object.prototype);
  expect(prototype?.constructor?.name).toBe('ChangesPayload');
  expect(Object.getOwnPropertyDescriptor(payload, 'action')).toBeUndefined();
  expect(Object.getOwnPropertyDescriptor(prototype, 'action')).toBeUndefined();
  expect(Object.getOwnPropertyDescriptor(payload, 'prevState')).toBeUndefined();
  expect(Object.getOwnPropertyDescriptor(payload, 'nextState')).toBeUndefined();
  expect(Object.getOwnPropertyDescriptor(payload, 'changes')).toBeUndefined();
  expectGetterDescriptor(prototype, 'changes');
}

function expectNoChangesPayloadClassInstance(payload: NoChangesPayloadForTest) {
  const prototype = Object.getPrototypeOf(payload);
  expect(prototype).toBe(Object.prototype);
  expect(Object.getOwnPropertyDescriptor(payload, 'action')).toBeUndefined();
  expect(Object.getOwnPropertyDescriptor(payload, 'prevState')).toBeUndefined();
  expect(Object.getOwnPropertyDescriptor(payload, 'nextState')).toBeUndefined();
  expect(Object.getOwnPropertyDescriptor(payload, 'changes')).toBeUndefined();
  expect(Object.keys(payload)).toEqual(['state']);
}

describe('createLoggerMiddleware', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('logs the welcome message only once', async () => {
    const { createLoggerMiddleware } = await import('./logger');
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    createLoggerMiddleware('composer');
    createLoggerMiddleware('composer');

    expect(consoleLog).toHaveBeenCalledTimes(1);
  });

  it('logs changed state with raw action and a separate lazy state payload log', async () => {
    const { createLoggerMiddleware } = await import('./logger');
    const prevState = {
      count: 1,
      todos: { byId: { 'todo-1': { title: 'Draft', tags: ['inbox', 'soon'] } } },
    };
    const nextState = {
      count: 2,
      todos: {
        byId: {
          'todo-1': { title: 'Done', tags: ['inbox', 'shipped'] },
          'todo-2': { title: 'New', tags: ['later'] },
        },
        order: ['todo-1', 'todo-2'],
      },
    };
    let currentState = prevState;
    const action = { type: 'TEST_ACTION' };
    const group = vi.spyOn(console, 'group').mockImplementation(() => {});
    const groupCollapsed = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
    const consoleDir = vi.spyOn(console, 'dir').mockImplementation(() => {});
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const groupEnd = vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
    const middleware = createLoggerMiddleware('composer');
    consoleLog.mockClear();
    const storeApi = {
      dispatch: vi.fn(),
      getState: vi.fn(() => currentState),
    };
    const next = vi.fn((receivedAction: unknown) => {
      currentState = nextState;
      return receivedAction;
    });

    expect(middleware(storeApi as never)(next)(action)).toBe(action);
    expect(groupCollapsed).toHaveBeenCalledWith(
      '%cTEST_ACTION',
      'color: inherit; font-weight: 600',
    );
    expect(consoleLog).toHaveBeenCalledTimes(2);
    expect(group).not.toHaveBeenCalled();
    expect(consoleDir).not.toHaveBeenCalled();
    const actionPayload = consoleLog.mock.calls[0]?.[2];
    const lazyPayload = consoleLog.mock.calls[1]?.[2] as ChangesPayloadForTest;
    expect(consoleLog.mock.calls[0]?.slice(0, 2)).toEqual([
      '%c action    ',
      'color: #03A9F4; font-weight: bold',
    ]);
    expect(consoleLog.mock.calls[1]?.slice(0, 2)).toEqual([
      '%c state    ',
      'color: #4CAF50; font-weight: bold',
    ]);
    expect(actionPayload).toBe(action);
    expect(lazyPayload).not.toBe(action);
    expect(lazyPayload).not.toBe(prevState);
    expect(lazyPayload).not.toBe(nextState);
    expectChangesPayloadClassInstance(lazyPayload);
    expect(lazyPayload.changes).toEqual({
      count: { prev: 1, next: 2 },
      'todos.byId.todo-1.title': { prev: 'Draft', next: 'Done' },
      'todos.byId.todo-1.tags[1]': { prev: 'soon', next: 'shipped' },
      'todos.byId.todo-2': { prev: undefined, next: { title: 'New', tags: ['later'] } },
      'todos.order': { prev: undefined, next: ['todo-1', 'todo-2'] },
    });
    expect(groupEnd).toHaveBeenCalledTimes(1);
  });

  it('computes changes only when the changes accessor is read', async () => {
    const { createLoggerMiddleware } = await import('./logger');
    let diffReadCount = 0;
    const prevState = { nested: { count: 1 } };
    const nextState = {
      get nested() {
        diffReadCount++;
        return { count: 2 };
      },
    };
    let currentState: unknown = prevState;
    vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
    const middleware = createLoggerMiddleware('composer');
    consoleLog.mockClear();
    const storeApi = { dispatch: vi.fn(), getState: vi.fn(() => currentState) };
    const next = vi.fn((receivedAction: unknown) => {
      currentState = nextState;
      return receivedAction;
    });

    expect(() => middleware(storeApi as never)(next)({ type: 'TEST_ACTION' })).not.toThrow();
    expect(diffReadCount).toBe(0);
    const statePayload = consoleLog.mock.calls[1]?.[2] as ChangesPayloadForTest;
    expectChangesPayloadClassInstance(statePayload);
    const firstChanges = statePayload.changes;
    expect(diffReadCount).toBe(1);
    expect(firstChanges).toEqual({ 'nested.count': { prev: 1, next: 2 } });
    const secondChanges = statePayload.changes;
    expect(diffReadCount).toBe(2);
    expect(secondChanges).toEqual(firstChanges);
    expect(secondChanges).not.toBe(firstChanges);
    expectGetterDescriptor(Object.getPrototypeOf(statePayload), 'changes');
  });

  it('logs unchanged state without prev state and uses the no changes label', async () => {
    const { createLoggerMiddleware } = await import('./logger');
    const state = { count: 1 };
    const action = { type: 'TEST_ACTION', payload: 'payload text' };
    const group = vi.spyOn(console, 'group').mockImplementation(() => {});
    const groupCollapsed = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
    const consoleDir = vi.spyOn(console, 'dir').mockImplementation(() => {});
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const groupEnd = vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
    const middleware = createLoggerMiddleware('composer');
    consoleLog.mockClear();
    const storeApi = { dispatch: vi.fn(), getState: vi.fn(() => state) };
    const next = vi.fn((receivedAction: unknown) => receivedAction);

    expect(middleware(storeApi as never)(next)(action)).toBe(action);
    expect(groupCollapsed).toHaveBeenCalledWith(
      '%cTEST_ACTION payload text',
      'color: #9E9E9E; font-weight: 300',
    );
    expect(consoleLog.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['%c action    ', 'color: #03A9F4; font-weight: bold'],
      ['%c state (no changes)', 'color: #9E9E9E; font-weight: lighter'],
    ]);
    expect(group).not.toHaveBeenCalled();
    expect(consoleDir).not.toHaveBeenCalled();
    const actionPayload = consoleLog.mock.calls[0]?.[2];
    const statePayload = consoleLog.mock.calls[1]?.[2] as NoChangesPayloadForTest;
    expect(actionPayload).toBe(action);
    expect(statePayload).not.toBe(action);
    expect(statePayload).not.toBe(state);
    expectNoChangesPayloadClassInstance(statePayload);
    expect(statePayload.state).toBe(state);
    expect(groupEnd).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ type: 'TEST_ACTION' }, 'TEST_ACTION'],
    [{ type: 'TEST_ACTION', payload: 'payload text' }, 'TEST_ACTION payload text'],
    [{ type: 'TEST_ACTION', payload: 42 }, 'TEST_ACTION 42'],
    [{ type: 'TEST_ACTION', payload: ['payload text'] }, 'TEST_ACTION payload text'],
    [{ type: 'TEST_ACTION', payload: [42, 7] }, 'TEST_ACTION'],
    [{ type: 'TEST_ACTION', payload: { text: 'payload text' } }, 'TEST_ACTION'],
    [{ type: 'TEST_ACTION', payload: [{ text: 'payload text' }] }, 'TEST_ACTION'],
  ])('preserves simplified action titles for %j', async (action, expectedTitle) => {
    const { createLoggerMiddleware } = await import('./logger');
    const state = { count: 1 };
    vi.spyOn(console, 'group').mockImplementation(() => {});
    const groupCollapsed = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
    const middleware = createLoggerMiddleware('composer');
    const storeApi = { dispatch: vi.fn(), getState: vi.fn(() => state) };
    const next = vi.fn((receivedAction: unknown) => receivedAction);

    middleware(storeApi as never)(next)(action);

    expect(groupCollapsed).toHaveBeenCalledWith(
      `%c${expectedTitle}`,
      'color: #9E9E9E; font-weight: 300',
    );
  });
});
