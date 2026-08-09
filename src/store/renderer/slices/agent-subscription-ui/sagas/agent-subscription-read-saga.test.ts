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
import { workspaceDeleted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  agentSubscriptionReadSaga,
  COMPLETED_DISPLAY_DURATION_MS,
} from './agent-subscription-read-saga';

const WS = 'ws-subscriptions';
const AGENT = 'agent-parent';
const CHILD = 'agent-child';
const empty = () => ({ subscriptions: [], delegationGroups: [], agentStatuses: {} });
const active = () => ({
  subscriptions: [{
    id: 'watch-1',
    agentId: AGENT,
    eventTypes: ['agent:idle'],
    actorIds: [CHILD],
    createdAt: '2026-01-01T00:00:00.000Z',
    description: 'Waiting',
  }],
  delegationGroups: [{
    groupId: 'group-1',
    parentAgentId: AGENT,
    awaitMode: 'all',
    expectedAgentIds: [CHILD],
    completedAgentIds: [],
    deletedAgentIds: [],
    delivered: false,
  }],
  agentStatuses: { [AGENT]: 'waiting', [CHILD]: 'responding' },
});
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function harness(seed = initialState) {
  const channel = stdChannel();
  let state = seed;
  const dispatch = vi.fn((action) => { state = agentSubscriptionUIReducer(state, action); });
  const task = runSaga(
    { channel, dispatch, getState: () => ({ agentSubscriptionUI: state }) },
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
      subscriptions: [{
        id: 'watch-1',
        agentId: AGENT,
        eventTypes: ['agent:idle'],
        actorIds: [CHILD],
        createdAt: '2026-01-01T00:00:00.000Z',
        description: 'Waiting',
      }],
      waitingState: 'waiting',
      agentStatuses: { [AGENT]: 'waiting', [CHILD]: 'responding' },
      delegationGroups: [{
        groupId: 'group-1',
        awaitMode: 'all',
        expectedAgentIds: [CHILD],
        completedAgentIds: [],
        deletedAgentIds: [],
        agentStatuses: { [CHILD]: 'responding' },
        delivered: false,
      }],
      wokenUpInfo: null,
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('coalesces duplicate fetches and refreshes every tracked workspace entry', async () => {
    let resolve!: (value: ReturnType<typeof active>) => void;
    mocks.request.mockReturnValue(new Promise((done) => { resolve = done; }));
    const seeded = agentSubscriptionUIReducer(
      initialState,
      setSubscriptionSnapshot(WS, AGENT, {
        subscriptions: [], delegationGroups: [], agentStatuses: {}, waitingState: 'idle',
      }),
    );
    const run = harness(seeded);
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    run.channel.put(refreshWorkspaceSubscriptionEntriesRequested(WS));
    await settle();
    expect(mocks.request).toHaveBeenCalledTimes(1);
    resolve(active());
    await settle();
    run.task.cancel();
    await run.task.toPromise();
  });

  it('leaves the prior entry intact when the read fails', async () => {
    mocks.request.mockRejectedValue(new Error('read failed'));
    const seeded = agentSubscriptionUIReducer(
      initialState,
      setSubscriptionSnapshot(WS, AGENT, {
        subscriptions: [], delegationGroups: [], agentStatuses: {}, waitingState: 'waiting',
      }),
    );
    const run = harness(seeded);
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    await settle();

    expect(run.state()).toEqual(seeded);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('confirms a completed transition after the delay and resets it to idle', async () => {
    vi.useFakeTimers();
    mocks.request.mockResolvedValue(empty());
    const seeded = agentSubscriptionUIReducer(
      initialState,
      setSubscriptionSnapshot(WS, AGENT, {
        subscriptions: [], delegationGroups: [], agentStatuses: {}, waitingState: 'waiting',
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

  it('cancels late reads and deletes tracked entries on workspace deletion', async () => {
    let resolve!: (value: ReturnType<typeof active>) => void;
    mocks.request.mockReturnValue(new Promise((done) => { resolve = done; }));
    const seeded = agentSubscriptionUIReducer(
      initialState,
      setSubscriptionSnapshot(WS, AGENT, {
        subscriptions: [], delegationGroups: [], agentStatuses: {}, waitingState: 'idle',
      }),
    );
    const run = harness(seeded);
    run.channel.put(requestSubscriptionFetch(WS, AGENT));
    await settle();
    run.channel.put(workspaceDeleted(WS, [AGENT]));
    await settle();
    resolve(active());
    await settle();

    expect(run.state().entries[makeKey(WS, AGENT)]).toBeUndefined();
    run.task.cancel();
    await run.task.toPromise();
  });
});