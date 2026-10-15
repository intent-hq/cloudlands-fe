import { store } from '@/store';
import { selectAgentSession, selectAgentDetailHydrated } from './agent-session-selectors';
import {
  selectWorkspaceActionContext,
  selectWorkspaceById,
} from '../workspace/workspace-selectors';
import {
  selectAdmittedWorkspaceReadContext,
} from '../workspace-lifecycle/workspace-lifecycle-selectors';
import {
  getPrincipalSnapshot,
  getHostRole,
} from '../../../../../src/store/renderer/slices/principal/principal-projections';
import * as rename from '../../../../../src/store/renderer/slices/agent-session/agent-session-projections';

export const selectAgentRenameAuthority = store.createSelector(
  (state, workspaceId: string, agentId: string) => {
    const session = selectAgentSession.select(state, agentId);
    const workspace = selectWorkspaceById.select(state, workspaceId);
    const principal = getPrincipalSnapshot(state)?.principal;
    return selectWorkspaceActionContext.select(state, workspaceId) &&
      principal &&
      workspace &&
      session?.workspaceId === workspaceId &&
      !session.retiredAt
      ? JSON.stringify([
          state.connections.windowBackendId,
          principal.id,
          principal.hostMembershipRevision,
          getHostRole(state),
          workspaceId,
          agentId,
          workspace.worktreePath || workspace.repositoryPath,
        ])
      : null;
  },
);
export const selectAgentRenameContext = store.createSelector(
  (state, workspaceId: string, agentId: string) => {
    const authority = selectAgentRenameAuthority.select(state, workspaceId, agentId);
    const read = selectAdmittedWorkspaceReadContext.select(state, workspaceId);
    return authority &&
      read &&
      selectAgentDetailHydrated.select(state, agentId)
      ? JSON.stringify([authority, read, state.daemonHealth.connectionGeneration])
      : null;
  },
);
export const selectAgentRenameRevision = store.createSelector(rename.getAgentRenameRevision);
export const selectAgentRenameOperations = store.createSelector(rename.getAgentRenameOperations);
export const selectAgentRenameViewCurrent = store.createSelector(rename.getAgentRenameViewCurrent);
