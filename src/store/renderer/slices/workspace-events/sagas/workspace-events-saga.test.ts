import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { channel } from 'redux-saga';
import * as sagaEffects from 'redux-saga/effects';
import type { WorkspaceEvent } from '$features/events/types';

vi.mock('typed-redux-saga', () => ({
  actionChannel: function* (pattern: any, buffer?: any) {
    return yield sagaEffects.actionChannel(pattern, buffer);
  },
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor, ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  delay: function* (ms: any, value?: any) {
    return yield value === undefined ? sagaEffects.delay(ms) : sagaEffects.delay(ms, value);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  flush: function* (channel: any) {
    return yield sagaEffects.flush(channel);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  take: function* (channelOrPattern: any) {
    return yield sagaEffects.take(channelOrPattern);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
}));

const { takeEveryFromListenSyncMock, invokeMock } = vi.hoisted(() => ({
  takeEveryFromListenSyncMock: vi.fn(function* () {}),
  invokeMock: vi.fn(),
}));

vi.mock('$store/renderer/utils/ipc-channel', () => ({
  HIGH_VOLUME_IPC_BUFFER_LIMIT: 1_000,
  takeEveryFromListenSync: takeEveryFromListenSyncMock,
}));

vi.mock('$lib/electron-bridge', () => ({
  invoke: invokeMock,
}));

import {
  bulkEventsReceived,
  eventReceived,
  eventsCleared,
  eventsLoaded,
  loadEventsRequested,
  setEventsLoading,
} from '../workspace-events-slice';
import {
  EVENT_BATCH_ACTION_BUFFER_LIMIT,
  EVENTS_NEW_IPC_BUFFER_LIMIT,
  handleLoadEventsRequested,
  watchBatchedEventStorageSaga,
  watchEventsNewSaga,
  watchEventsClearedSaga,
  watchLoadEventsRequestedSaga,
  workspaceEventsSaga,
} from './workspace-events-saga';
import { workspaceMounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';

function mockEvent(id: string, workspaceId = 'ws-1'): WorkspaceEvent {
  return {
    id,
    workspaceId,
    timestamp: '2026-03-25T00:00:00.000Z',
    type: 'file:changed',
    actor: { type: 'system' },
  };
}

function getListenSyncHandler(eventName: string) {
  const call = takeEveryFromListenSyncMock.mock.calls.find(([name]: any) => name === eventName);
  expect(call).toBeDefined();
  return call![1] as (data: any) => Generator;
}

function expectBoundedActionChannel(effect: any, pattern: unknown, limit: number) {
  expect(effect.type).toBe('ACTION_CHANNEL');
  expect(effect.payload.pattern).toBe(pattern);
  const buffer = effect.payload.buffer;
  expect(buffer).toBeDefined();
  for (let i = 0; i <= limit; i++) buffer.put(i);
  expect(buffer.take()).toBe(1);
}

describe('workspaceEventsSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockReset();
  });

  it('forks all watchers and registers workspaceMounted handler', () => {
    const iterator = workspaceEventsSaga();
    // fork(watchEventsNewSaga)
    const step1 = iterator.next().value as any;
    expect(step1.type).toBe('FORK');
    expect(step1.payload.fn).toBe(watchEventsNewSaga);
    // fork(watchEventsClearedSaga)
    const step2 = iterator.next().value as any;
    expect(step2.type).toBe('FORK');
    expect(step2.payload.fn).toBe(watchEventsClearedSaga);
    // fork(watchLoadEventsRequestedSaga)
    const step3 = iterator.next().value as any;
    expect(step3.type).toBe('FORK');
    expect(step3.payload.fn).toBe(watchLoadEventsRequestedSaga);
    // fork(watchBatchedEventStorageSaga)
    const step4 = iterator.next().value as any;
    expect(step4.type).toBe('FORK');
    expect(step4.payload.fn).toBe(watchBatchedEventStorageSaga);
    // takeEvery(workspaceMounted, handleWorkspaceMounted)
    const step5 = iterator.next().value as any;
    expect(step5.type).toBe('FORK');
    expect(step5.payload.args[0]).toBe(workspaceMounted);
    expect(iterator.next().done).toBe(true);
  });

  it('gates each storage batch on the first queued eventReceived action', () => {
    const iterator = watchBatchedEventStorageSaga();
    const first = mockEvent('evt-1');
    const second = mockEvent('evt-2');
    const third = mockEvent('evt-3');
    const eventActions = channel<ReturnType<typeof eventReceived>>();
    const firstAction = eventReceived('ws-1', first);

    expectBoundedActionChannel(iterator.next().value, eventReceived, EVENT_BATCH_ACTION_BUFFER_LIMIT);
    expect(iterator.next(eventActions as any).value).toEqual(sagaEffects.take(eventActions));
    expect(iterator.next(firstAction as any).value).toEqual(sagaEffects.delay(1_000));
    expect(iterator.next().value).toEqual(sagaEffects.flush(eventActions));
    expect(
      iterator.next([
        eventReceived('ws-1', second),
        eventReceived('ws-1', third),
      ] as any).value,
    ).toEqual(
      sagaEffects.put(bulkEventsReceived('ws-1', [first, second, third])),
    );
    expect(iterator.next().value).toEqual(sagaEffects.take(eventActions));
  });

  it('keeps separate workspace batches isolated during event-gated storage flushes', () => {
    const iterator = watchBatchedEventStorageSaga();
    const first = mockEvent('evt-1', 'ws-1');
    const second = mockEvent('evt-2', 'ws-2');
    const eventActions = channel<ReturnType<typeof eventReceived>>();
    const firstAction = eventReceived('ws-1', first);

    expectBoundedActionChannel(iterator.next().value, eventReceived, EVENT_BATCH_ACTION_BUFFER_LIMIT);
    expect(iterator.next(eventActions as any).value).toEqual(sagaEffects.take(eventActions));
    expect(iterator.next(firstAction as any).value).toEqual(sagaEffects.delay(1_000));
    expect(iterator.next().value).toEqual(sagaEffects.flush(eventActions));
    expect(
      iterator.next([
        eventReceived('ws-2', second),
      ] as any).value,
    ).toEqual(
      sagaEffects.put(bulkEventsReceived('ws-1', [first])),
    );
    expect(iterator.next().value).toEqual(
      sagaEffects.put(bulkEventsReceived('ws-2', [second])),
    );
    expect(iterator.next().value).toEqual(sagaEffects.take(eventActions));
  });

  it('includes the first taken action when the following flush is empty', () => {
    const iterator = watchBatchedEventStorageSaga();
    const first = mockEvent('evt-1');
    const eventActions = channel<ReturnType<typeof eventReceived>>();
    const firstAction = eventReceived('ws-1', first);

    expectBoundedActionChannel(iterator.next().value, eventReceived, EVENT_BATCH_ACTION_BUFFER_LIMIT);
    expect(iterator.next(eventActions as any).value).toEqual(sagaEffects.take(eventActions));
    expect(iterator.next(firstAction as any).value).toEqual(sagaEffects.delay(1_000));
    expect(iterator.next().value).toEqual(sagaEffects.flush(eventActions));
    expect(iterator.next([] as any).value).toEqual(
      sagaEffects.put(bulkEventsReceived('ws-1', [first])),
    );
    expect(iterator.next().value).toEqual(sagaEffects.take(eventActions));
  });

  it('dispatches eventReceived on events:new IPC', () => {
    watchEventsNewSaga().next();
    const event = mockEvent('evt-1');
    const handler = getListenSyncHandler('events:new');
    const gen = handler({ workspaceId: 'ws-1', event });
    expect(gen.next()).toEqual({
      value: sagaEffects.put(eventReceived('ws-1', event)),
      done: false,
    });
  });

  it('registers events:new with a bounded sliding IPC buffer', () => {
    watchEventsNewSaga().next();

    const call = takeEveryFromListenSyncMock.mock.calls.find(([name]: any) => name === 'events:new');
    expect(call?.[2]).toMatchObject({
      bufferPolicy: {
        kind: 'sliding',
        limit: EVENTS_NEW_IPC_BUFFER_LIMIT,
      },
    });
  });

  it('sanitizes malformed string fields from events:new before dispatching', () => {
    watchEventsNewSaga().next();
    const handler = getListenSyncHandler('events:new');
    const malformedEvent = {
      ...mockEvent('evt-malformed'),
      actor: { type: 'agent', name: { nested: 'bad' }, id: 42 },
      description: 123,
      data: { message: { nested: 'bad' }, command: ['not', 'string'] },
    };
    const gen = handler({ workspaceId: 'ws-1', event: malformedEvent });
    const putEffect = gen.next().value as any;
    const [, sanitized] = putEffect.payload.action.payload;
    expect(putEffect).toEqual(sagaEffects.put(eventReceived('ws-1', sanitized)));
    expect(sanitized.actor.id).toBe('42');
    expect(sanitized.actor.name).toBeUndefined();
    expect(sanitized.description).toBe('123');
    expect(sanitized.data.message).toBeUndefined();
    expect(sanitized.data.command).toBeUndefined();
  });

  it('sanitizes cyclic nested data from events:new before dispatching', () => {
    watchEventsNewSaga().next();
    const handler = getListenSyncHandler('events:new');
    const data: any = { command: 'pnpm test' };
    data.self = data;
    const event = { ...mockEvent('evt-cycle'), data };

    const gen = handler({ workspaceId: 'ws-1', event });
    const putEffect = gen.next().value as any;
    const [, sanitized] = putEffect.payload.action.payload;

    expect(putEffect).toEqual(sagaEffects.put(eventReceived('ws-1', sanitized)));
    expect(sanitized.data).toEqual({ command: 'pnpm test' });
    expect(() => JSON.stringify(sanitized)).not.toThrow();
  });

  it('skips malformed events:new payloads without throwing', () => {
    watchEventsNewSaga().next();
    const handler = getListenSyncHandler('events:new');
    expect(handler({ workspaceId: 'ws-1', event: { id: 'evt-1' } }).next()).toEqual({
      value: undefined,
      done: true,
    });
    expect(handler({ workspaceId: 'ws-1', event: null }).next()).toEqual({
      value: undefined,
      done: true,
    });
  });

  it('skips events:new without workspaceId', () => {
    watchEventsNewSaga().next();
    const handler = getListenSyncHandler('events:new');
    expect(handler({ event: mockEvent('evt-1') }).next()).toEqual({
      value: undefined,
      done: true,
    });
  });

  it('dispatches eventsCleared on events:cleared IPC', () => {
    watchEventsClearedSaga().next();
    const handler = getListenSyncHandler('events:cleared');
    expect(handler({ workspaceId: 'ws-1' }).next()).toEqual({
      value: sagaEffects.put(eventsCleared('ws-1')),
      done: false,
    });
  });

  it('loads events via IPC and dispatches eventsLoaded', () => {
    const action = loadEventsRequested('ws-1');
    const iterator = handleLoadEventsRequested(action);

    expect(iterator.next()).toEqual({
      value: sagaEffects.put(setEventsLoading('ws-1', true)),
      done: false,
    });

    const callEffect = iterator.next().value as any;
    expect(callEffect.type).toBe('CALL');

    const events = [mockEvent('evt-1'), mockEvent('evt-2')];
    expect(iterator.next({ success: true, events })).toEqual({
      value: sagaEffects.put(eventsLoaded('ws-1', events)),
      done: false,
    });
  });

  it('filters malformed events from events:query before dispatching eventsLoaded', () => {
    const action = loadEventsRequested('ws-1');
    const iterator = handleLoadEventsRequested(action);
    iterator.next();
    iterator.next();

    const validEvent = mockEvent('evt-valid');
    const malformedEvent = {
      id: 'evt-invalid',
      workspaceId: 'ws-1',
      timestamp: [],
      type: 'file:changed',
    };
    const putEffect = iterator.next({ success: true, events: [validEvent, malformedEvent] })
      .value as any;
    expect(putEffect).toEqual(sagaEffects.put(eventsLoaded('ws-1', [validEvent])));
  });

  it('sanitizes cyclic nested data from events:query before dispatching eventsLoaded', () => {
    const action = loadEventsRequested('ws-1');
    const iterator = handleLoadEventsRequested(action);
    iterator.next();
    iterator.next();

    const data: any = { command: 'pnpm test' };
    data.self = data;
    const event = { ...mockEvent('evt-query-cycle'), data };
    const putEffect = iterator.next({ success: true, events: [event] }).value as any;

    expect(putEffect).toEqual(
      sagaEffects.put(
        eventsLoaded('ws-1', [{ ...mockEvent('evt-query-cycle'), data: { command: 'pnpm test' } }]),
      ),
    );
  });

  it('clears loading instead of dispatching malformed events:query lists', () => {
    const action = loadEventsRequested('ws-1');
    const iterator = handleLoadEventsRequested(action);
    iterator.next();
    iterator.next();
    expect(iterator.next({ success: true, events: { not: 'an array' } })).toEqual({
      value: sagaEffects.put(setEventsLoading('ws-1', false)),
      done: false,
    });
  });

  it('clears loading on failed load', () => {
    const action = loadEventsRequested('ws-1');
    const iterator = handleLoadEventsRequested(action);
    iterator.next(); // put setEventsLoading
    iterator.next(); // call invoke
    expect(iterator.next({ success: false, error: 'fail' })).toEqual({
      value: sagaEffects.put(setEventsLoading('ws-1', false)),
      done: false,
    });
  });
});
