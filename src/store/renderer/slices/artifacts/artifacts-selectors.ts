import { store } from '../../store';
import type { PendingArtifactSelection } from './artifacts-types';

export const selectPendingArtifactSelections = store.createSelector(
  (state, workspaceId: string, targetAgentId: string): PendingArtifactSelection[] =>
    Object.values(state.artifacts.byWorkspaceId[workspaceId]?.pending ?? {}).filter(
      (entry) => entry.targetAgentId === targetAgentId,
    ),
);

export const selectArtifactImages = store.createSelector(
  (state, workspaceId: string) => state.artifacts.byWorkspaceId[workspaceId]?.images ?? {},
);
