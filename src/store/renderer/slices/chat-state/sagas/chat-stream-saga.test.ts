import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import * as sagaEffects from 'redux-saga/effects';
import {
  runSaga,
  stdChannel,
} from 'redux-saga';

vi.mock('typed-redux-saga', () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  delay: function* (ms: number) {
    return yield sagaEffects.delay(ms);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
}));

vi.mock('$shared/constants/agent-streaming', () => ({
  AGENT_STREAMING_CONFIG: { BACKEND_STREAM_TIMEOUT_MS: 25 },
}));

vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { setAgentStreaming } from '../../agent-session/agent-session-slice';
import {
  streamStatusReceived,
  streamTimedOut,
} from '../chat-state-slice';
import { agentStreamUpdateReceived } from '../../workspace-agents/workspace-agents-slice';
import * as registry from '../chat-stream-registry';
import { chatStreamSaga } from './chat-stream-saga';

describe('chat-stream-saga timeout ownership', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    registry.clearAllStreamTimeouts();
  });

  function runWithState(state: any) {
    const dispatched: any[] = [];
    const channel = stdChannel();
    const task = runSaga(
      {
        channel,
        dispatch: (action: any) => {
          dispatched.push(action);
          channel.put(action);
        },
        getState: () => state,
      },
      chatStreamSaga,
    );
    return { channel, dispatched, task };
  }

  it('dispatches timeout recovery from the saga when a non-terminal stream update expires', async () => {
    const { channel, dispatched, task } = runWithState({
      agentSessions: {
        byAgentId: { 'agent-1': { id: 'agent-1', workspaceId: 'ws-1', isStreaming: true } },
      },
    });

    channel.put(
      agentStreamUpdateReceived({
        agentId: 'agent-1',
        handlerSessionId: 'session-1',
        source: 'sendMessage',
        eventType: 'chunk',
      }),
    );
    await vi.advanceTimersByTimeAsync(30);

    expect(dispatched).toContainEqual(setAgentStreaming('agent-1', false));
    expect(dispatched).toContainEqual(streamTimedOut('agent-1'));
    expect(registry.getStreamTimeout('session-1')).toBeUndefined();
    task.cancel();
    await task.toPromise().catch(() => undefined);
  });

  it('cancels a re-armed timeout when a terminal stream update is received', async () => {
    const { channel, dispatched, task } = runWithState({
      agentSessions: {
        byAgentId: { 'agent-2': { id: 'agent-2', workspaceId: 'ws-1', isStreaming: true } },
      },
    });

    channel.put(
      agentStreamUpdateReceived({
        agentId: 'agent-2',
        handlerSessionId: 'session-2',
        source: 'sendMessage',
        eventType: 'chunk',
      }),
    );
    await vi.advanceTimersByTimeAsync(5);
    expect(registry.getStreamTimeout('session-2')).toBeDefined();

    channel.put(
      agentStreamUpdateReceived({
        agentId: 'agent-2',
        handlerSessionId: 'session-2',
        source: 'sendMessage',
        eventType: 'complete',
      }),
    );
    await vi.advanceTimersByTimeAsync(30);

    expect(dispatched).not.toContainEqual(streamTimedOut('agent-2'));
    expect(registry.getStreamTimeout('session-2')).toBeUndefined();
    task.cancel();
    await task.toPromise().catch(() => undefined);
  });

  it('cancels only the previous timeout task when the same stream is re-armed repeatedly', async () => {
    const { channel, dispatched, task } = runWithState({
      agentSessions: {
        byAgentId: { 'agent-3': { id: 'agent-3', workspaceId: 'ws-1', isStreaming: true } },
      },
    });

    channel.put(
      agentStreamUpdateReceived({
        agentId: 'agent-3',
        handlerSessionId: 'session-3',
        source: 'sendMessage',
        eventType: 'chunk',
      }),
    );
    const firstTimeout = registry.getStreamTimeout('session-3');
    await vi.advanceTimersByTimeAsync(10);

    channel.put(
      agentStreamUpdateReceived({
        agentId: 'agent-3',
        handlerSessionId: 'session-3',
        source: 'sendMessage',
        eventType: 'content-blocks',
      }),
    );
    expect(registry.getStreamTimeout('session-3')).toBeDefined();
    expect(registry.getStreamTimeout('session-3')).not.toBe(firstTimeout);

    await vi.advanceTimersByTimeAsync(20);
    expect(dispatched.filter((action) => action.type === streamTimedOut.type)).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(10);
    expect(dispatched.filter((action) => action.type === streamTimedOut.type)).toEqual([
      streamTimedOut('agent-3'),
    ]);
    expect(dispatched.filter((action) => action.type === setAgentStreaming.type)).toEqual([
      setAgentStreaming('agent-3', false),
    ]);
    expect(registry.getStreamTimeout('session-3')).toBeUndefined();
    task.cancel();
    await task.toPromise().catch(() => undefined);
  });

  it('rearms runtime timeouts for canonical non-terminal agent stream updates', async () => {
    const { channel, task } = runWithState({
      agentSessions: {
        byAgentId: { 'agent-4': { id: 'agent-4', workspaceId: 'ws-1', isStreaming: true } },
      },
    });

    for (const eventType of ['started', 'chunk', 'content-blocks'] as const) {
      channel.put(
        agentStreamUpdateReceived({
          agentId: 'agent-4',
          handlerSessionId: `session-${eventType}`,
          source: 'sendMessage',
          eventType,
        }),
      );
    }
    await vi.advanceTimersByTimeAsync(1);

    expect(registry.getStreamTimeout('session-started')).toBeDefined();
    expect(registry.getStreamTimeout('session-chunk')).toBeDefined();
    expect(registry.getStreamTimeout('session-content-blocks')).toBeDefined();
    task.cancel();
    await task.toPromise().catch(() => undefined);
  });

  it('rearms and clears runtime timeouts from canonical agent stream updates', async () => {
    const { channel, dispatched, task } = runWithState({
      agentSessions: {
        byAgentId: {
          'agent-canonical': { id: 'agent-canonical', workspaceId: 'ws-1', isStreaming: true },
        },
      },
    });

    channel.put(
      agentStreamUpdateReceived({
        agentId: 'agent-canonical',
        handlerSessionId: 'session-canonical',
        source: 'sendMessage',
        eventType: 'chunk',
      }),
    );
    await vi.advanceTimersByTimeAsync(1);

    expect(registry.getStreamTimeout('session-canonical')).toBeDefined();

    channel.put(
      agentStreamUpdateReceived({
        agentId: 'agent-canonical',
        handlerSessionId: 'session-canonical',
        source: 'sendMessage',
        eventType: 'complete',
      }),
    );
    await vi.advanceTimersByTimeAsync(1);

    expect(registry.getStreamTimeout('session-canonical')).toBeUndefined();
    expect(dispatched).not.toContainEqual(streamTimedOut('agent-canonical'));
    task.cancel();
    await task.toPromise().catch(() => undefined);
  });

  it('rearms runtime timeouts from status actions with session context', async () => {
    const { dispatched, channel, task } = runWithState({
      agentSessions: {
        byAgentId: {
          'agent-status': { id: 'agent-status', workspaceId: 'ws-1', isStreaming: true },
        },
      },
    });

    channel.put(
      streamStatusReceived(
        'agent-status',
        { phase: 'tool-call', message: 'Calling tool', level: 'info', timestamp: 1 },
        true,
        { sessionId: 'session-status' },
      ),
    );
    await vi.advanceTimersByTimeAsync(1);

    expect(registry.getStreamTimeout('session-status')).toBeDefined();
    await vi.advanceTimersByTimeAsync(30);
    expect(dispatched).toContainEqual(streamTimedOut('agent-status'));
    task.cancel();
    await task.toPromise().catch(() => undefined);
  });

  it('clearAllStreamTimeouts invokes registered cleanup handlers before dropping entries', () => {
    const cleanupA = vi.fn();
    const cleanupB = vi.fn();

    registry.setStreamTimeout('session-a', { cleanup: cleanupA });
    registry.setStreamTimeout('session-b', { cleanup: cleanupB });

    registry.clearAllStreamTimeouts();

    expect(cleanupA).toHaveBeenCalledTimes(1);
    expect(cleanupB).toHaveBeenCalledTimes(1);
    expect(registry.getStreamTimeout('session-a')).toBeUndefined();
    expect(registry.getStreamTimeout('session-b')).toBeUndefined();
  });
});
