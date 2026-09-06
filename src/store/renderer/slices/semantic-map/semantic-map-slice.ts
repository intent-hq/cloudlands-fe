import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type {
  Manifest,
  MapActivity,
  MapActivityKind,
  MapSource,
  Route,
} from '$lib/components/visualization/semantic-map/core/types';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';

export const SEMANTIC_MAP_ACTIVITY_LIMIT = 5_000;

export interface SemanticMapTimeWindow {
  startTs: string | null;
  endTs: string | null;
}

type SemanticMapHydrationStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface SemanticMapWorkspaceState {
  hydrationStatus: SemanticMapHydrationStatus;
  manifest: Manifest | null;
  source: MapSource | null;
  activities: MapActivity[];
  route: Route | null;
  selectedAgentId: string | null;
  selectedTaskNoteId: string | null;
  selectedRegionId: string | null;
  timeWindow: SemanticMapTimeWindow;
  kindFilter: MapActivityKind[];
  agentFilter: string[];
}

export interface SemanticMapState {
  byWorkspaceId: Record<string, SemanticMapWorkspaceState>;
}

export const emptySemanticMapWorkspaceState: SemanticMapWorkspaceState = {
  hydrationStatus: 'idle',
  manifest: null,
  source: null,
  activities: [],
  route: null,
  selectedAgentId: null,
  selectedTaskNoteId: null,
  selectedRegionId: null,
  timeWindow: { startTs: null, endTs: null },
  kindFilter: [],
  agentFilter: [],
};

export const initialState: SemanticMapState = { byWorkspaceId: {} };

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } = createWorkspaceScopedHelpers(
  emptySemanticMapWorkspaceState,
);

export const semanticMapLoaded =
  createAction<[workspaceId: string, manifest: Manifest, source: MapSource]>('semanticMap/loaded');
export const semanticMapLoadStarted =
  createAction<[workspaceId: string]>('semanticMap/loadStarted');
export const semanticMapLoadFailed = createAction<[workspaceId: string]>('semanticMap/loadFailed');
export const semanticMapActivitiesLoaded = createAction<
  [workspaceId: string, activities: MapActivity[]]
>('semanticMap/activitiesLoaded');
export const semanticMapActivityReceived = createAction<
  [workspaceId: string, activity: MapActivity]
>('semanticMap/activityReceived');
export const semanticMapRefreshRequested = createAction<[workspaceId: string]>(
  'semanticMap/refreshRequested',
);
export const semanticMapRouteRefreshRequested = createAction<[workspaceId: string]>(
  'semanticMap/routeRefreshRequested',
);
export const semanticMapRouteLoaded =
  createAction<[workspaceId: string, route: Route | null]>('semanticMap/routeLoaded');
export const semanticMapSelectedAgentChanged = createAction<
  [workspaceId: string, agentId: string | null]
>('semanticMap/selectedAgentChanged');
export const semanticMapSelectedTaskChanged = createAction<
  [workspaceId: string, taskNoteId: string | null]
>('semanticMap/selectedTaskChanged');
export const semanticMapSelectedRegionChanged = createAction<
  [workspaceId: string, regionId: string | null]
>('semanticMap/selectedRegionChanged');
export const semanticMapTimeWindowChanged = createAction<
  [workspaceId: string, timeWindow: SemanticMapTimeWindow]
>('semanticMap/timeWindowChanged');
export const semanticMapKindFilterChanged = createAction<
  [workspaceId: string, kinds: MapActivityKind[]]
>('semanticMap/kindFilterChanged');
export const semanticMapAgentFilterChanged = createAction<
  [workspaceId: string, agentIds: string[]]
>('semanticMap/agentFilterChanged');
export const semanticMapCleared = createAction<[workspaceId: string]>('semanticMap/cleared');

export const semanticMapReducer = createReducer<SemanticMapState>(initialState);

semanticMapReducer.with(semanticMapLoadStarted, (state, { payload: [workspaceId] }) => {
  const workspaceState = getWorkspaceState(state, workspaceId);
  return setWorkspaceState(state, workspaceId, {
    ...workspaceState,
    hydrationStatus: 'loading',
  });
});
semanticMapReducer.with(
  semanticMapLoaded,
  (state, { payload: [workspaceId, manifest, source] }) => {
    const workspaceState = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...workspaceState,
      hydrationStatus: 'loaded',
      manifest,
      source,
    });
  },
);
semanticMapReducer.with(semanticMapLoadFailed, (state, { payload: [workspaceId] }) => {
  const workspaceState = getWorkspaceState(state, workspaceId);
  return setWorkspaceState(state, workspaceId, {
    ...workspaceState,
    hydrationStatus: 'error',
  });
});
semanticMapReducer.with(
  semanticMapActivitiesLoaded,
  (state, { payload: [workspaceId, activities] }) => {
    const workspaceState = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...workspaceState,
      activities: activities.slice(-SEMANTIC_MAP_ACTIVITY_LIMIT),
    });
  },
);
semanticMapReducer.with(
  semanticMapActivityReceived,
  (state, { payload: [workspaceId, activity] }) => {
    const workspaceState = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...workspaceState,
      activities: [...workspaceState.activities, activity].slice(-SEMANTIC_MAP_ACTIVITY_LIMIT),
    });
  },
);
semanticMapReducer.with(semanticMapRouteLoaded, (state, { payload: [workspaceId, route] }) => {
  const workspaceState = getWorkspaceState(state, workspaceId);
  return setWorkspaceState(state, workspaceId, { ...workspaceState, route });
});
semanticMapReducer.with(
  semanticMapSelectedAgentChanged,
  (state, { payload: [workspaceId, selectedAgentId] }) => {
    const workspaceState = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...workspaceState,
      route: null,
      selectedAgentId,
      selectedTaskNoteId: null,
      selectedRegionId: null,
    });
  },
);
semanticMapReducer.with(
  semanticMapSelectedTaskChanged,
  (state, { payload: [workspaceId, selectedTaskNoteId] }) => {
    const workspaceState = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...workspaceState,
      route: null,
      selectedAgentId: null,
      selectedTaskNoteId,
      selectedRegionId: null,
    });
  },
);
semanticMapReducer.with(
  semanticMapSelectedRegionChanged,
  (state, { payload: [workspaceId, selectedRegionId] }) => {
    const workspaceState = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, {
      ...workspaceState,
      route: null,
      selectedAgentId: null,
      selectedTaskNoteId: null,
      selectedRegionId,
    });
  },
);
semanticMapReducer.with(
  semanticMapTimeWindowChanged,
  (state, { payload: [workspaceId, timeWindow] }) => {
    const workspaceState = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, { ...workspaceState, timeWindow });
  },
);
semanticMapReducer.with(
  semanticMapKindFilterChanged,
  (state, { payload: [workspaceId, kindFilter] }) => {
    const workspaceState = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, { ...workspaceState, kindFilter });
  },
);
semanticMapReducer.with(
  semanticMapAgentFilterChanged,
  (state, { payload: [workspaceId, agentFilter] }) => {
    const workspaceState = getWorkspaceState(state, workspaceId);
    return setWorkspaceState(state, workspaceId, { ...workspaceState, agentFilter });
  },
);
semanticMapReducer.with(semanticMapCleared, (state, { payload: [workspaceId] }) =>
  clearWorkspaceState(state, workspaceId),
);
