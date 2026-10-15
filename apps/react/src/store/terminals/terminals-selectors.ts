import { store } from '../index';
import { getTerminalsForWorkspace } from '../../../../../src/store/renderer/slices/terminals/terminals-projections';

export const selectTerminalsForWorkspace = store.createSelector(getTerminalsForWorkspace);

import {
  getTerminalOperations,
  getTerminalRead,
} from '../../../../../src/store/renderer/slices/terminals/terminals-projections';
import {
  selectWorkspaceActionContext,
  selectWorkspaceById,
} from '../workspace/workspace-selectors';
import { selectAdmittedWorkspaceReadContext } from '../workspace-lifecycle/workspace-lifecycle-selectors';
import { getPrincipalSnapshot } from '../../../../../src/store/renderer/slices/principal/principal-projections';

export const selectTerminalContext = store.createSelector((state, workspaceId: string) => {
  const workspace = selectWorkspaceById.select(state, workspaceId);
  const root = workspace?.worktreePath || workspace?.repositoryPath;
  const admission = selectAdmittedWorkspaceReadContext.select(state, workspaceId);
  const action = selectWorkspaceActionContext.select(state, workspaceId);
  return admission && action && root
    ? JSON.stringify([action, root, state.daemonHealth.connectionGeneration])
    : null;
});
export const selectTerminalAuthorityKey = store.createSelector((state, workspaceId: string) => {
  if (!selectTerminalContext.select(state, workspaceId)) return null;
  const principal = getPrincipalSnapshot(state)?.principal;
  const workspace = selectWorkspaceById.select(state, workspaceId);
  return principal
    ? JSON.stringify([
        state.connections.windowBackendId,
        principal.id,
        principal.hostMembershipRevision,
        workspaceId,
        workspace?.worktreePath || workspace?.repositoryPath,
      ])
    : null;
});
export const selectTerminalRead = store.createSelector(getTerminalRead);
export const selectTerminalOperations = store.createSelector(getTerminalOperations);
