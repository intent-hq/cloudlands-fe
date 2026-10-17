import { normalizeAgent } from '$lib/client/live/live-agents-client';
import { agentSessionReducer, bulkUpsertSessions } from '../../agent-session/agent-session-slice';
import { createEventRecoveryMiddleware } from '$store/renderer/middlewares/event-recovery';
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

import { initialState as workspaceEventsInitialState } from '../../workspace-events/workspace-events-slice';

import { tabStateReducer } from '../../tab-state/tab-state-slice';

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

function harness(
  seed = initialState,
  extraState: Record<string, unknown> = {},
  onDispatch?: () => void,
) {
  const channel = stdChannel();
  let state = seed;
  const listeners = new Set<() => void>();
  const getState = () => ({
    agentSubscriptionUI: state,
    tabState: tabStateReducer(undefined, { type: 'init' }),
    workspaceEvents: workspaceEventsInitialState,
    ...extraState,
  });
  const reduce = (action: any) => {
    state = agentSubscriptionUIReducer(state, action);
    listeners.forEach((listener) => listener());
    onDispatch?.();
    if (extraState.agentSessions)
      extraState.agentSessions = agentSessionReducer(extraState.agentSessions as never, action);
    return action;
  };
  const dispatch = vi.fn(createEventRecoveryMiddleware()({} as never)(reduce));
  const reduxStore = {
    getState,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const task = runSaga(
    { channel, dispatch, getState, context: { reduxStore } },
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
    expect(run.state().entries[makeKey(WS, AGENT)]).toEqual({
      ...seeded.entries[makeKey(WS, AGENT)],
      snapshotStatus: 'loading',
    });

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

it('refreshes only parents watching the changed child, including hidden tracked parents', async () => {
  mocks.request.mockResolvedValue(empty());
  const seed = agentSubscriptionUIReducer(
    initialState,
    setSubscriptionSnapshot(WS, AGENT, {
      ...active(),
      waitingState: 'waiting',
    }),
  );
  const unrelated = agentSubscriptionUIReducer(
    seed,
    setSubscriptionSnapshot(WS, 'unrelated', {
      ...empty(),
      waitingState: 'idle',
    }),
  );
  const run = harness(unrelated);
  run.channel.put(refreshWorkspaceSubscriptionEntriesRequested(WS, undefined, CHILD));
  await settle();
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(mocks.request).toHaveBeenCalledWith('agent.getSubscriptions', {
    workspaceId: WS,
    agentId: AGENT,
  });
  expect(run.state().entries[makeKey(WS, AGENT)]?.waitingState).toBe('completed');
  expect(run.state().entries[makeKey(WS, 'unrelated')]?.waitingState).toBe('idle');
  run.task.cancel();
});

it.each(['missing', 'denied', 'expired'] as const)(
  'rejects %s integrated subscription refresh before any read',
  async (kind) => {
    const { withRecoveryAdmissions } = await import('$store/renderer/middlewares/event-recovery');
    const { agentSubscriptionsRecoveryKey } = await import('$features/agent/agent-recovery-keys');
    mocks.request.mockClear();
    mocks.request.mockResolvedValue(empty());
    const seed = agentSubscriptionUIReducer(
      initialState,
      setSubscriptionSnapshot(WS, AGENT, { ...active(), waitingState: 'waiting' }),
    );
    const run = harness(seed);
    const token = { key: {}, isCurrent: () => false, commit: () => false };
    const admissions = new Map(
      kind === 'missing'
        ? []
        : [[agentSubscriptionsRecoveryKey(WS, AGENT), kind === 'denied' ? null : token]],
    );
    run.channel.put(
      withRecoveryAdmissions(refreshWorkspaceSubscriptionEntriesRequested(WS, AGENT), admissions),
    );
    await settle();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(run.state()).toEqual(seed);
    run.task.cancel();
  },
);

it.each([true, false])(
  'retains queued event admission when its original receipt current=%s',
  async (currentAtDrain) => {
    const { withRecoveryAdmissions } = await import('$store/renderer/middlewares/event-recovery');
    const { agentSubscriptionsRecoveryKey } = await import('$features/agent/agent-recovery-keys');
    mocks.request.mockClear();
    const held = deferred<ReturnType<typeof active>>();
    mocks.request
      .mockReturnValueOnce(held.promise)
      .mockResolvedValue(active(AGENT, CHILD, 'Trailing'));
    const run = harness();
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    await settle();
    let current = true;
    const token = {
      key: {},
      isCurrent: () => current,
      commit: (write: () => void) => {
        if (!current) return false;
        write();
        return true;
      },
    };
    run.channel.put(
      withRecoveryAdmissions(
        refreshWorkspaceSubscriptionEntriesRequested(WS, AGENT),
        new Map([[agentSubscriptionsRecoveryKey(WS, AGENT), token]]),
      ),
    );
    current = currentAtDrain;
    held.resolve(active(AGENT, CHILD, 'Initial'));
    for (let i = 0; i < 20; i++) await settle();
    expect(mocks.request).toHaveBeenCalledTimes(currentAtDrain ? 2 : 1);
    expect(run.state().entries[makeKey(WS, AGENT)]?.subscriptions[0]?.description).toBe(
      currentAtDrain ? 'Trailing' : 'Initial',
    );
    run.task.cancel();
  },
);

it('rejects a subscription event reply after its original admission expires', async () => {
  const { withRecoveryAdmissions } = await import('$store/renderer/middlewares/event-recovery');
  const { agentSubscriptionsRecoveryKey } = await import('$features/agent/agent-recovery-keys');
  mocks.request.mockClear();
  const held = deferred<ReturnType<typeof empty>>();
  mocks.request.mockReturnValueOnce(held.promise);
  const seed = agentSubscriptionUIReducer(
    initialState,
    setSubscriptionSnapshot(WS, AGENT, { ...active(), waitingState: 'waiting' }),
  );
  const run = harness(seed);
  let current = true;
  const token = {
    key: {},
    isCurrent: () => current,
    commit: (write: () => void) => {
      if (!current) return false;
      write();
      return true;
    },
  };
  run.channel.put(
    withRecoveryAdmissions(
      refreshWorkspaceSubscriptionEntriesRequested(WS, AGENT),
      new Map([[agentSubscriptionsRecoveryKey(WS, AGENT), token]]),
    ),
  );
  await settle();
  current = false;
  run.dispatch(
    setSubscriptionSnapshot(WS, AGENT, {
      ...active(AGENT, CHILD, 'Recovered'),
      waitingState: 'waiting',
    }),
  );
  held.resolve(empty());
  for (let i = 0; i < 20; i++) await settle();
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(run.state().entries[makeKey(WS, AGENT)]?.subscriptions[0]?.description).toBe('Recovered');
  run.task.cancel();
});

it('captures an initial ordinary read after its loading demand creates the recovery owner', async () => {
  const { rendererEventRecovery } = await import('$features/events/renderer-event-recovery');
  const { agentSubscriptionsRecoveryKey } = await import('$features/agent/agent-recovery-keys');
  const scope = rendererEventRecovery.attach({
    supported: true,
    isCurrent: () => true,
    onRetired: () => () => {},
    dispose: () => {},
    onNotification: () => () => {},
    request: async () => ({}),
    fence: async (_ids: unknown, observe: () => void) => observe(),
  } as never);
  mocks.request.mockClear();
  mocks.request.mockResolvedValue(active());
  let registered = false;
  const run = harness(initialState, {}, () => {
    if (registered) return;
    registered = true;
    scope.registerResource({
      key: agentSubscriptionsRecoveryKey(WS, AGENT),
      workspaceId: WS,
      eventTypes: ['agent:*'],
      isCurrent: () => true,
      read: async () => empty(),
      apply: () => {},
      invalidate: () => {},
      retire: () => {},
    });
  });
  try {
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    for (let i = 0; i < 20; i++) await settle();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(run.state().entries[makeKey(WS, AGENT)]?.snapshotStatus).toBe('ready');
  } finally {
    run.task.cancel();
    rendererEventRecovery.dispose();
  }
});

it('refreshes a cached cross-workspace watching parent without prior saga context', async () => {
  const { withRecoveryAdmissions } = await import('$store/renderer/middlewares/event-recovery');
  const { agentSubscriptionsRecoveryKey } = await import('$features/agent/agent-recovery-keys');
  mocks.request.mockClear();
  mocks.request.mockResolvedValue(active());
  const seed = agentSubscriptionUIReducer(
    initialState,
    setSubscriptionSnapshot(WS, AGENT, { ...active(), waitingState: 'waiting' }),
  );
  const run = harness(seed, {
    agentSessions: { byAgentId: { [AGENT]: { id: AGENT, workspaceId: WS } } },
  });
  const token = {
    key: {},
    isCurrent: () => true,
    commit: (write: () => void) => {
      write();
      return true;
    },
  };
  run.channel.put(
    withRecoveryAdmissions(
      refreshWorkspaceSubscriptionEntriesRequested('child-home', undefined, CHILD),
      new Map([[agentSubscriptionsRecoveryKey(WS, AGENT), token]]),
    ),
  );
  for (let i = 0; i < 20; i++) await settle();
  expect(mocks.request).toHaveBeenCalledExactlyOnceWith('agent.getSubscriptions', {
    workspaceId: WS,
    agentId: AGENT,
  });
  expect(run.state().entries[makeKey(WS, AGENT)]?.snapshotStatus).toBe('ready');
  run.task.cancel();
});

it.each(['retired', 'aba', 'stale', 'current'] as const)(
  'held parent snapshot honors original child workspace %s',
  async (transition) => {
    const { rendererEventRecovery } = await import('$features/events/renderer-event-recovery');
    const { agentMetadataRecoveryKey, agentSubscriptionsRecoveryKey } =
      await import('$features/agent/agent-recovery-keys');
    const scope = rendererEventRecovery.attach({
      supported: true,
      isCurrent: () => true,
      onRetired: () => () => {},
      dispose: () => {},
      onNotification: () => () => {},
      request: async () => ({}),
      fence: async (_ids: unknown, observe: () => void) => observe(),
    } as never);
    const childHome = 'child-private-home';
    for (const [key, workspaceId] of [
      [agentMetadataRecoveryKey(WS), WS],
      [agentMetadataRecoveryKey(childHome), childHome],
      [agentSubscriptionsRecoveryKey(WS, AGENT), WS],
    ])
      scope.registerResource({
        key,
        workspaceId,
        eventTypes: ['agent:*'],
        isCurrent: () => true,
        read: async () => [],
        apply: () => {},
        invalidate: () => {},
        retire: () => {},
      });
    const parent = normalizeAgent({
      id: AGENT,
      workspaceId: WS,
      status: 'idle',
      name: 'Authorized parent',
    });
    const extra = { agentSessions: agentSessionReducer(undefined, bulkUpsertSessions([parent])) };
    const held = deferred<any>();
    mocks.request.mockClear();
    mocks.request.mockReturnValueOnce(held.promise);
    const run = harness(initialState, extra);
    try {
      run.channel.put(requestSubscriptionFetch(WS, AGENT));
      for (let i = 0; i < 20; i++) await settle();
      expect(mocks.request).toHaveBeenCalledExactlyOnceWith('agent.getSubscriptions', {
        workspaceId: WS,
        agentId: AGENT,
      });
      if (transition === 'stale')
        rendererEventRecovery.invalidate(agentMetadataRecoveryKey(childHome));
      else if (transition !== 'current') rendererEventRecovery.retireWorkspace(childHome);
      if (transition === 'aba')
        scope.registerResource({
          key: agentMetadataRecoveryKey(childHome),
          workspaceId: childHome,
          eventTypes: ['agent:*'],
          isCurrent: () => true,
          read: async () => [],
          apply: () => {},
          invalidate: () => {},
          retire: () => {},
        });
      expect(
        rendererEventRecovery.capture(agentMetadataRecoveryKey(childHome)).commit(() => undefined),
      ).toBe(transition === 'current' || transition === 'aba');
      expect(
        rendererEventRecovery.capture(agentMetadataRecoveryKey(WS)).commit(() => undefined),
      ).toBe(true);
      held.resolve({
        ...active(),
        agents: [
          { id: CHILD, workspaceId: childHome, status: 'idle', name: 'Old private child' },
          { id: 'safe-sibling', workspaceId: WS, status: 'idle', name: 'Authorized sibling' },
        ],
      });
      for (let i = 0; i < 20; i++) await settle();
      expect(run.state().entries[makeKey(WS, AGENT)]?.snapshotStatus).toBe('ready');
      expect(extra.agentSessions.byAgentId[AGENT]?.name).toBe('Authorized parent');
      if (transition === 'current')
        expect(extra.agentSessions.byAgentId[CHILD]?.name).toBe('Old private child');
      else expect(extra.agentSessions.byAgentId[CHILD]).toBeUndefined();
      expect(extra.agentSessions.byAgentId['safe-sibling']?.name).toBe('Authorized sibling');
    } finally {
      run.task.cancel();
      rendererEventRecovery.dispose();
    }
  },
);

it.each(['retired', 'aba', 'current'] as const)(
  'held parent snapshot honors uncached child workspace authority %s',
  async (transition) => {
    const { rendererEventRecovery } = await import('$features/events/renderer-event-recovery');
    const { agentMetadataRecoveryKey, agentSubscriptionsRecoveryKey } =
      await import('$features/agent/agent-recovery-keys');
    const scope = rendererEventRecovery.attach({
      supported: true,
      isCurrent: () => true,
      onRetired: () => () => {},
      dispose: () => {},
      onNotification: () => () => {},
      request: async () => ({}),
      fence: async (_ids: unknown, observe: () => void) => observe(),
    } as never);
    const childHome = 'child-private-home';
    for (const [key, workspaceId] of [
      [agentMetadataRecoveryKey(WS), WS],
      [`agent-workspace-authority:${JSON.stringify([childHome])}`, childHome],
      [agentSubscriptionsRecoveryKey(WS, AGENT), WS],
    ])
      scope.registerResource({
        key,
        workspaceId,
        eventTypes: ['agent:*'],
        active: workspaceId !== childHome,
        isCurrent: () => true,
        read: async () => [],
        apply: () => {},
        invalidate: () => {},
        retire: () => {},
      });
    const parent = normalizeAgent({
      id: AGENT,
      workspaceId: WS,
      status: 'idle',
      name: 'Authorized parent',
    });
    const extra = { agentSessions: agentSessionReducer(undefined, bulkUpsertSessions([parent])) };
    const held = deferred<any>();
    mocks.request.mockClear();
    mocks.request.mockReturnValueOnce(held.promise);
    const run = harness(initialState, extra);
    try {
      run.channel.put(requestSubscriptionFetch(WS, AGENT));
      for (let i = 0; i < 20; i++) await settle();
      expect(mocks.request).toHaveBeenCalledExactlyOnceWith('agent.getSubscriptions', {
        workspaceId: WS,
        agentId: AGENT,
      });
      expect(rendererEventRecovery.hasOwner(agentMetadataRecoveryKey(childHome))).toBe(false);
      if (transition !== 'current') rendererEventRecovery.retireWorkspace(childHome);
      if (transition === 'aba')
        scope.registerResource({
          key: `agent-workspace-authority:${JSON.stringify([childHome])}`,
          workspaceId: childHome,
          eventTypes: ['agent:*'],
          active: false,
          isCurrent: () => true,
          read: async () => [],
          apply: () => {},
          invalidate: () => {},
          retire: () => {},
        });
      expect(
        rendererEventRecovery
          .captureAuthority(`agent-workspace-authority:${JSON.stringify([childHome])}`)
          .commit(() => undefined),
      ).toBe(transition === 'current' || transition === 'aba');
      expect(
        rendererEventRecovery.capture(agentMetadataRecoveryKey(WS)).commit(() => undefined),
      ).toBe(true);
      held.resolve({
        ...active(),
        agents: [
          { id: CHILD, workspaceId: childHome, status: 'idle', name: 'Old private child' },
          { id: 'safe-sibling', workspaceId: WS, status: 'idle', name: 'Authorized sibling' },
        ],
      });
      for (let i = 0; i < 20; i++) await settle();
      expect(run.state().entries[makeKey(WS, AGENT)]?.snapshotStatus).toBe('ready');
      expect(extra.agentSessions.byAgentId[AGENT]?.name).toBe('Authorized parent');
      if (transition === 'current')
        expect(extra.agentSessions.byAgentId[CHILD]?.name).toBe('Old private child');
      else expect(extra.agentSessions.byAgentId[CHILD]).toBeUndefined();
      expect(extra.agentSessions.byAgentId['safe-sibling']?.name).toBe('Authorized sibling');
    } finally {
      run.task.cancel();
      rendererEventRecovery.dispose();
    }
  },
);
