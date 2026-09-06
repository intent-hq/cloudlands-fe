import { store } from '../../store';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import type { MapActivity } from '$lib/components/visualization/semantic-map/core/types';
import {
  emptySemanticMapWorkspaceState,
  type SemanticMapWorkspaceState,
} from './semantic-map-slice';

export type SemanticMapViewState = Omit<SemanticMapWorkspaceState, 'activities'> & {
  activities: MapActivity[];
};

export const selectSemanticMapState = store.createSelector<
  [workspaceId: string],
  SemanticMapViewState
>((state, workspaceId) => {
  const mapState = state.semanticMap.byWorkspaceId[workspaceId] ?? emptySemanticMapWorkspaceState;
  return { ...mapState, activities: getItems(mapState.activities) };
});

export const selectFilteredSemanticMapActivities = store.createSelector<
  [workspaceId: string],
  MapActivity[]
>((state, workspaceId) => {
  const mapState = state.semanticMap.byWorkspaceId[workspaceId] ?? emptySemanticMapWorkspaceState;
  const { startTs, endTs } = mapState.timeWindow;
  return getItems(mapState.activities).filter((activity) => {
    if (mapState.kindFilter.length > 0 && !mapState.kindFilter.includes(activity.kind))
      return false;
    if (
      mapState.agentFilter.length > 0 &&
      (!activity.agentId || !mapState.agentFilter.includes(activity.agentId))
    ) {
      return false;
    }
    if (startTs && activity.ts < startTs) return false;
    if (endTs && activity.ts > endTs) return false;
    return true;
  });
});
