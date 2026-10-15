import { store } from '@/store';
import { sidebarSearchMatches } from '$lib/components/workspace/sidebar/sidebar-search';
import { matchesHomeFilter, type HomeFilter } from '../../../../../src/features/home/home-model';
import * as authority from '../../../../../src/store/renderer/slices/workspace/workspace-authority-projections';
export const selectWorkspaceIds = store.createSelector((state) => state.workspace.workspaces.ids);
export const selectWorkspaceNavigationIds = store.createSelector((state, query: string) => {
  const ids = state.workspace.workspaces.ids;
  if (!query.trim()) return ids;
  return ids.filter((id) => {
    const workspace = authority.getWorkspaceById(state, id);
    return (
      workspace &&
      sidebarSearchMatches(query, [
        workspace.id,
        workspace.title,
        workspace.repositoryName,
        workspace.repositoryOwner,
        workspace.branch,
        workspace.statusMessage,
      ])
    );
  });
});
export const selectHomeWorkspaceIds = store.createSelector(
  (state, query: string, filter: HomeFilter) =>
    selectWorkspaceNavigationIds.select(state, query).filter((id) => {
      const workspace = authority.getWorkspaceById(state, id);
      return workspace && matchesHomeFilter(workspace, filter);
    }),
);
export const selectWorkspaceListLoadedForBackend = store.createSelector(
  authority.getWorkspaceListLoadedForBackend,
);
export const selectWorkspaceCapabilitiesReady = store.createSelector(
  authority.getWorkspaceCapabilitiesReady,
);
export const selectWorkspaceById = store.createSelector(authority.getWorkspaceById);
export const selectCanManageWorkspace = store.createSelector(authority.getCanManageWorkspace);
export const selectWorkspaceManagementDenied = store.createSelector(
  authority.getWorkspaceManagementDenied,
);
export const selectWorkspaceManagementVisible = store.createSelector(
  authority.getWorkspaceManagementVisible,
);
export const selectIsWorkspaceCollaborator = store.createSelector(
  authority.getIsWorkspaceCollaborator,
);
export const selectWorkspaceActionContext = store.createSelector(
  authority.getWorkspaceActionContext,
);
export const selectWorkspaceParticipationContext = store.createSelector(
  authority.getWorkspaceParticipationContext,
);
export const selectWorkspacePermissionContext = store.createSelector(
  authority.getWorkspacePermissionContext,
);

export const selectWorkspaceDeletionTokens = store.createSelector(
  authority.getWorkspaceDeletionTokens,
);

export const selectWorkspaceUpdateContext = store.createSelector(
  authority.getWorkspaceUpdateContext,
);

export const selectWorkspaceListReadStatus = store.createSelector(
  authority.getWorkspaceListReadStatus,
);
