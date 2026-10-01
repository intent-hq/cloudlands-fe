import { selectPrincipalActionContext } from '../principal/principal-selectors';
import {
  selectWorkspaceManagementDenied,
  selectWorkspaceListLoadedForBackend,
  selectWorkspacePermissionContext,
} from '../workspace/workspace-selectors';
import { store } from '../../store';
import { getItems, type Collection } from '@themislib/themis/utils/collections/collection-utils';
import type { PermissionRequest } from './permission-slice';

export const selectPermissionRequestsCollection = store.createSelector(
  (state): Collection<PermissionRequest, 'requestId'> => {
    return state.permission.requests;
  },
);

/** Select all permission requests */
export const selectPermissionRequests = store.createSelector((state) => {
  return getItems(selectPermissionRequestsCollection.select(state));
});

/** Select permission requests for a specific session/agent */
const selectRequestsForSession = store.createSelector((state, sessionId: string) => {
  return selectPermissionRequests.select(state).filter((r) => r.sessionId === sessionId);
});

/** Select the count of pending requests for a session */
export const selectPendingCount = store.createSelector((state, sessionId: string) => {
  return selectRequestsForSession.select(state, sessionId).length;
});

// A current subscription and management grants own snapshots, never agent discovery.
// Wait for capability hydration so initial list loading does not cause a second read.
export const selectPermissionRecoveryScope = store.createSelector((state) => {
  const context = selectPrincipalActionContext.select(state);
  if (
    !context ||
    !selectWorkspaceListLoadedForBackend.select(state, state.connections.windowBackendId)
  )
    return null;
  const workspaceIds = getItems(state.workspace.workspaces)
    .filter((workspace) => selectWorkspacePermissionContext.select(state, workspace.id) !== null)
    .map((workspace) => workspace.id)
    .sort();
  return JSON.stringify([context, workspaceIds]);
});

// Late identity/capability hydration can admit cached prompts without another RPC.
export const selectPermissionRecoveryAgents = store.createSelector((state) =>
  JSON.stringify(
    Object.values(state.agentSessions.byAgentId)
      .flatMap<[string, string, string | null, boolean]>((agent) => {
        if (!agent.workspaceId) return [];
        const context = selectWorkspacePermissionContext.select(state, agent.workspaceId);
        return [
          [
            agent.id,
            agent.workspaceId,
            context,
            selectWorkspaceManagementDenied.select(state, agent.workspaceId),
          ],
        ];
      })
      .sort((a, b) => a[0].localeCompare(b[0])),
  ),
);
