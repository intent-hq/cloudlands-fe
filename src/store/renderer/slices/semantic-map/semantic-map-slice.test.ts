import { describe, expect, it } from 'vitest';
import type { MapActivity } from '$lib/components/visualization/semantic-map/core/types';
import { SEMANTIC_MAP_FIXTURE_MANIFEST } from '$lib/components/visualization/semantic-map/core/fixtures';
import {
  initialState,
  SEMANTIC_MAP_ACTIVITY_LIMIT,
  semanticMapActivitiesLoaded,
  semanticMapActivityReceived,
  semanticMapAgentFilterChanged,
  semanticMapCleared,
  semanticMapKindFilterChanged,
  semanticMapLoaded,
  semanticMapReducer,
  semanticMapSelectedAgentChanged,
  semanticMapSelectedRegionChanged,
  semanticMapTimeWindowChanged,
} from './semantic-map-slice';

const WORKSPACE_ID = 'ws-1';

function activity(index: number): MapActivity {
  return {
    agentId: `agent-${index % 3}`,
    kind: index % 2 === 0 ? 'read' : 'edit',
    ts: new Date(index * 1_000).toISOString(),
  };
}

describe('semanticMapReducer', () => {
  it('returns the initial state', () => {
    expect(semanticMapReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  it('stores the daemon manifest and source for one workspace', () => {
    const state = semanticMapReducer(
      initialState,
      semanticMapLoaded(WORKSPACE_ID, SEMANTIC_MAP_FIXTURE_MANIFEST, 'curated'),
    );

    expect(state.byWorkspaceId[WORKSPACE_ID].manifest).toBe(SEMANTIC_MAP_FIXTURE_MANIFEST);
    expect(state.byWorkspaceId[WORKSPACE_ID].source).toBe('curated');
  });

  it('caps both loaded and incrementally received activity at 5,000 newest entries', () => {
    const activities = Array.from({ length: SEMANTIC_MAP_ACTIVITY_LIMIT + 2 }, (_, index) =>
      activity(index),
    );
    let state = semanticMapReducer(
      initialState,
      semanticMapActivitiesLoaded(WORKSPACE_ID, activities),
    );
    expect(state.byWorkspaceId[WORKSPACE_ID].activities).toHaveLength(SEMANTIC_MAP_ACTIVITY_LIMIT);
    expect(state.byWorkspaceId[WORKSPACE_ID].activities[0]).toBe(activities[2]);

    const newest = activity(SEMANTIC_MAP_ACTIVITY_LIMIT + 2);
    state = semanticMapReducer(state, semanticMapActivityReceived(WORKSPACE_ID, newest));
    expect(state.byWorkspaceId[WORKSPACE_ID].activities).toHaveLength(SEMANTIC_MAP_ACTIVITY_LIMIT);
    expect(state.byWorkspaceId[WORKSPACE_ID].activities.at(-1)).toBe(newest);
  });

  it('updates selection and filter state without changing daemon-owned activity', () => {
    const activities = [activity(1)];
    let state = semanticMapReducer(
      initialState,
      semanticMapActivitiesLoaded(WORKSPACE_ID, activities),
    );
    state = semanticMapReducer(state, semanticMapSelectedAgentChanged(WORKSPACE_ID, 'agent-1'));
    state = semanticMapReducer(
      state,
      semanticMapSelectedRegionChanged(WORKSPACE_ID, 'renderer-state'),
    );
    state = semanticMapReducer(
      state,
      semanticMapTimeWindowChanged(WORKSPACE_ID, {
        startTs: '2026-09-06T02:00:00.000Z',
        endTs: '2026-09-06T03:00:00.000Z',
      }),
    );
    state = semanticMapReducer(state, semanticMapKindFilterChanged(WORKSPACE_ID, ['edit']));
    state = semanticMapReducer(state, semanticMapAgentFilterChanged(WORKSPACE_ID, ['agent-1']));

    expect(state.byWorkspaceId[WORKSPACE_ID]).toMatchObject({
      activities,
      selectedAgentId: 'agent-1',
      selectedRegionId: 'renderer-state',
      timeWindow: {
        startTs: '2026-09-06T02:00:00.000Z',
        endTs: '2026-09-06T03:00:00.000Z',
      },
      kindFilter: ['edit'],
      agentFilter: ['agent-1'],
    });
  });

  it('clears only the requested workspace', () => {
    let state = semanticMapReducer(
      initialState,
      semanticMapLoaded(WORKSPACE_ID, SEMANTIC_MAP_FIXTURE_MANIFEST, 'curated'),
    );
    state = semanticMapReducer(
      state,
      semanticMapLoaded('ws-2', SEMANTIC_MAP_FIXTURE_MANIFEST, 'structural'),
    );
    state = semanticMapReducer(state, semanticMapCleared(WORKSPACE_ID));

    expect(state.byWorkspaceId[WORKSPACE_ID]).toBeUndefined();
    expect(state.byWorkspaceId['ws-2'].source).toBe('structural');
  });
});
