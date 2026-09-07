import { describe, expect, it } from 'vitest';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type {
  Manifest,
  MapActivity,
  Route,
} from '$lib/components/visualization/semantic-map/core/types';
import { SEMANTIC_MAP_FIXTURE_MANIFEST } from '$lib/components/visualization/semantic-map/core/fixtures';
import {
  initialState,
  SEMANTIC_MAP_ACTIVITY_LIMIT,
  semanticMapActivityReceived,
  semanticMapAgentFilterChanged,
  semanticMapCleared,
  semanticMapKindFilterChanged,
  semanticMapLoadFailed,
  semanticMapLoadStarted,
  semanticMapHydrated,
  semanticMapReducer,
  semanticMapRouteLoaded,
  semanticMapSelectedAgentChanged,
  semanticMapSelectedRegionChanged,
  semanticMapSelectedTaskChanged,
  semanticMapTimeWindowChanged,
} from './semantic-map-slice';

const WORKSPACE_ID = 'ws-1';
const GENERATION = 1;

function activity(index: number): MapActivity {
  return {
    id: `activity-${index}`,
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
    let state = semanticMapReducer(initialState, semanticMapLoadStarted(WORKSPACE_ID, GENERATION));
    expect(state.byWorkspaceId[WORKSPACE_ID].hydrationStatus).toBe('loading');

    state = semanticMapReducer(
      state,
      semanticMapHydrated(
        WORKSPACE_ID,
        GENERATION,
        SEMANTIC_MAP_FIXTURE_MANIFEST,
        'curated',
        [],
        [],
      ),
    );

    expect(state.byWorkspaceId[WORKSPACE_ID].hydrationStatus).toBe('loaded');
    expect(state.byWorkspaceId[WORKSPACE_ID].manifest).toBe(SEMANTIC_MAP_FIXTURE_MANIFEST);
    expect(state.byWorkspaceId[WORKSPACE_ID].source).toBe('curated');
  });

  it('exposes hydration failure without replacing the last daemon snapshot', () => {
    let state = semanticMapReducer(initialState, semanticMapLoadStarted(WORKSPACE_ID, GENERATION));
    state = semanticMapReducer(
      state,
      semanticMapHydrated(
        WORKSPACE_ID,
        GENERATION,
        SEMANTIC_MAP_FIXTURE_MANIFEST,
        'structural',
        [],
        [],
      ),
    );
    state = semanticMapReducer(state, semanticMapLoadFailed(WORKSPACE_ID, GENERATION));

    expect(state.byWorkspaceId[WORKSPACE_ID]).toMatchObject({
      hydrationStatus: 'error',
      manifest: SEMANTIC_MAP_FIXTURE_MANIFEST,
      source: 'structural',
    });
  });

  it('caps both loaded and incrementally received activity at 5,000 newest entries', () => {
    const activities = Array.from({ length: SEMANTIC_MAP_ACTIVITY_LIMIT + 2 }, (_, index) =>
      activity(index),
    );
    let state = semanticMapReducer(initialState, semanticMapLoadStarted(WORKSPACE_ID, GENERATION));
    state = semanticMapReducer(
      state,
      semanticMapHydrated(
        WORKSPACE_ID,
        GENERATION,
        SEMANTIC_MAP_FIXTURE_MANIFEST,
        'curated',
        activities,
        [],
      ),
    );
    expect(getItems(state.byWorkspaceId[WORKSPACE_ID].activities)).toHaveLength(
      SEMANTIC_MAP_ACTIVITY_LIMIT,
    );
    expect(getItems(state.byWorkspaceId[WORKSPACE_ID].activities)[0]).toBe(activities[2]);

    const newest = activity(SEMANTIC_MAP_ACTIVITY_LIMIT + 2);
    state = semanticMapReducer(state, semanticMapActivityReceived(WORKSPACE_ID, newest));
    expect(getItems(state.byWorkspaceId[WORKSPACE_ID].activities)).toHaveLength(
      SEMANTIC_MAP_ACTIVITY_LIMIT,
    );
    expect(getItems(state.byWorkspaceId[WORKSPACE_ID].activities).at(-1)).toBe(newest);
  });

  it('updates selection and filter state without changing daemon-owned activity', () => {
    const activities = [activity(1)];
    let state = semanticMapReducer(initialState, semanticMapLoadStarted(WORKSPACE_ID, GENERATION));
    state = semanticMapReducer(
      state,
      semanticMapHydrated(
        WORKSPACE_ID,
        GENERATION,
        SEMANTIC_MAP_FIXTURE_MANIFEST,
        'curated',
        activities,
        [],
      ),
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

    expect(getItems(state.byWorkspaceId[WORKSPACE_ID].activities)).toEqual(activities);
    expect(state.byWorkspaceId[WORKSPACE_ID]).toMatchObject({
      selectedAgentId: null,
      selectedRegionId: 'renderer-state',
      timeWindow: {
        startTs: '2026-09-06T02:00:00.000Z',
        endTs: '2026-09-06T03:00:00.000Z',
      },
      kindFilter: ['edit'],
      agentFilter: ['agent-1'],
    });
  });

  it('stores daemon routes and clears stale routes when selection changes', () => {
    const route: Route = {
      visits: ['one', 'two'],
      transitions: [{ from: 'one', to: 'two', count: 1, evidence: ['src/x.ts'] }],
    };
    let state = semanticMapReducer(initialState, semanticMapLoadStarted(WORKSPACE_ID, GENERATION));
    state = semanticMapReducer(state, semanticMapSelectedAgentChanged(WORKSPACE_ID, 'agent-1'));
    state = semanticMapReducer(
      state,
      semanticMapRouteLoaded(WORKSPACE_ID, GENERATION, { agentId: 'agent-1' }, route),
    );
    expect(state.byWorkspaceId[WORKSPACE_ID].route).toBe(route);

    state = semanticMapReducer(state, semanticMapSelectedTaskChanged(WORKSPACE_ID, 'task-1'));
    expect(state.byWorkspaceId[WORKSPACE_ID]).toMatchObject({
      route: null,
      selectedAgentId: null,
      selectedTaskNoteId: 'task-1',
    });

    state = semanticMapReducer(state, semanticMapSelectedAgentChanged(WORKSPACE_ID, 'agent-1'));
    expect(state.byWorkspaceId[WORKSPACE_ID]).toMatchObject({
      route: null,
      selectedAgentId: 'agent-1',
      selectedTaskNoteId: null,
    });
  });

  it('merges activity received during hydration by daemon id', () => {
    const replayed = activity(1);
    const live = activity(2);
    let state = semanticMapReducer(initialState, semanticMapLoadStarted(WORKSPACE_ID, GENERATION));
    state = semanticMapReducer(state, semanticMapActivityReceived(WORKSPACE_ID, live));
    state = semanticMapReducer(
      state,
      semanticMapHydrated(
        WORKSPACE_ID,
        GENERATION,
        SEMANTIC_MAP_FIXTURE_MANIFEST,
        'curated',
        [replayed],
        [],
      ),
    );

    expect(getItems(state.byWorkspaceId[WORKSPACE_ID].activities)).toEqual([replayed, live]);
  });

  it('appends live activity for mounted and unmounted workspace state', () => {
    const live = activity(4);
    const unmountedState = semanticMapReducer(
      initialState,
      semanticMapActivityReceived(WORKSPACE_ID, live),
    );
    let mountedState = semanticMapReducer(
      initialState,
      semanticMapLoadStarted(WORKSPACE_ID, GENERATION),
    );
    mountedState = semanticMapReducer(
      mountedState,
      semanticMapActivityReceived(WORKSPACE_ID, live),
    );

    expect(getItems(unmountedState.byWorkspaceId[WORKSPACE_ID].activities)).toEqual([live]);
    expect(getItems(mountedState.byWorkspaceId[WORKSPACE_ID].activities)).toEqual([live]);
  });

  it('atomically reconciles removed regions and activity when the manifest changes', () => {
    const oldActivity = { ...activity(1), regionId: 'removed' };
    const reclassifiedActivity = { ...oldActivity, regionId: 'renderer-state' };
    const liveActivity = { ...activity(2), regionId: 'renderer-state' };
    const nextManifest: Manifest = {
      ...SEMANTIC_MAP_FIXTURE_MANIFEST,
      regions: SEMANTIC_MAP_FIXTURE_MANIFEST.regions.filter(
        (region) => region.id !== 'event-stream',
      ),
    };
    let state = semanticMapReducer(initialState, semanticMapLoadStarted(WORKSPACE_ID, GENERATION));
    state = semanticMapReducer(
      state,
      semanticMapHydrated(
        WORKSPACE_ID,
        GENERATION,
        SEMANTIC_MAP_FIXTURE_MANIFEST,
        'curated',
        [oldActivity],
        [],
      ),
    );
    state = semanticMapReducer(
      state,
      semanticMapSelectedRegionChanged(WORKSPACE_ID, 'event-stream'),
    );
    state = semanticMapReducer(state, semanticMapLoadStarted(WORKSPACE_ID, GENERATION));
    state = semanticMapReducer(state, semanticMapActivityReceived(WORKSPACE_ID, liveActivity));
    state = semanticMapReducer(
      state,
      semanticMapHydrated(
        WORKSPACE_ID,
        GENERATION,
        nextManifest,
        'curated',
        [reclassifiedActivity],
        [oldActivity.id],
      ),
    );

    expect(state.byWorkspaceId[WORKSPACE_ID].selectedRegionId).toBeNull();
    expect(getItems(state.byWorkspaceId[WORKSPACE_ID].activities)).toEqual([
      reclassifiedActivity,
      liveActivity,
    ]);
  });

  it('drops stale generation and subject results without resurrecting cleared state', () => {
    const route: Route = { visits: ['one'], transitions: [] };
    let state = semanticMapReducer(initialState, semanticMapLoadStarted(WORKSPACE_ID, GENERATION));
    state = semanticMapReducer(state, semanticMapSelectedAgentChanged(WORKSPACE_ID, 'agent-2'));
    const current = state;
    state = semanticMapReducer(
      state,
      semanticMapRouteLoaded(WORKSPACE_ID, GENERATION, { agentId: 'agent-1' }, route),
    );
    state = semanticMapReducer(
      state,
      semanticMapRouteLoaded(WORKSPACE_ID, GENERATION - 1, { agentId: 'agent-2' }, route),
    );
    expect(state).toBe(current);

    state = semanticMapReducer(state, semanticMapCleared(WORKSPACE_ID));
    state = semanticMapReducer(
      state,
      semanticMapHydrated(
        WORKSPACE_ID,
        GENERATION,
        SEMANTIC_MAP_FIXTURE_MANIFEST,
        'curated',
        [],
        [],
      ),
    );
    expect(state.byWorkspaceId[WORKSPACE_ID]).toBeUndefined();
  });

  it('clears only the requested workspace', () => {
    let state = semanticMapReducer(initialState, semanticMapLoadStarted(WORKSPACE_ID, GENERATION));
    state = semanticMapReducer(state, semanticMapLoadStarted('ws-2', GENERATION));
    state = semanticMapReducer(
      state,
      semanticMapHydrated('ws-2', GENERATION, SEMANTIC_MAP_FIXTURE_MANIFEST, 'structural', [], []),
    );
    state = semanticMapReducer(state, semanticMapCleared(WORKSPACE_ID));

    expect(state.byWorkspaceId[WORKSPACE_ID]).toBeUndefined();
    expect(state.byWorkspaceId['ws-2'].source).toBe('structural');
  });
});
