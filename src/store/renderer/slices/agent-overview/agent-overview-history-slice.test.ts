import { describe, expect, it } from 'vitest';
import type { WorkspaceEvent } from '$features/events/types';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { eventReceived } from '../workspace-events/workspace-events-slice';
import {
  GRAPH_HISTORY_MAX_EVENTS,
  agentOverviewHistoryReducer,
  graphHistoryLoadCompleted,
  graphHistoryLoadFailed,
  graphHistoryLoadStarted,
  graphHistoryPageReceived,
  initialState,
} from './agent-overview-history-slice';

const WS = 'ws-history';

function event(id: string, minute: number): WorkspaceEvent {
  return {
    id,
    workspaceId: WS,
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
    type: 'file:changed',
    actor: { type: 'agent', id: 'agent-1' },
    data: { path: `src/${id}.ts`, action: 'modify' },
  };
}

describe('agentOverviewHistoryReducer', () => {
  it('starts idle and records loading lifecycle metadata', () => {
    let state = agentOverviewHistoryReducer(initialState, graphHistoryLoadStarted(WS));
    expect(state.byWorkspaceId[WS]).toMatchObject({ status: 'loading' });
    expect(getItems(state.byWorkspaceId[WS].events)).toEqual([]);

    state = agentOverviewHistoryReducer(state, graphHistoryLoadCompleted(WS, 'loaded-now'));
    expect(state.byWorkspaceId[WS]).toMatchObject({
      status: 'complete',
      nextToken: null,
      loadedAt: 'loaded-now',
    });

    state = agentOverviewHistoryReducer(state, graphHistoryLoadFailed(WS));
    expect(state.byWorkspaceId[WS].status).toBe('error');
  });

  it('sanitizes, dedupes, and stores paged events oldest to newest', () => {
    const cyclic = event('middle', 2) as WorkspaceEvent & { data: Record<string, unknown> };
    cyclic.data.self = cyclic.data;
    const state = agentOverviewHistoryReducer(
      initialState,
      graphHistoryPageReceived(
        WS,
        [event('newest', 3), cyclic, event('oldest', 1), cyclic],
        'next',
      ),
    );

    expect(getItems(state.byWorkspaceId[WS].events).map((item) => item.id)).toEqual([
      'oldest',
      'middle',
      'newest',
    ]);
    expect(state.byWorkspaceId[WS].nextToken).toBe('next');
    expect(() => JSON.stringify(state)).not.toThrow();
  });

  it('appends live events, dedupes by id, and retains the newest 5,000', () => {
    const page = Array.from({ length: GRAPH_HISTORY_MAX_EVENTS }, (_, index) =>
      event(`event-${index}`, index),
    );
    let state = agentOverviewHistoryReducer(initialState, graphHistoryPageReceived(WS, page, null));
    state = agentOverviewHistoryReducer(state, eventReceived(WS, event('event-4999', 6000)));
    state = agentOverviewHistoryReducer(state, eventReceived(WS, event('live', 6001)));

    const events = getItems(state.byWorkspaceId[WS].events);
    expect(events).toHaveLength(GRAPH_HISTORY_MAX_EVENTS);
    expect(events[0].id).toBe('event-1');
    expect(events.at(-1)?.id).toBe('live');
  });

  it('drops malformed timestamps while preserving valid chronological neighbours', () => {
    let state = agentOverviewHistoryReducer(
      initialState,
      graphHistoryPageReceived(
        WS,
        [
          event('later', 3),
          { ...event('invalid', 2), timestamp: 'not-a-date' },
          event('earlier', 1),
        ],
        null,
      ),
    );
    state = agentOverviewHistoryReducer(
      state,
      eventReceived(WS, { ...event('invalid-live', 4), timestamp: '2026-01-01' }),
    );

    expect(getItems(state.byWorkspaceId[WS].events).map((item) => item.id)).toEqual([
      'earlier',
      'later',
    ]);
  });
});
