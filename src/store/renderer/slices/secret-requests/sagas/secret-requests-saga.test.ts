import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';
import type { RendererStoreBridge } from '../../../renderer-store-bridge';
import type { StoreState } from '../../../types';
import { getPrincipalConnectionContext } from '../../principal/principal-context';

const client = vi.hoisted(() => ({
  secretList: vi.fn(),
  secretProvide: vi.fn(),
  secretDismiss: vi.fn(),
}));

vi.mock('$lib/client', () => ({ appClient: { agents: client } }));

const renderer = vi.hoisted(() => ({
  store: null as RendererStoreBridge | null,
  transport: {},
}));
vi.mock('$store/renderer/renderer-store-bridge', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getRendererStore: () => {
    if (!renderer.store) throw new Error('No renderer store');
    return renderer.store;
  },
}));
vi.mock('$lib/client/live/backend-transport-factory', () => ({
  resolveBackendTransport: () => renderer.transport,
}));

import {
  stashSecretValue,
  takeSecretValue,
} from '$lib/components/chat/secrets/secret-value-handoff';
import {
  secretAnswerRequested,
  secretAnswerUpdated,
  secretListFailed,
  secretListLoaded,
  secretListRequested,
} from '../secret-requests-slice';
import { secretRequestsSaga } from './secret-requests-saga';

type Action = { type: string; payload?: unknown[] };

function admittedState(generation = 0, principalId = 'person-a'): StoreState {
  const connection = {
    connections: { hasReceivedList: true, windowBackendId: 'host' },
    daemonHealth: { connectionGeneration: generation, health: 'up' },
    workspaceEvents: { subscriptionGeneration: 1, subscriptionPending: false },
  };
  return {
    ...connection,
    principal: {
      context: getPrincipalConnectionContext(connection as StoreState),
      status: 'ready',
      snapshot: {
        principal: { id: principalId, hostRole: 'owner', hostMembershipRevision: 1 },
        capabilities: { hostMembership: true },
      },
      invalidation: 0,
      presentationVersion: 0,
    },
  } as StoreState;
}

const tasks: ReturnType<typeof runSaga>[] = [];

