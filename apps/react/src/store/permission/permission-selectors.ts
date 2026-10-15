import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { selectAgentSessionsById } from '../agent-session/agent-session-selectors';
import { store } from '../index';
import { selectPrincipalActionContext } from '../principal/principal-selectors';
import {
  selectWorkspaceManagementDenied,
  selectWorkspaceListLoadedForBackend,
  selectWorkspacePermissionContext,
} from '../workspace/workspace-selectors';
import { createPermissionRecoveryProjections } from '../../../../../src/store/renderer/slices/permission/permission-recovery-projections';
import * as projections from '../../../../../src/store/renderer/slices/permission/permission-projections';

export const selectPermissionResponsesCollection = store.createSelector(
  projections.getPermissionResponsesCollection,
);

export const selectPermissionRequestsCollection = store.createSelector(
  projections.getPermissionRequestsCollection,
);

export const selectPermissionRequests = store.createSelector((state) => {
  return projections.getPermissionRequests(selectPermissionRequestsCollection.select(state));
});

const selectRequestsForSession = store.createSelector((state, sessionId: string) => {
  return projections.getRequestsForSession(selectPermissionRequests.select(state), sessionId);
});

export const selectPendingCount = store.createSelector((state, sessionId: string) => {
  return projections.getPendingCount(selectRequestsForSession.select(state, sessionId));
});

const recoveryProjections = createPermissionRecoveryProjections({
  selectPrincipalActionContext,
  selectWorkspaceListLoadedForBackend,
  selectWorkspacePermissionContext,
  selectWorkspaceManagementDenied,
});

export const selectPermissionRecoveryScope = store.createSelector(
  recoveryProjections.getPermissionRecoveryScope,
);

export const selectPermissionRecoveryAgents = store.createSelector(
  recoveryProjections.getPermissionRecoveryAgents,
);

/** The mounted conversation receives only prompts from its admitted agent/workspace. */
export const selectConversationPermissionRequests = store.createSelector(
  (state, workspaceId: string, agentId: string) => {
    if (
      !selectWorkspacePermissionContext.select(state, workspaceId) ||
      state.permission.scope !== selectPermissionRecoveryScope.select(state) ||
      selectAgentSessionsById.select(state)[agentId]?.workspaceId !== workspaceId
    )
      return [];
    return projections
      .getRequestsForSession(selectPermissionRequests.select(state), agentId)
      .filter((request) => request.workspaceId === workspaceId);
  },
);

export const selectPermissionResponse = store.createSelector((state, requestId: string) => {
  const request = getItem(selectPermissionRequestsCollection.select(state), requestId);
  if (!request?.workspaceId) return undefined;
  const response = getItem(selectPermissionResponsesCollection.select(state), requestId);
  return response?.context === selectWorkspacePermissionContext.select(state, request.workspaceId)
    ? response
    : undefined;
});
