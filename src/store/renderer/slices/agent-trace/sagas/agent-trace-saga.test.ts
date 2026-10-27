import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  notificationHandlers: new Set<(notification: { method: string; params?: unknown }) => void>(),
  reconnectHandlers: new Set<() => void>(),
}));

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: mocks.request,
  backendSubscribe: mocks.subscribe,
  backendUnsubscribe: mocks.unsubscribe,
  onBackendNotification: (
    handler: (notification: { method: string; params?: unknown }) => void,
  ) => {
    mocks.notificationHandlers.add(handler);
    return () => mocks.notificationHandlers.delete(handler);
  },
  onBackendReconnected: (handler: () => void) => {
    mocks.reconnectHandlers.add(handler);
    return () => mocks.reconnectHandlers.delete(handler);
  },
}));

import {
  agentTraceClosed,
  agentTraceDetailRequested,
  agentTraceOpened,
  agentTraceReducer,
  agentTraceRetryRequested,
  initialState,
  type AgentTraceState,
} from '../agent-trace-slice';
import { agentTraceSaga } from './agent-trace-saga';

const WS = 'ws-1';
const NOW = Date.parse('2026-10-23T20:00:00.000Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

/** A PROTOCOL §5.10 event row. */
function eventRow(id: string, type: string, msAgo: number, data: Record<string, unknown>) {
  return {
    id,
    workspaceId: WS,
    timestamp: iso(msAgo),
    type,
    actor: { type: type === 'agent:last-message' && data.role === 'user' ? 'user' : 'system' },
    data,
  };
}

const userRow = (id: string, msAgo: number) =>
  eventRow(id, 'agent:last-message', msAgo, {
    agentId: 'agent-a',
    messageId: `m-${id}`,
    role: 'user',
    turnId: `t-${id}`,
    lastUserMessage: 'Ship it',
  });

const toolRow = (id: string, msAgo: number, status: string) =>
  eventRow(id, 'agent:tool:call', msAgo, {
    agentId: 'agent-a',
    toolName: 'bash',
    title: 'pnpm test',
    toolKind: 'execute',
    toolCallId: `call-${id}`,
    input: { command: 'pnpm test' },
    status,
    messageId: 'msg-1',
    blockIndex: 1,
    blockId: 'msg-1:1',
  });

const usageRow = (id: string, msAgo: number, inputTokens: number) =>
  eventRow(id, 'workspace:tokenUsage-changed', msAgo, {
    workspaceId: WS,
    tokenUsage: {
      byAgentId: {
        'agent-a': {
          inputTokens,
          outputTokens: 10,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          cost: { amount: 0.5, currency: 'USD' },
        },
      },
      totals: { inputTokens, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0 },
      byModel: {},
      lastScanAt: null,
    },
  });

type Pages = Record<string, Array<{ items: unknown[]; nextToken: string | null }>>;

function serve(pages: Pages) {
  const served: Record<string, number> = {};
  mocks.request.mockImplementation((method: string, params: { eventType: string }) => {
    if (method !== 'event.query') return Promise.resolve({});
    const list = pages[params.eventType] ?? [];
    const index = served[params.eventType] ?? 0;
    served[params.eventType] = index + 1;
    return Promise.resolve(list[index] ?? { items: [], nextToken: null });
  });
}

function emit(subscriptionId: string, event: unknown) {
  for (const handler of [...mocks.notificationHandlers]) {
    handler({ method: 'events.event', params: { subscriptionId, event } });
  }
}

function createHarness() {
  let state: AgentTraceState = initialState;
  const channel = stdChannel();
  const dispatch = vi.fn((action: { type: string; payload?: unknown }) => {
    state = agentTraceReducer(state, action);
    channel.put(action);
    return action;
  });
  const task = runSaga(
    { channel, dispatch, getState: () => ({ agentTrace: state }) },
    agentTraceSaga,
  );
  return { dispatch, task, trace: () => state.byWorkspaceId[WS] };
}

/** Stored records in time order. */
function recordsOf(trace: AgentTraceState['byWorkspaceId'][string] | undefined) {
  return trace ? [...getItems(trace.records)].sort((a, b) => a.ts - b.ts) : [];
}

const queries = () =>
  mocks.request.mock.calls
    .filter(([method]) => method === 'event.query')
    .map(([, params]) => params as Record<string, unknown>);

async function stop(task: Task) {
  task.cancel();
  await task.toPromise();
}

describe('agentTraceSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notificationHandlers.clear();
    mocks.reconnectHandlers.clear();
    mocks.subscribe.mockResolvedValue({ subscriptionId: 'sub-trace' });
    mocks.unsubscribe.mockResolvedValue(undefined);
  });

  it('subscribes to the trace events and pages turn history on open', async () => {
    serve({
      'agent:last-message': [
        { items: [userRow('u2', 1_000)], nextToken: 'older' },
        { items: [userRow('u1', 60_000)], nextToken: null },
      ],
      'agent:failed': [{ items: [], nextToken: null }],
    });
    const harness = createHarness();
    harness.dispatch(agentTraceOpened(WS));

    await vi.waitFor(() => expect(harness.trace()?.status).toBe('ready'));
    expect(mocks.subscribe).toHaveBeenCalledWith({
      eventTypes: [
        'agent:last-message',
        'agent:tool:call',
        'agent:failed',
        'workspace:tokenUsage-changed',
      ],
      workspaceId: WS,
    });
    expect(queries()).toEqual([
      {
        workspaceId: WS,
        eventType: 'agent:last-message',
        minutesAgo: 10_080,
        limit: 200,
        paginate: true,
      },
      {
        workspaceId: WS,
        eventType: 'agent:last-message',
        minutesAgo: 10_080,
        limit: 200,
        nextToken: 'older',
        paginate: true,
      },
      {
        workspaceId: WS,
        eventType: 'agent:failed',
        minutesAgo: 10_080,
        limit: 200,
        paginate: true,
      },
    ]);
    expect(recordsOf(harness.trace()).map((record) => record.id)).toEqual(['u1', 'u2']);
    await stop(harness.task);
  });

  it('reads tool and usage history back to the requested window, resuming on widen', async () => {
    serve({
      'agent:last-message': [{ items: [], nextToken: null }],
      'agent:failed': [{ items: [], nextToken: null }],
      'agent:tool:call': [
        {
          items: [toolRow('t3', 1_000, 'completed'), toolRow('t2', 2_000, 'started')],
          nextToken: 'p2',
        },
        { items: [toolRow('t1', 30 * 60_000, 'completed')], nextToken: 'p3' },
        { items: [toolRow('t0', 90 * 60_000, 'completed')], nextToken: null },
      ],
      'workspace:tokenUsage-changed': [
        { items: [usageRow('s2', 500, 200), usageRow('s1', 40 * 60_000, 100)], nextToken: null },
      ],
    });
    const harness = createHarness();
    harness.dispatch(agentTraceOpened(WS));
    await vi.waitFor(() => expect(harness.trace()?.status).toBe('ready'));

    harness.dispatch(agentTraceDetailRequested(WS, NOW - 10 * 60_000));
    // Usage reads after the tool calls, so its rows mean both reads finished.
    await vi.waitFor(() =>
      expect(recordsOf(harness.trace()).filter((record) => record.kind === 'usage')).toHaveLength(
        2,
      ),
    );
    // Page 2 crosses the window; page 3 is not needed yet.
    expect(queries().filter((query) => query.eventType === 'agent:tool:call')).toEqual([
      {
        workspaceId: WS,
        eventType: 'agent:tool:call',
        minutesAgo: 360,
        limit: 100,
        paginate: true,
      },
      {
        workspaceId: WS,
        eventType: 'agent:tool:call',
        minutesAgo: 360,
        limit: 100,
        nextToken: 'p2',
        paginate: true,
      },
    ]);
    expect(queries().filter((query) => query.eventType === 'workspace:tokenUsage-changed')).toEqual(
      [
        {
          workspaceId: WS,
          eventType: 'workspace:tokenUsage-changed',
          minutesAgo: 4_320,
          limit: 25,
          paginate: true,
        },
      ],
    );
    const usage = recordsOf(harness.trace()).filter((record) => record.kind === 'usage');
    expect(usage.map((record) => record.id)).toEqual(['s1', 's2']);

    // Widening continues from the saved cursor instead of re-reading newer pages.
    harness.dispatch(agentTraceDetailRequested(WS, NOW - 2 * 60 * 60_000));
    await vi.waitFor(() =>
      expect(queries().filter((query) => query.eventType === 'agent:tool:call')).toHaveLength(3),
    );
    expect(queries().filter((query) => query.eventType === 'agent:tool:call')[2]).toMatchObject({
      nextToken: 'p3',
    });
    await vi.waitFor(() =>
      expect(recordsOf(harness.trace()).map((record) => record.id)).toContain('t0'),
    );
    // A narrower request than the loaded window issues no new reads.
    const before = queries().length;
    harness.dispatch(agentTraceDetailRequested(WS, NOW - 60_000));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(queries()).toHaveLength(before);
    await stop(harness.task);
  });

  it('batches live events from its own subscription and ignores the firehose copy', async () => {
    serve({});
    const harness = createHarness();
    harness.dispatch(agentTraceOpened(WS));
    await vi.waitFor(() => expect(harness.trace()?.status).toBe('ready'));

    emit('sub-trace', toolRow('live-1', 0, 'started'));
    emit('sub-trace', toolRow('live-2', 0, 'completed'));
    emit('sub-firehose', toolRow('other', 0, 'started'));
    await vi.waitFor(() => expect(recordsOf(harness.trace())).toHaveLength(2));
    expect(recordsOf(harness.trace()).map((record) => record.id)).toEqual(['live-1', 'live-2']);
    const batches = harness.dispatch.mock.calls.filter(
      ([action]) => action.type === 'agentTrace/recordsReceived',
    );
    expect(batches).toHaveLength(1);
    await stop(harness.task);
  });

  it('keeps one subscription for two panels and releases it with the last one', async () => {
    serve({});
    const harness = createHarness();
    harness.dispatch(agentTraceOpened(WS));
    harness.dispatch(agentTraceOpened(WS));
    await vi.waitFor(() => expect(harness.trace()?.status).toBe('ready'));
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);

    harness.dispatch(agentTraceClosed(WS));
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
    harness.dispatch(agentTraceClosed(WS));
    await vi.waitFor(() => expect(mocks.unsubscribe).toHaveBeenCalledWith('sub-trace', WS));
    expect(harness.trace()).toBeUndefined();
    await stop(harness.task);
  });

  it('drops live records still buffered when the last panel closes', async () => {
    serve({});
    const harness = createHarness();
    harness.dispatch(agentTraceOpened(WS));
    await vi.waitFor(() => expect(harness.trace()?.status).toBe('ready'));

    emit('sub-trace', toolRow('late', 0, 'started'));
    harness.dispatch(agentTraceClosed(WS));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(harness.trace()).toBeUndefined();
    await stop(harness.task);
  });

  it('releases the old subscription when a retry subscribes again', async () => {
    serve({});
    mocks.subscribe
      .mockResolvedValueOnce({ subscriptionId: 'sub-trace' })
      .mockResolvedValueOnce({ subscriptionId: 'sub-retry' });
    const harness = createHarness();
    harness.dispatch(agentTraceOpened(WS));
    await vi.waitFor(() => expect(harness.trace()?.status).toBe('ready'));

    harness.dispatch(agentTraceRetryRequested(WS));
    await vi.waitFor(() => expect(mocks.subscribe).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(mocks.unsubscribe).toHaveBeenCalledWith('sub-trace', WS));
    expect(mocks.unsubscribe).not.toHaveBeenCalledWith('sub-retry', WS);
    await stop(harness.task);
  });

  it('resumes a failed tool history read instead of leaving its calls out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      let failNext = true;
      mocks.request.mockImplementation((method: string, params: { eventType: string }) => {
        if (method !== 'event.query') return Promise.resolve({});
        if (params.eventType === 'agent:tool:call' && failNext) {
          failNext = false;
          return Promise.reject(new Error('daemon busy'));
        }
        return Promise.resolve(
          params.eventType === 'agent:tool:call'
            ? { items: [toolRow('t1', 1_000, 'completed')], nextToken: null }
            : { items: [], nextToken: null },
        );
      });
      const harness = createHarness();
      harness.dispatch(agentTraceOpened(WS));
      await vi.waitFor(() => expect(harness.trace()?.status).toBe('ready'));

      const toolReads = () =>
        queries().filter((query) => query.eventType === 'agent:tool:call').length;
      harness.dispatch(agentTraceDetailRequested(WS, NOW - 10 * 60_000));
      await vi.waitFor(() => expect(toolReads()).toBe(1));
      expect(recordsOf(harness.trace())).toEqual([]);
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.waitFor(() =>
        expect(recordsOf(harness.trace()).map((record) => record.id)).toEqual(['t1']),
      );
      expect(toolReads()).toBe(2);
      await stop(harness.task);
    } finally {
      vi.useRealTimers();
    }
  });

  it('subscribes again and reloads history after a reconnect', async () => {
    serve({});
    const harness = createHarness();
    harness.dispatch(agentTraceOpened(WS));
    await vi.waitFor(() => expect(harness.trace()?.status).toBe('ready'));
    const reads = queries().length;

    for (const handler of [...mocks.reconnectHandlers]) handler();
    await vi.waitFor(() => expect(mocks.subscribe).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(queries().length).toBeGreaterThan(reads));
    await stop(harness.task);
  });

  it('keeps loaded turns and reports the failure when a later page fails', async () => {
    mocks.request.mockImplementation(
      (method: string, params: { eventType: string; nextToken?: string }) => {
        if (method !== 'event.query') return Promise.resolve({});
        if (params.eventType !== 'agent:last-message') {
          return Promise.resolve({ items: [], nextToken: null });
        }
        return params.nextToken
          ? Promise.reject(new Error('daemon busy'))
          : Promise.resolve({ items: [userRow('u2', 1_000)], nextToken: 'older' });
      },
    );
    const harness = createHarness();
    harness.dispatch(agentTraceOpened(WS));
    await vi.waitFor(() => expect(harness.trace()?.status).toBe('error'));
    expect(recordsOf(harness.trace()).map((record) => record.id)).toEqual(['u2']);
    await stop(harness.task);
  });

  it('reports a failed subscription after history loads, and a retry subscribes again', async () => {
    serve({ 'agent:last-message': [{ items: [userRow('u1', 1_000)], nextToken: null }] });
    mocks.subscribe
      .mockRejectedValueOnce(new Error('daemon busy'))
      .mockResolvedValueOnce({ subscriptionId: 'sub-retry' });
    const harness = createHarness();
    harness.dispatch(agentTraceOpened(WS));
    await vi.waitFor(() => expect(harness.trace()?.status).toBe('error'));
    expect(recordsOf(harness.trace()).map((record) => record.id)).toEqual(['u1']);

    harness.dispatch(agentTraceRetryRequested(WS));
    await vi.waitFor(() => expect(harness.trace()?.status).toBe('ready'));
    expect(mocks.subscribe).toHaveBeenCalledTimes(2);
    emit('sub-retry', toolRow('live-1', 0, 'started'));
    await vi.waitFor(() =>
      expect(recordsOf(harness.trace()).map((record) => record.id)).toContain('live-1'),
    );
    await stop(harness.task);
  });

  it('treats a subscription without an id as failed', async () => {
    serve({});
    mocks.subscribe.mockResolvedValueOnce({});
    const harness = createHarness();
    harness.dispatch(agentTraceOpened(WS));
    await vi.waitFor(() => expect(harness.trace()?.status).toBe('error'));
    await stop(harness.task);
  });

  it('marks the turn history failed when the daemon read fails', async () => {
    mocks.request.mockRejectedValue(new Error('daemon offline'));
    const harness = createHarness();
    harness.dispatch(agentTraceOpened(WS));
    await vi.waitFor(() => expect(harness.trace()?.status).toBe('error'));
    await stop(harness.task);
  });
});