function start(getState: () => StoreState = () => admittedState()) {
  const channel = stdChannel();
  const subscribers = new Set<() => void>();
  const send = (action: Action) => {
    for (const subscriber of subscribers) subscriber();
    channel.put(action as never);
  };
  const dispatched: Action[] = [];
  const dispatch = (action: Action) => {
    dispatched.push(action);
    send(action);
    return action;
  };
  renderer.store = {
    get state() {
      return getState();
    },
    dispatch,
  };
  const task = runSaga(
    {
      channel,
      dispatch,
      getState,
      context: {
        reduxStore: {
          getState,
          subscribe: (subscriber: () => void) => {
            subscribers.add(subscriber);
            return () => subscribers.delete(subscriber);
          },
        },
      },
    },
    secretRequestsSaga,
  );
  tasks.push(task);
  return { channel: { put: send }, dispatched, task };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const listing = { secrets: [], pendingRequests: [], answeredRequests: [] };

describe('secretRequestsSaga', () => {
  beforeEach(() => {
    client.secretList.mockReset();
    client.secretProvide.mockReset();
    client.secretDismiss.mockReset();
    renderer.store = null;
    renderer.transport = {};
  });
  afterEach(() => {
    for (const task of tasks.splice(0)) task.cancel();
    renderer.store = null;
  });

  it('provides the stashed value exactly once, keeping it out of every action', async () => {
    client.secretProvide.mockResolvedValue({ ok: true });
    client.secretList.mockResolvedValue(listing);
    let principalId = 'person-a';
    const { channel, dispatched, task } = start(() => admittedState(1, principalId));
    stashSecretValue('sec-1', 'hunter2');
    channel.put(
      secretAnswerRequested({
        workspaceId: 'w',
        agentId: 'a',
        requestId: 'sec-1',
        outcome: 'provided',
      }) as never,
    );
    await flush();
    expect(client.secretProvide).toHaveBeenCalledWith({
      workspaceId: 'w',
      requestId: 'sec-1',
      value: 'hunter2',
    });
    expect(takeSecretValue('sec-1')).toBeUndefined();
    expect(dispatched.map((a) => a.type)).toEqual(
      expect.arrayContaining([
        secretAnswerUpdated.type,
        secretListRequested.type,
        secretListLoaded.type,
      ]),
    );
    const last = dispatched.filter((a) => a.type === secretAnswerUpdated.type).at(-1);
    expect(last?.payload).toEqual(['sec-1', 'provided', 1]);
    const loaded = dispatched.find((a) => a.type === secretListLoaded.type);
    // The refresh after the answer starts at its epoch, so it may replace it.
    expect(loaded?.payload).toEqual(['a', listing, ['sec-1'], 1]);
    expect(JSON.stringify(dispatched)).not.toContain('hunter2');

    let resolveAnswer: (value: unknown) => void = () => {};
    client.secretProvide.mockImplementationOnce(
      () => new Promise((resolve) => (resolveAnswer = resolve)),
    );
    stashSecretValue('sec-retired', 'private-for-first-person');
    channel.put(
      secretAnswerRequested({
        workspaceId: 'w',
        agentId: 'a',
        requestId: 'sec-retired',
        outcome: 'provided',
      }) as never,
    );
    await flush();
    const beforeRetirement = dispatched.length;
    principalId = 'person-b';
    resolveAnswer({ ok: true });
    await flush();
    await flush();
    expect(
      dispatched.slice(beforeRetirement),
      'retired answer must not update the new caller',
    ).toEqual([]);
    expect(takeSecretValue('sec-retired')).toBeUndefined();
    expect(client.secretProvide).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(dispatched)).not.toContain('private-for-first-person');
    task.cancel();
  });

  it('fails without a stashed value and marks lost requests expired', async () => {
    client.secretDismiss.mockResolvedValue({ ok: false, expired: true, error: 'gone' });
    client.secretList.mockResolvedValue(listing);
    const { channel, dispatched, task } = start();
    channel.put(
      secretAnswerRequested({
        workspaceId: 'w',
        agentId: 'a',
        requestId: 'sec-2',
        outcome: 'provided',
      }) as never,
    );
    channel.put(
      secretAnswerRequested({
        workspaceId: 'w',
        agentId: 'a',
        requestId: 'sec-3',
        outcome: 'declined',
      }) as never,
    );
    await flush();
    expect(client.secretProvide).not.toHaveBeenCalled();
    const statuses = dispatched
      .filter((a) => a.type === secretAnswerUpdated.type)
      .map((a) => a.payload?.slice(0, 2));
    expect(statuses).toContainEqual(['sec-2', 'failed']);
    expect(statuses).toContainEqual(['sec-3', 'expired']);
    task.cancel();
  });

  it('coalesces list refreshes per agent into one trailing call covering every id', async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    client.secretList
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValue(listing);
    const { channel, dispatched, task } = start();
    channel.put(secretListRequested('w', 'a', ['sec-1']) as never);
    for (let i = 2; i < 5; i += 1)
      channel.put(secretListRequested('w', 'a', [`sec-${i}`]) as never);
    await flush();
    expect(client.secretList).toHaveBeenCalledTimes(1);
    resolveFirst(listing);
    await flush();
    await flush();
    expect(client.secretList).toHaveBeenCalledTimes(2);
    expect(client.secretList).toHaveBeenLastCalledWith({ workspaceId: 'w', agentId: 'a' });
    const loaded = dispatched.filter((a) => a.type === secretListLoaded.type).map((a) => a.payload);
    expect(loaded).toEqual([
      ['a', listing, ['sec-1'], 0],
      ['a', listing, ['sec-2', 'sec-3', 'sec-4'], 0],
    ]);
    task.cancel();
  });

  it('reports a failed refresh so cards do not wait forever', async () => {
    client.secretList.mockResolvedValue(null);
    const { channel, dispatched, task } = start();
    channel.put(secretListRequested('w', 'a', ['sec-1']) as never);
    await flush();
    expect(dispatched.map((a) => a.type)).toContain(secretListFailed.type);
    expect(dispatched.map((a) => a.type)).not.toContain(secretListLoaded.type);
    task.cancel();
  });

  it('drops a listing whose daemon connection changed while it was in flight', async () => {
    let generation = 1;
    let resolveList: (value: unknown) => void = () => {};
    client.secretList.mockImplementationOnce(
      () => new Promise((resolve) => (resolveList = resolve)),
    );
    const { channel, dispatched, task } = start(() => admittedState(generation));
    channel.put(secretListRequested('w', 'a', ['sec-1']) as never);
    await flush();
    generation = 2;
    resolveList(listing);
    await flush();
    expect(dispatched.map((a) => a.type)).not.toContain(secretListLoaded.type);
    expect(dispatched.map((a) => a.type)).not.toContain(secretListFailed.type);
    task.cancel();

    let principalId = 'person-a';
    let resolveOldOwner: (value: unknown) => void = () => {};
    client.secretList
      .mockReset()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveOldOwner = resolve)));
    const current = start(() => admittedState(2, principalId));
    current.channel.put(secretListRequested('w', 'a', ['sec-old']) as never);
    await flush();
    principalId = 'person-b';
    resolveOldOwner({ ...listing, secrets: [{ name: 'OLD_PERSON_NAME' }] });
    await flush();
    expect(
      current.dispatched.map((action) => action.type),
      'retired principal listing must not populate the new caller',
    ).not.toContain(secretListLoaded.type);
    expect(current.dispatched.map((action) => action.type)).not.toContain(secretListFailed.type);
    client.secretList.mockResolvedValue(listing);
    current.channel.put(secretListRequested('w', 'a', ['sec-current']) as never);
    await flush();
    expect(current.dispatched.filter((action) => action.type === secretListLoaded.type)).toEqual([
      secretListLoaded('a', listing, ['sec-current'], 0),
    ]);
    current.task.cancel();
  });
});
