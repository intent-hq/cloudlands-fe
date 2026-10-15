import { store } from '@/store';
import { selectWorkspaceById, selectWorkspaceUpdateContext } from './workspace-selectors';
import { selectAdmittedWorkspaceReadContext } from '../workspace-lifecycle/workspace-lifecycle-selectors';
import * as title from '../../../../../src/store/renderer/slices/workspace/workspace-title-projections';
import {
  getPrincipalSnapshot,
  getHostRole,
} from '../../../../../src/store/renderer/slices/principal/principal-projections';

export const selectWorkspaceTitleAuthority = store.createSelector((state, workspaceId: string) => {
  const permission = selectWorkspaceUpdateContext.select(state, workspaceId, ['id', 'title']);
  const workspace = selectWorkspaceById.select(state, workspaceId);
  const principal = getPrincipalSnapshot(state)?.principal;
  return permission && workspace && principal
    ? JSON.stringify([
        state.connections.windowBackendId,
        principal.id,
        principal.hostMembershipRevision,
        getHostRole(state),
        workspaceId,
        workspace.worktreePath || workspace.repositoryPath,
      ])
    : null;
});
export const selectWorkspaceTitleContext = store.createSelector((state, workspaceId: string) => {
  const authority = selectWorkspaceTitleAuthority.select(state, workspaceId);
  const read = selectAdmittedWorkspaceReadContext.select(state, workspaceId);
  return authority && read
    ? JSON.stringify([authority, read, state.daemonHealth.connectionGeneration])
    : null;
});
export const selectWorkspaceTitleOperations = store.createSelector(
  title.getWorkspaceTitleOperations,
);
export const selectWorkspaceTitleRevision = store.createSelector(title.getWorkspaceTitleRevision);
export const selectPendingWorkspaceTitleToken = store.createSelector(
  title.getPendingWorkspaceTitleToken,
);
export const selectWorkspaceTitleViewCurrent = store.createSelector(
  title.getWorkspaceTitleViewCurrent,
);
