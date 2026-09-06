import { store } from '../../store';
import type { MapActivity } from '$lib/components/visualization/semantic-map/core/types';
import {
  emptySemanticMapWorkspaceState,
  type SemanticMapWorkspaceState,
} from './semantic-map-slice';

export const selectSemanticMapState = store.createSelector<
  [workspaceId: string],
  SemanticMapWorkspaceState
>(
  (state, workspaceId) =>
    state.semanticMap.byWorkspaceId[workspaceId] ?? emptySemanticMapWorkspaceState,
);

export const selectFilteredSemanticMapActivities = store.createSelector<
  [workspaceId: string],
  MapActivity[]
>((state, workspaceId) => {
  const mapState = state.semanticMap.byWorkspaceId[workspaceId] ?? emptySemanticMapWorkspaceState;
  const { startTs, endTs } = mapState.timeWindow;
  return mapState.activities.filter((activity) => {
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
