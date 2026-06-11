import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  channel,
  runSaga,
  stdChannel,
} from 'redux-saga';
import * as sagaEffects from 'redux-saga/effects';
import type { AgentSession } from '$shared/types';

vi.mock('typed-redux-saga', () => ({
  actionChannel: function* (pattern: any, buffer?: any) {
    return yield sagaEffects.actionChannel(pattern, buffer);
  },
  delay: function* (ms: any, value?: any) {
    return yield value === undefined ? sagaEffects.delay(ms) : sagaEffects.delay(ms, value);
  },
  flush: function* (channel: any) {
    return yield sagaEffects.flush(channel);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  take: function* (channelOrPattern: any) {
    return yield sagaEffects.take(channelOrPattern);
  },
}));

import {
  bulkUpsertSessions,
  upsertSession,
} from '../agent-session-slice';
import {
  AGENT_SESSION_UPSERT_BUFFER_LIMIT,
  agentSessionSaga,
  watchBatchedAgentSessionUpsertsSaga,
} from './agent-session-saga';

function expectBoundedActionChannel(effect: any, pattern: unknown, limit: number) {
  expect(effect.type).toBe('ACTION_CHANNEL');
  expect(effect.payload.pattern).toBe(pattern);
  const buffer = effect.payload.buffer;
  expect(buffer).toBeDefined();
  for (let i = 0; i <= limit; i++) buffer.put(i);
  expect(buffer.take()).toBe(1);
}

function makeSession(id: string, name = `Agent ${id}`): AgentSession {
  return {
    id: id as AgentSession['id'],
    backendSessionId: null,
    workspaceId: 'ws-1' as AgentSession['workspaceId'],
    name,
    status: 'idle' as AgentSession['status'],
    messages: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  } as AgentSession;
}

describe('agent-session-saga', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers the batched upsert watcher', () => {
    const iterator = agentSessionSaga();
    expect(iterator.next().value).toEqual(
      sagaEffects.fork(watchBatchedAgentSessionUpsertsSaga),
    );
    expect(iterator.next().done).toBe(true);
  });

  it('preserves the first action and appends flushed actions in original order', () => {
    const iterator = watchBatchedAgentSessionUpsertsSaga();
    const upsertActions = channel<ReturnType<typeof upsertSession>>();
    const first = makeSession('a1', 'First');
    const second = makeSession('a1', 'Second');
    const third = makeSession('a2', 'Third');

    expectBoundedActionChannel(iterator.next().value, upsertSession, AGENT_SESSION_UPSERT_BUFFER_LIMIT);
    expect(iterator.next(upsertActions as any).value).toEqual(sagaEffects.take(upsertActions));
    expect(iterator.next(upsertSession(first) as any).value).toEqual(sagaEffects.delay(100));
    expect(iterator.next().value).toEqual(sagaEffects.flush(upsertActions));
    expect(iterator.next([
      upsertSession(second),
      upsertSession(third),
    ] as any).value).toEqual(
      sagaEffects.put(bulkUpsertSessions([
        first,
        second,
        third,
      ], { preserveExplicitRuntimeFlags: false })),
    );
    expect(iterator.next().value).toEqual(sagaEffects.take(upsertActions));
  });

  it('dispatches the first action when the following flush is empty', () => {
    const iterator = watchBatchedAgentSessionUpsertsSaga();
    const upsertActions = channel<ReturnType<typeof upsertSession>>();
    const first = makeSession('a1');

    expectBoundedActionChannel(iterator.next().value, upsertSession, AGENT_SESSION_UPSERT_BUFFER_LIMIT);
    expect(iterator.next(upsertActions as any).value).toEqual(sagaEffects.take(upsertActions));
    expect(iterator.next(upsertSession(first) as any).value).toEqual(sagaEffects.delay(100));
    expect(iterator.next().value).toEqual(sagaEffects.flush(upsertActions));
    expect(iterator.next([] as any).value).toEqual(
      sagaEffects.put(bulkUpsertSessions([first], { preserveExplicitRuntimeFlags: false })),
    );
    expect(iterator.next().value).toEqual(sagaEffects.take(upsertActions));
  });

  it('does not dispatch or schedule delay while idle before the first upsert action', async () => {
    const input = stdChannel();
    const dispatched: any[] = [];
    const task = runSaga(
      { channel: input, dispatch: (action: any) => dispatched.push(action), getState: () => ({}) },
      watchBatchedAgentSessionUpsertsSaga,
    );

    await vi.advanceTimersByTimeAsync(500);

    expect(dispatched).toEqual([]);
    input.put(upsertSession(makeSession('a1')));
    await vi.advanceTimersByTimeAsync(100);
    expect(dispatched).toEqual([
      bulkUpsertSessions([makeSession('a1')], { preserveExplicitRuntimeFlags: false }),
    ]);

    task.cancel();
    await task.toPromise();
  });

  it('does not extend the 100ms window when more upserts arrive continuously', async () => {
    const input = stdChannel();
    const dispatched: any[] = [];
    const first = makeSession('a1', 'First');
    const second = makeSession('a1', 'Second');
    const task = runSaga(
      { channel: input, dispatch: (action: any) => dispatched.push(action), getState: () => ({}) },
      watchBatchedAgentSessionUpsertsSaga,
    );

    input.put(upsertSession(first));
    await vi.advanceTimersByTimeAsync(90);
    input.put(upsertSession(second));
    await vi.advanceTimersByTimeAsync(9);
    expect(dispatched).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);

    expect(dispatched).toEqual([
      bulkUpsertSessions([first, second], { preserveExplicitRuntimeFlags: false }),
    ]);

    task.cancel();
    await task.toPromise();
  });
});