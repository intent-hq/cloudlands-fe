import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appClient } from '$lib/client';
import type { WorkspaceEvent } from '$features/events/types';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import {
  agentOverviewHistoryReducer,
  graphHistoryLoadCompleted,
  loadGraphHistoryRequested,
} from '../agent-overview-history-slice';
import { agentOverviewHistorySaga } from './agent-overview-history-saga';

const WS = 'ws-history';
const NOW = '2026-09-05T12:00:00.000Z';
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function event(id: string, minute: number): WorkspaceEvent {
  return {
    id,
    workspaceId: WS,
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
    type: 'agent:created',
    actor: { type: 'agent', id: 'agent-1' },
  };
}

function harness(completed = false) {
  const channel = stdChannel();
  let state = agentOverviewHistoryReducer(undefined, { type: '@@init' } as never);
  if (completed) state = agentOverviewHistoryReducer(state, graphHistoryLoadCompleted(WS, NOW));
  const actions: unknown[] = [];
  const task = runSaga(
    {
      channel,
      getState: () => ({ agentOverviewHistory: state }),
      dispatch: (action) => {
        state = agentOverviewHistoryReducer(state, action);
        actions.push(action);
        return action;
      },
    },
    agentOverviewHistorySaga,
  );
  return { actions, channel, getState: () => state, task };
}

describe('agentOverviewHistorySaga', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('follows nextToken pages, dedupes them, and completes the load', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const queryPage = vi
      .spyOn(appClient.events, 'queryPage')
      .mockResolvedValueOnce({ items: [event('new', 3), event('shared', 2)], nextToken: 'older' })
      .mockResolvedValueOnce({ items: [event('shared', 2), event('old', 1)], nextToken: null });
    const run = harness();

    run.channel.put(loadGraphHistoryRequested(WS));
    await settle();

    expect(queryPage.mock.calls).toEqual([
      [WS, { limit: 200 }],
      [WS, { limit: 200, nextToken: 'older' }],
    ]);
    expect(run.getState().byWorkspaceId[WS]).toMatchObject({
      status: 'complete',
      loadedAt: NOW,
    });
    expect(getItems(run.getState().byWorkspaceId[WS].events).map((item) => item.id)).toEqual([
      'old',
      'shared',
      'new',
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('does not reload completed history', async () => {
    const queryPage = vi.spyOn(appClient.events, 'queryPage');
    const run = harness(true);

    run.channel.put(loadGraphHistoryRequested(WS));
    await settle();

    expect(queryPage).not.toHaveBeenCalled();
    expect(run.actions).toEqual([]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('records an error when a page request fails', async () => {
    vi.spyOn(appClient.events, 'queryPage').mockRejectedValueOnce(new Error('offline'));
    const run = harness();

    run.channel.put(loadGraphHistoryRequested(WS));
    await settle();

    expect(run.getState().byWorkspaceId[WS].status).toBe('error');
    run.task.cancel();
    await run.task.toPromise();
  });

  it('stops with an error when paging does not advance', async () => {
    const queryPage = vi
      .spyOn(appClient.events, 'queryPage')
      .mockResolvedValue({ items: [], nextToken: 'repeat' });
    const run = harness();

    run.channel.put(loadGraphHistoryRequested(WS));
    await settle();

    expect(queryPage).toHaveBeenCalledOnce();
    expect(run.getState().byWorkspaceId[WS]).toMatchObject({
      status: 'error',
      nextToken: 'repeat',
    });
    expect(getItems(run.getState().byWorkspaceId[WS].events)).toEqual([]);
    run.task.cancel();
    await run.task.toPromise();
  });
});
