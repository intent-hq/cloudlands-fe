import { store } from '../index';
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
