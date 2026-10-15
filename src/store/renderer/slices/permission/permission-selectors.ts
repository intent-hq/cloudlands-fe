import { selectPrincipalActionContext } from '../principal/principal-selectors';
import {
  selectWorkspaceManagementDenied,
  selectWorkspaceListLoadedForBackend,
  selectWorkspacePermissionContext,
} from '../workspace/workspace-selectors';
import { store } from '../../store';
import { createPermissionRecoveryProjections } from './permission-recovery-projections';
import * as projections from './permission-projections';

export const selectPermissionResponsesCollection = store.createSelector(
  projections.getPermissionResponsesCollection,
);

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
  selectPrincipalActionContext: {
    get select() {
      const selector = selectPrincipalActionContext;
      const select = selector.select;
      return (...args: Parameters<typeof select>) => select.apply(selector, args);
    },
  },
  selectWorkspaceListLoadedForBackend: {
    get select() {
      const selector = selectWorkspaceListLoadedForBackend;
      const select = selector.select;
      return (...args: Parameters<typeof select>) => select.apply(selector, args);
    },
  },
  selectWorkspacePermissionContext: {
    get select() {
      const selector = selectWorkspacePermissionContext;
      const select = selector.select;
      return (...args: Parameters<typeof select>) => select.apply(selector, args);
    },
  },
  selectWorkspaceManagementDenied: {
    get select() {
      const selector = selectWorkspaceManagementDenied;
      const select = selector.select;
      return (...args: Parameters<typeof select>) => select.apply(selector, args);
    },
  },
});

export const selectPermissionRecoveryScope = store.createSelector(
  recoveryProjections.getPermissionRecoveryScope,
);

export const selectPermissionRecoveryAgents = store.createSelector(
  recoveryProjections.getPermissionRecoveryAgents,
);
