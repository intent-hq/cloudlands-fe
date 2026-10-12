import type { WorkspaceLoadState } from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-types';
import { store } from '@/store';
import {
  createIsWorkspaceHydratedProjection,
  createIsWorkspaceSessionLiveProjection,
  getMountedWorkspaceIds,
  getWorkspaceLoadState,
  getWorkspaceSessionPhase,
} from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-projections';
export const selectMountedWorkspaceIds = store.createSelector(getMountedWorkspaceIds);

const selectWorkspaceSessionPhase = store.createSelector<[wsId: string]>(getWorkspaceSessionPhase);

export const selectIsWorkspaceHydrated = store.createSelector<[wsId: string], boolean>(
  createIsWorkspaceHydratedProjection(selectWorkspaceSessionPhase),
);

export const selectIsWorkspaceSessionLive = store.createSelector<[wsId: string], boolean>(
  createIsWorkspaceSessionLiveProjection(selectWorkspaceSessionPhase),
);

export const selectWorkspaceLoadState = store.createSelector<[wsId: string], WorkspaceLoadState>(
  getWorkspaceLoadState,
);
