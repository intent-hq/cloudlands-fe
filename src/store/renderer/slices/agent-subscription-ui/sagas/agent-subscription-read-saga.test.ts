import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.request }));

import {
  agentSubscriptionUIReducer,
  initialState,
  makeKey,
  refreshWorkspaceSubscriptionEntriesRequested,
  requestSubscriptionFetch,
  setSubscriptionSnapshot,
} from '../agent-subscription-ui-slice';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { initializeChatRequested } from '../../chat-state/chat-state-slice';
import { markAgentAsViewed } from '../../unread-tracking/unread-tracking-slice';
import {
  agentSubscriptionReadSaga,
  COMPLETED_DISPLAY_DURATION_MS,
} from './agent-subscription-read-saga';

const WS = 'ws-subscriptions';
const AGENT = 'agent-parent';
const CHILD = 'agent-child';
const empty = () => ({ subscriptions: [], delegationGroups: [], agentStatuses: {} });
const active = (agentId = AGENT, childId = CHILD, description = 'Waiting') => ({
  subscriptions: [
    {
      id: 'watch-1',
      agentId,
      eventTypes: ['agent:idle'],
      actorIds: [childId],
      createdAt: '2026-01-01T00:00:00.000Z',
      description,
    },
  ],
  delegationGroups: [
    {
      groupId: 'group-1',
      parentAgentId: agentId,
      awaitMode: 'all',
      expectedAgentIds: [childId],
      completedAgentIds: [],
      deletedAgentIds: [],
      delivered: false,
    },
  ],
  agentStatuses: { [agentId]: 'waiting', [childId]: 'responding' },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function harness(seed = initialState, extraState: Record<string, unknown> = {}) {
  const channel = stdChannel();
  let state = seed;
  const dispatch = vi.fn((action) => {
    state = agentSubscriptionUIReducer(state, action);
  });
  const task = runSaga(
    { channel, dispatch, getState: () => ({ agentSubscriptionUI: state, ...extraState }) },
    agentSubscriptionReadSaga,
  );
  return { channel, dispatch, task, state: () => state };
}

describe('agentSubscriptionReadSaga', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('sends the exact agent.getSubscriptions request and maps the protocol response', async () => {
    mocks.request.mockResolvedValue(active());
    const run = harness();
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    await settle();

    expect(mocks.request).toHaveBeenCalledWith('agent.getSubscriptions', {
      workspaceId: WS,
      agentId: AGENT,
    });
    expect(run.state().entries[makeKey(WS, AGENT)]).toEqual({
      subscriptions: [
        {
          id: 'watch-1',
          agentId: AGENT,
          eventTypes: ['agent:idle'],
          actorIds: [CHILD],
          createdAt: '2026-01-01T00:00:00.000Z',
          description: 'Waiting',
        },
      ],
      waitingState: 'waiting',
      agentStatuses: { [AGENT]: 'waiting', [CHILD]: 'responding' },
      delegationGroups: [
        {
          groupId: 'group-1',
          awaitMode: 'all',
          expectedAgentIds: [CHILD],
          completedAgentIds: [],
          deletedAgentIds: [],
          agentStatuses: { [CHILD]: 'responding' },
          delivered: false,
        },
      ],
      wokenUpInfo: null,
      snapshotStatus: 'ready',
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('coalesces a same-key burst into one authoritative trailing read while other keys run', async () => {
    const first = deferred<ReturnType<typeof active>>();
    const other = deferred<ReturnType<typeof active>>();
    const trailing = deferred<ReturnType<typeof active>>();
    mocks.request
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(other.promise)
      .mockReturnValueOnce(trailing.promise);
    const run = harness();
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    run.channel.put(requestSubscriptionFetch('ws-other', 'agent-other'));
    await settle();

    expect(mocks.request.mock.calls).toEqual([
      ['agent.getSubscriptions', { workspaceId: WS, agentId: AGENT }],
      ['agent.getSubscriptions', { workspaceId: 'ws-other', agentId: 'agent-other' }],
    ]);

    first.resolve(active(AGENT, CHILD, 'Stale'));
    await settle();
    expect(mocks.request.mock.calls).toEqual([
      ['agent.getSubscriptions', { workspaceId: WS, agentId: AGENT }],
      ['agent.getSubscriptions', { workspaceId: 'ws-other', agentId: 'agent-other' }],
      ['agent.getSubscriptions', { workspaceId: WS, agentId: AGENT }],
    ]);

    trailing.resolve(active(AGENT, CHILD, 'Fresh'));
    other.resolve(active('agent-other', 'agent-other-child'));
    await settle();
    expect(run.state().entries[makeKey(WS, AGENT)]?.subscriptions[0]?.description).toBe('Fresh');
    run.task.cancel();
    await run.task.toPromise();
  });

  it('runs the retained trailing read after the active read fails', async () => {
    const first = deferred<ReturnType<typeof active>>();
    const trailing = deferred<ReturnType<typeof active>>();
    mocks.request.mockReturnValueOnce(first.promise).mockReturnValueOnce(trailing.promise);
    const run = harness();
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    await settle();
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    first.reject(new Error('read failed'));
    await settle();

    expect(mocks.request.mock.calls).toEqual([
      ['agent.getSubscriptions', { workspaceId: WS, agentId: AGENT }],
      ['agent.getSubscriptions', { workspaceId: WS, agentId: AGENT }],
    ]);
    trailing.resolve(active(AGENT, CHILD, 'Recovered'));
    await settle();
    expect(run.state().entries[makeKey(WS, AGENT)]?.subscriptions[0]?.description).toBe(
      'Recovered',
    );
    run.task.cancel();
    await run.task.toPromise();
  });

  it('refreshes every tracked workspace entry through the keyed coordinator', async () => {
    mocks.request.mockResolvedValue(active());
    const seeded = agentSubscriptionUIReducer(
      agentSubscriptionUIReducer(
        initialState,
        setSubscriptionSnapshot(WS, AGENT, {
          subscriptions: [],
          delegationGroups: [],
          agentStatuses: {},
          waitingState: 'idle',
        }),
      ),
      setSubscriptionSnapshot(WS, 'agent-second', {
        subscriptions: [],
        delegationGroups: [],
        agentStatuses: {},
        waitingState: 'idle',
      }),
    );
    const run = harness(seeded);
    run.channel.put(refreshWorkspaceSubscriptionEntriesRequested(WS));
    await settle();

    expect(mocks.request.mock.calls).toEqual([
      ['agent.getSubscriptions', { workspaceId: WS, agentId: AGENT }],
      ['agent.getSubscriptions', { workspaceId: WS, agentId: 'agent-second' }],
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('retains prior rows and marks the snapshot failed when the read fails', async () => {
    mocks.request.mockRejectedValue(new Error('read failed'));
    const seeded = agentSubscriptionUIReducer(
      initialState,
      setSubscriptionSnapshot(WS, AGENT, {
        subscriptions: [],
        delegationGroups: [],
        agentStatuses: {},
        waitingState: 'waiting',
      }),
    );
    const run = harness(seeded);
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    await settle();

    expect(run.state().entries[makeKey(WS, AGENT)]).toEqual({
      ...seeded.entries[makeKey(WS, AGENT)],
      snapshotStatus: 'failed',
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('marks a failed first read while retaining empty state', async () => {
    mocks.request.mockRejectedValue(new Error('read failed'));
    const run = harness();
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    await settle();

    const entry = run.state().entries[makeKey(WS, AGENT)];
    expect(entry.snapshotStatus).toBe('failed');
    expect(entry.subscriptions).toHaveLength(0);
    expect(entry.waitingState).toBe('idle');
    run.task.cancel();
    await run.task.toPromise();
  });

  it('prefetches the snapshot when chat initialization begins', async () => {
    mocks.request.mockResolvedValue(empty());
    const run = harness();
    run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
    await settle();

    expect(mocks.request).toHaveBeenCalledWith('agent.getSubscriptions', {
      workspaceId: WS,
      agentId: AGENT,
    });
    expect(run.state().entries[makeKey(WS, AGENT)].snapshotStatus).toBe('ready');
    run.task.cancel();
    await run.task.toPromise();
  });

  it('prefetches on markAgentAsViewed via the session workspace, skipping unknown sessions', async () => {
    mocks.request.mockResolvedValue(empty());
    const run = harness(initialState, {
      agentSessions: { byAgentId: { [AGENT]: { id: AGENT, workspaceId: WS } } },
    });
    run.channel.put(markAgentAsViewed('agent-unknown'));
    await settle();
    expect(mocks.request).not.toHaveBeenCalled();

    run.channel.put(markAgentAsViewed(AGENT));
    await settle();
    expect(mocks.request).toHaveBeenCalledWith('agent.getSubscriptions', {
      workspaceId: WS,
      agentId: AGENT,
    });
    expect(run.state().entries[makeKey(WS, AGENT)].snapshotStatus).toBe('ready');
    run.task.cancel();
    await run.task.toPromise();
  });

  it('coalesces the view-time prefetch with the card mount fetch (single-flight)', async () => {
    const first = deferred<ReturnType<typeof empty>>();
    const trailing = deferred<ReturnType<typeof empty>>();
    mocks.request.mockReturnValueOnce(first.promise).mockReturnValueOnce(trailing.promise);
    const run = harness(initialState, {
      agentSessions: { byAgentId: { [AGENT]: { id: AGENT, workspaceId: WS } } },
    });
    run.channel.put(markAgentAsViewed(AGENT));
    run.channel.put(initializeChatRequested(AGENT, { wsId: WS }));
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    await settle();

    expect(mocks.request).toHaveBeenCalledTimes(1);
    first.resolve(empty());
    await settle();
    trailing.resolve(empty());
    await settle();
    expect(mocks.request).toHaveBeenCalledTimes(2);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('confirms a completed transition after the delay and resets it to idle', async () => {
    vi.useFakeTimers();
    mocks.request.mockResolvedValue(empty());
    const seeded = agentSubscriptionUIReducer(
      initialState,
      setSubscriptionSnapshot(WS, AGENT, {
        subscriptions: [],
        delegationGroups: [],
        agentStatuses: {},
        waitingState: 'waiting',
      }),
    );
    const run = harness(seeded);
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    await vi.advanceTimersByTimeAsync(0);
    expect(run.state().entries[makeKey(WS, AGENT)]?.waitingState).toBe('completed');
    await vi.advanceTimersByTimeAsync(COMPLETED_DISPLAY_DURATION_MS);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(run.state().entries[makeKey(WS, AGENT)]?.waitingState).toBe('idle');
    run.task.cancel();
    await run.task.toPromise();
  });

  it('does not let completed cleanup suppress an unrelated read', async () => {
    vi.useFakeTimers();
    mocks.request.mockResolvedValue(empty());
    const seeded = agentSubscriptionUIReducer(
      initialState,
      setSubscriptionSnapshot(WS, AGENT, {
        subscriptions: [],
        delegationGroups: [],
        agentStatuses: {},
        waitingState: 'waiting',
      }),
    );
    const run = harness(seeded);
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    await vi.advanceTimersByTimeAsync(0);
    run.channel.put(requestSubscriptionFetch('ws-other', 'agent-other'));
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.request).toHaveBeenCalledWith('agent.getSubscriptions', {
      workspaceId: 'ws-other',
      agentId: 'agent-other',
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('applies renewed data from completed-state confirmation authoritatively', async () => {
    vi.useFakeTimers();
    mocks.request.mockResolvedValueOnce(empty()).mockResolvedValueOnce(active());
    const seeded = agentSubscriptionUIReducer(
      initialState,
      setSubscriptionSnapshot(WS, AGENT, {
        subscriptions: [],
        delegationGroups: [],
        agentStatuses: {},
        waitingState: 'waiting',
      }),
    );
    const run = harness(seeded);
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(COMPLETED_DISPLAY_DURATION_MS);

    expect(mocks.request.mock.calls).toEqual([
      ['agent.getSubscriptions', { workspaceId: WS, agentId: AGENT }],
      ['agent.getSubscriptions', { workspaceId: WS, agentId: AGENT }],
    ]);
    expect(run.state().entries[makeKey(WS, AGENT)]?.waitingState).toBe('waiting');
    expect(run.state().entries[makeKey(WS, AGENT)]?.subscriptions).toHaveLength(1);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('runs one trailing snapshot after triggers overlap an active confirmation', async () => {
    vi.useFakeTimers();
    const confirmation = deferred<ReturnType<typeof active>>();
    const trailing = deferred<ReturnType<typeof active>>();
    mocks.request
      .mockResolvedValueOnce(empty())
      .mockReturnValueOnce(confirmation.promise)
      .mockReturnValueOnce(trailing.promise);
    const seeded = agentSubscriptionUIReducer(
      initialState,
      setSubscriptionSnapshot(WS, AGENT, {
        subscriptions: [],
        delegationGroups: [],
        agentStatuses: {},
        waitingState: 'waiting',
      }),
    );
    const run = harness(seeded);
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(COMPLETED_DISPLAY_DURATION_MS);
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    confirmation.resolve(active(AGENT, CHILD, 'Confirmation'));
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.request.mock.calls).toEqual([
      ['agent.getSubscriptions', { workspaceId: WS, agentId: AGENT }],
      ['agent.getSubscriptions', { workspaceId: WS, agentId: AGENT }],
      ['agent.getSubscriptions', { workspaceId: WS, agentId: AGENT }],
    ]);
    trailing.resolve(active(AGENT, CHILD, 'Trailing'));
    await vi.advanceTimersByTimeAsync(0);
    expect(run.state().entries[makeKey(WS, AGENT)]?.subscriptions[0]?.description).toBe('Trailing');
    run.task.cancel();
    await run.task.toPromise();
  });

  it('cancels completed cleanup on workspace unmount without a late confirmation write', async () => {
    vi.useFakeTimers();
    mocks.request.mockResolvedValue(empty());
    const seeded = agentSubscriptionUIReducer(
      initialState,
      setSubscriptionSnapshot(WS, AGENT, {
        subscriptions: [],
        delegationGroups: [],
        agentStatuses: {},
        waitingState: 'waiting',
      }),
    );
    const run = harness(seeded);
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    await vi.advanceTimersByTimeAsync(0);
    run.channel.put(workspaceUnmounted(WS));
    await vi.advanceTimersByTimeAsync(COMPLETED_DISPLAY_DURATION_MS);

    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(run.state().entries[makeKey(WS, AGENT)]).toBeUndefined();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('cancels an active read and its trailing intent on workspace unmount', async () => {
    const first = deferred<ReturnType<typeof active>>();
    mocks.request.mockReturnValue(first.promise);
    const seeded = agentSubscriptionUIReducer(
      initialState,
      setSubscriptionSnapshot(WS, AGENT, {
        subscriptions: [],
        delegationGroups: [],
        agentStatuses: {},
        waitingState: 'waiting',
      }),
    );
    const run = harness(seeded);
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    await settle();
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    run.channel.put(workspaceUnmounted(WS));
    await settle();
    first.resolve(active());
    await settle();

    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(run.state()).toEqual(initialState);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('retains deletion state until tab removal cancels reads and deletes tracked entries', async () => {
    let resolve!: (value: ReturnType<typeof active>) => void;
    mocks.request.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const seeded = agentSubscriptionUIReducer(
      initialState,
      setSubscriptionSnapshot(WS, AGENT, {
        subscriptions: [],
        delegationGroups: [],
        agentStatuses: {},
        waitingState: 'idle',
      }),
    );
    const run = harness(seeded);
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    await settle();
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    run.channel.put(workspaceDeleted(WS, [AGENT]));
    await settle();
    expect(run.state()).toEqual(seeded);

    run.channel.put(workspaceUnmounted(WS));
    await settle();
    resolve(active());
    await settle();

    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(run.state().entries[makeKey(WS, AGENT)]).toBeUndefined();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('cancels a pending trailing read at root teardown without a late write', async () => {
    const first = deferred<ReturnType<typeof active>>();
    mocks.request.mockReturnValue(first.promise);
    const run = harness();
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    await settle();
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    run.task.cancel();
    await run.task.toPromise();
    first.resolve(active());
    await settle();

    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(run.state().entries[makeKey(WS, AGENT)]).toBeUndefined();
  });
});
