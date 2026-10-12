import { store } from '@/store';
import {
  createIsWorkspaceSessionLiveProjection,
  getMountedWorkspaceIds,
  getWorkspaceSessionPhase,
} from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-projections';
export const selectMountedWorkspaceIds = store.createSelector(getMountedWorkspaceIds);

const selectWorkspaceSessionPhase = store.createSelector<[wsId: string]>(getWorkspaceSessionPhase);

export const selectIsWorkspaceSessionLive = store.createSelector<[wsId: string], boolean>(
  createIsWorkspaceSessionLiveProjection(selectWorkspaceSessionPhase),
);
