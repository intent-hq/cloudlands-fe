import { store } from '../../store';
import type { Workspace } from '$shared/types';
import { getItem } from '@augmentcode/themis/utils/collections/collection-utils';
import type { WorkspaceLoadError, WorkspaceLoadState } from './workspace-lifecycle-types';

const INITIAL_WORKSPACE_LOAD_STATE: WorkspaceLoadState = {
  status: 'idle',
  error: null,
};

export const selectWorkspaceLoadState = store.createSelector<[wsId: string], WorkspaceLoadState>(
  (state, wsId) => state.workspaceLifecycle.loadByWorkspaceId[wsId] ?? INITIAL_WORKSPACE_LOAD_STATE,
);

export const selectWorkspaceLoadError = store.createSelector<
  [wsId: string],
  WorkspaceLoadError | null
>((state, wsId) => selectWorkspaceLoadState.select(state, wsId).error);

export const selectWorkspaceLoadResult = store.createSelector<
  [wsId: string],
  Workspace | undefined
>((state, wsId) => {
  return (
    getItem(state.workspace.workspaces, wsId as Workspace['id']) ??
    state.workspace.pendingCreations[wsId]
  );
});

const selectWorkspaceSessionPhase = store.createSelector<[wsId: string]>(
  (state, wsId) => state.workspaceLifecycle.sessionPhaseByWorkspaceId[wsId],
);

export const selectIsWorkspaceHydrated = store.createSelector<[wsId: string], boolean>(
  (state, wsId) => {
    const phase = selectWorkspaceSessionPhase.select(state, wsId);
    return phase === 'hydrated' || phase === 'live';
  },
);

export const selectIsWorkspaceSessionLive = store.createSelector<[wsId: string], boolean>(
  (state, wsId) => selectWorkspaceSessionPhase.select(state, wsId) === 'live',
);
