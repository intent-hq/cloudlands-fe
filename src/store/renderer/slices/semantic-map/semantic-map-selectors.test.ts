import { describe, expect, it } from 'vitest';
import type { StoreState } from '../../types';
import {
  SEMANTIC_MAP_FIXTURE_ACTIVITIES,
  SEMANTIC_MAP_FIXTURE_MANIFEST,
} from '$lib/components/visualization/semantic-map/core/fixtures';
import {
  initialState,
  semanticMapAgentFilterChanged,
  semanticMapHydrated,
  semanticMapKindFilterChanged,
  semanticMapLoadStarted,
  semanticMapReducer,
  semanticMapTimeWindowChanged,
} from './semantic-map-slice';
import {
  selectFilteredSemanticMapActivities,
  selectSemanticMapState,
} from './semantic-map-selectors';

const WORKSPACE_ID = 'ws-1';
const GENERATION = 1;

function withActivities() {
  let slice = semanticMapReducer(initialState, semanticMapLoadStarted(WORKSPACE_ID, GENERATION));
  slice = semanticMapReducer(
    slice,
    semanticMapHydrated(
      WORKSPACE_ID,
      GENERATION,
      SEMANTIC_MAP_FIXTURE_MANIFEST,
      'curated',
      SEMANTIC_MAP_FIXTURE_ACTIVITIES,
      [],
    ),
  );
  return slice;
}

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
    const slice = withActivities();

    expect(selectFilteredSemanticMapActivities.select(rootState(slice), WORKSPACE_ID)).toEqual(
      SEMANTIC_MAP_FIXTURE_ACTIVITIES,
    );
  });

  it('filters by kind, agent, and inclusive time window without aggregating', () => {
    let slice = withActivities();
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
