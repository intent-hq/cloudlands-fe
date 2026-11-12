import {
  selectWorkspaceAuthority,
  selectWorkspaceListLoadedForBackend,
} from '../workspace/workspace-selectors';
import {
  workspaceManagementDenied,
  workspacePermissionContext,
} from '../workspace/workspace-authority';
import { store } from '../../store';
import {
  getItem,
  getItems,
  type Collection,
} from '@themislib/themis/utils/collections/collection-utils';
import type { PermissionRequest } from './permission-slice';
import type { Workspace } from '$shared/types';

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
// Both recovery selectors re-run on every workspace/agent update: derive authority once.
export const selectPermissionRecoveryScope = store.createSelector((state) => {
  const authority = selectWorkspaceAuthority.select(state);
  const context = authority.actionContext;
  if (
    !context ||
    !selectWorkspaceListLoadedForBackend.select(state, state.connections.windowBackendId)
  )
    return null;
  const workspaceIds = getItems(state.workspace.workspaces)
    .filter(
      (workspace) => workspacePermissionContext(authority, workspace.id, () => workspace) !== null,
    )
    .map((workspace) => workspace.id)
    .sort();
  return JSON.stringify([context, workspaceIds]);
});

// Late identity/capability hydration can admit cached prompts without another RPC.
export const selectPermissionRecoveryAgents = store.createSelector((state) => {
  const authority = selectWorkspaceAuthority.select(state);
  const byWorkspace = new Map<string, [string | null, boolean]>();
  const workspaceGrant = (wsId: string) => {
    let grant = byWorkspace.get(wsId);
    if (!grant) {
      const readRow = () => getItem(state.workspace.workspaces, wsId as Workspace['id']);
      grant = [
        workspacePermissionContext(authority, wsId, readRow),
        workspaceManagementDenied(authority, wsId, readRow),
      ];
      byWorkspace.set(wsId, grant);
    }
    return grant;
  };
  return JSON.stringify(
    Object.values(state.agentSessions.byAgentId)
      .flatMap<[string, string, string | null, boolean]>((agent) =>
        agent.workspaceId
          ? [[agent.id, agent.workspaceId, ...workspaceGrant(agent.workspaceId)]]
          : [],
      )
      .sort((a, b) => a[0].localeCompare(b[0])),
  );
});
