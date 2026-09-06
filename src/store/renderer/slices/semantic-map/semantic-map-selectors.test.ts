import { describe, expect, it } from 'vitest';
import type { StoreState } from '../../types';
import { SEMANTIC_MAP_FIXTURE_ACTIVITIES } from '$lib/components/visualization/semantic-map/core/fixtures';
import {
  initialState,
  semanticMapActivitiesLoaded,
  semanticMapAgentFilterChanged,
  semanticMapKindFilterChanged,
  semanticMapReducer,
  semanticMapTimeWindowChanged,
} from './semantic-map-slice';
import {
  selectFilteredSemanticMapActivities,
  selectSemanticMapState,
} from './semantic-map-selectors';

const WORKSPACE_ID = 'ws-1';

function rootState(semanticMap: ReturnType<typeof semanticMapReducer>): StoreState {
  return { semanticMap } as StoreState;
}

describe('semantic-map selectors', () => {
  it('returns the empty workspace state before a map is loaded', () => {
    const selected = selectSemanticMapState.select(rootState(initialState), WORKSPACE_ID);

    expect(selected.activities).toEqual([]);
    expect(selected.manifest).toBeNull();
  });

  it('returns the daemon activity unchanged when filters are empty', () => {
    const slice = semanticMapReducer(
      initialState,
      semanticMapActivitiesLoaded(WORKSPACE_ID, SEMANTIC_MAP_FIXTURE_ACTIVITIES),
    );

    expect(selectFilteredSemanticMapActivities.select(rootState(slice), WORKSPACE_ID)).toEqual(
      SEMANTIC_MAP_FIXTURE_ACTIVITIES,
    );
  });

  it('filters by kind, agent, and inclusive time window without aggregating', () => {
    let slice = semanticMapReducer(
      initialState,
      semanticMapActivitiesLoaded(WORKSPACE_ID, SEMANTIC_MAP_FIXTURE_ACTIVITIES),
    );
    slice = semanticMapReducer(slice, semanticMapKindFilterChanged(WORKSPACE_ID, ['edit']));
    slice = semanticMapReducer(slice, semanticMapAgentFilterChanged(WORKSPACE_ID, ['agent-1']));
    slice = semanticMapReducer(
      slice,
      semanticMapTimeWindowChanged(WORKSPACE_ID, {
        startTs: '2026-09-06T02:01:00.000Z',
        endTs: '2026-09-06T02:01:00.000Z',
      }),
    );

    const selected = selectFilteredSemanticMapActivities.select(rootState(slice), WORKSPACE_ID);
    expect(selected).toEqual([SEMANTIC_MAP_FIXTURE_ACTIVITIES[1]]);
  });
});
