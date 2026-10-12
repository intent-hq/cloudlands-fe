import { store } from '../index';
import { selectPrincipalActionContext } from '../principal/principal-selectors';
import {
  selectWorkspaceManagementDenied,
  selectWorkspaceListLoadedForBackend,
  selectWorkspacePermissionContext,
} from '../workspace/workspace-selectors';
import { createPermissionRecoveryProjections } from '../../../../../src/store/renderer/slices/permission/permission-recovery-projections';
import * as projections from '../../../../../src/store/renderer/slices/permission/permission-projections';

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
