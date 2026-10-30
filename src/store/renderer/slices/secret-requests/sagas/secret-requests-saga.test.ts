import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const client = vi.hoisted(() => ({
  secretList: vi.fn(),
  secretProvide: vi.fn(),
  secretDismiss: vi.fn(),
}));

vi.mock('$lib/client', () => ({ appClient: { agents: client } }));

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

function start() {
  const channel = stdChannel();
  const dispatched: Action[] = [];
  const task = runSaga(
    {
      channel,
      dispatch: (action: Action) => {
        dispatched.push(action);
        channel.put(action as never);
        return action;
      },
      getState: () => ({}),
    },
    secretRequestsSaga,
  );
  return { channel, dispatched, task };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const listing = { secrets: [], pendingRequests: [], answeredRequests: [] };

describe('secretRequestsSaga', () => {
  beforeEach(() => {
    client.secretList.mockReset();
    client.secretProvide.mockReset();
    client.secretDismiss.mockReset();
  });

  it('provides the stashed value exactly once, keeping it out of every action', async () => {
    client.secretProvide.mockResolvedValue({ ok: true });
    client.secretList.mockResolvedValue(listing);
    const { channel, dispatched, task } = start();
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
    expect(last?.payload).toEqual(['sec-1', 'provided']);
    expect(JSON.stringify(dispatched)).not.toContain('hunter2');
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
      .map((a) => a.payload);
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
      ['a', listing, ['sec-1']],
      ['a', listing, ['sec-2', 'sec-3', 'sec-4']],
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
});
