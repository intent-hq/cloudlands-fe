import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const storage = vi.hoisted(() => ({
  getItem: vi.fn(() => null),
  getItemWithStatus: vi.fn(() => ({ value: null, hadError: false })),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  keysWithPrefix: vi.fn(() => []),
  getJSON: vi.fn(),
  setJSON: vi.fn(),
}));
vi.mock('$lib/utils/safe-storage', () => ({ safeLocalStorage: storage }));

import type { StoreState } from '../../../types';
import {
  clearAgentUnread,
  clearAgentsUnread,
  clearAllUnread,
  clearWorkspaceUnread,
  markAgentAsViewed,
  newAssistantMessage,
} from '../unread-tracking-slice';
import {
  clearWorkspaceUnreadWorker,
  hydrateUnreadTrackingWorker,
  unreadTrackingSaga,
} from './unread-tracking-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function state(unreadAgentIds: string[] = ['agent-2', 'agent-1', 'agent-3']): StoreState {
  return {
    unreadTracking: { unreadAgentIds, currentlyViewedAgentId: null },
    workspaceAgents: {
      byWorkspaceId: {
        'ws-1': { agentIds: ['agent-1', 'agent-2'] },
        'ws-empty': { agentIds: [] },
      },
    },
  } as unknown as StoreState;
}

describe('unreadTrackingSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.getJSON.mockReturnValue(undefined);
  });

  it('hydrates once before watching and filters malformed stored IDs', async () => {
    storage.getJSON.mockReturnValue(['agent-1', 7, null, 'agent-2']);
    const dispatch = vi.fn();
    await runSaga({ dispatch, getState: state }, hydrateUnreadTrackingWorker).toPromise();

    expect(storage.getJSON.mock.calls).toEqual([['augment:unread-agents']]);
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      {
        type: 'unreadTracking/hydrate',
        payload: [{ unreadAgentIds: ['agent-1', 'agent-2'] }],
      },
    ]);
  });

  it('does not hydrate malformed or empty storage', async () => {
    const dispatch = vi.fn();
    storage.getJSON.mockReturnValueOnce({ unreadAgentIds: ['agent-1'] }).mockReturnValueOnce([]);
    await runSaga({ dispatch, getState: state }, hydrateUnreadTrackingWorker).toPromise();
    await runSaga({ dispatch, getState: state }, hydrateUnreadTrackingWorker).toPromise();

    expect(dispatch.mock.calls).toEqual([]);
  });

  it('fans a workspace clear out to only its unread agents in workspace order', async () => {
    const dispatch = vi.fn();
    await runSaga(
      { dispatch, getState: state },
      clearWorkspaceUnreadWorker,
      clearWorkspaceUnread('ws-1'),
    ).toPromise();

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'unreadTracking/clearAgentsUnread', payload: [['agent-1', 'agent-2']] },
    ]);
  });

  it('does not fan out empty, unknown, or already-read workspace clears', async () => {
    const dispatch = vi.fn();
    await runSaga(
      { dispatch, getState: () => state(['agent-3']) },
      clearWorkspaceUnreadWorker,
      clearWorkspaceUnread('ws-1'),
    ).toPromise();
    await runSaga(
      { dispatch, getState: state },
      clearWorkspaceUnreadWorker,
      clearWorkspaceUnread(''),
    ).toPromise();
    await runSaga(
      { dispatch, getState: state },
      clearWorkspaceUnreadWorker,
      clearWorkspaceUnread('ws-missing'),
    ).toPromise();

    expect(dispatch.mock.calls).toEqual([]);
  });

  it('persists the exact post-reducer unread snapshot for every middleware trigger', async () => {
    const channel = stdChannel();
    const task = runSaga({ channel, dispatch: vi.fn(), getState: state }, unreadTrackingSaga);
    channel.put(markAgentAsViewed('agent-1'));
    channel.put(newAssistantMessage('agent-4', 'ws-1', false));
    channel.put(clearAgentUnread('agent-2'));
    channel.put(clearAgentsUnread(['agent-1', 'agent-2']));
    channel.put(clearAllUnread());
    await settle();

    expect(storage.setJSON.mock.calls).toEqual([
      ['augment:unread-agents', ['agent-2', 'agent-1', 'agent-3']],
      ['augment:unread-agents', ['agent-2', 'agent-1', 'agent-3']],
      ['augment:unread-agents', ['agent-2', 'agent-1', 'agent-3']],
      ['augment:unread-agents', ['agent-2', 'agent-1', 'agent-3']],
      ['augment:unread-agents', ['agent-2', 'agent-1', 'agent-3']],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('swallows storage failures and keeps later persistence active', async () => {
    storage.getJSON.mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    storage.setJSON.mockImplementation(() => {
      throw new Error('quota');
    });
    const channel = stdChannel();
    const task = runSaga({ channel, dispatch: vi.fn(), getState: state }, unreadTrackingSaga);
    channel.put(clearAllUnread());
    channel.put(clearAllUnread());
    await settle();

    expect(storage.setJSON.mock.calls).toEqual([
      ['augment:unread-agents', ['agent-2', 'agent-1', 'agent-3']],
      ['augment:unread-agents', ['agent-2', 'agent-1', 'agent-3']],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('cancels pending hydration without dispatching or installing persistence watchers', async () => {
    let resolve!: (value: unknown) => void;
    storage.getJSON.mockReturnValue(new Promise((done) => (resolve = done)));
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch, getState: state }, unreadTrackingSaga);
    task.cancel();
    resolve(['late-agent']);
    await task.toPromise();
    channel.put(clearAllUnread());
    await settle();

    expect(dispatch.mock.calls).toEqual([]);
    expect(storage.setJSON.mock.calls).toEqual([]);
  });
});