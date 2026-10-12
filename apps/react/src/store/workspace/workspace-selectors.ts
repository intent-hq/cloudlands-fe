import { store } from '@/store';
import * as authority from '../../../../../src/store/renderer/slices/workspace/workspace-authority-projections';
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
