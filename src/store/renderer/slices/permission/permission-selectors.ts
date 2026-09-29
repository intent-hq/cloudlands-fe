import { selectWorkspacePermissionContext } from '../workspace/workspace-selectors';
import { store } from '../../store';
import { getItems, type Collection } from '@augmentcode/themis/utils/collections/collection-utils';
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

// Domain ownership follows admission plus known agent/workspace identity, not
// every transcript update or an additional owner for principalReceived.
export const selectPermissionRecoveryScope = store.createSelector((state) =>
  JSON.stringify(
    Object.values(state.agentSessions.byAgentId)
      .flatMap<[string, string, string]>((agent) => {
        if (!agent.workspaceId) return [];
        const context = selectWorkspacePermissionContext.select(state, agent.workspaceId);
        return context ? [[agent.id, agent.workspaceId, context]] : [];
      })
      .sort((a, b) => a[0].localeCompare(b[0])),
  ),
);
