import { selectPrincipalActionContext } from '../principal/principal-selectors';
import {
  selectWorkspaceManagementDenied,
  selectWorkspaceListLoadedForBackend,
  selectWorkspacePermissionContext,
} from '../workspace/workspace-selectors';
import { store } from '../../store';
import { createPermissionRecoveryProjections } from './permission-recovery-projections';
import * as projections from './permission-projections';

export const selectPermissionRequestsCollection = store.createSelector(
  projections.getPermissionRequestsCollection,
);

/** Select all permission requests */
export const selectPermissionRequests = store.createSelector((state) => {
  return projections.getPermissionRequests(selectPermissionRequestsCollection.select(state));
});

/** Select permission requests for a specific session/agent */
const selectRequestsForSession = store.createSelector((state, sessionId: string) => {
  return projections.getRequestsForSession(selectPermissionRequests.select(state), sessionId);
});

/** Select the count of pending requests for a session */
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
