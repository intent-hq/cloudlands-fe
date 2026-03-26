import { createSelector } from "../../utils/create-selector";
import { getItems, type Collection } from "../../utils/collection-utils";
import type { PermissionRequest } from "./permission-slice";

export const selectPermissionRequestsCollection = createSelector(
  (state): Collection<PermissionRequest, "requestId"> => {
    return state.permission.requests;
  }
);

/** Select all permission requests */
export const selectPermissionRequests = createSelector((state) => {
  return getItems(selectPermissionRequestsCollection.select(state));
});

/** Select permission requests for a specific session/agent */
export const selectRequestsForSession = createSelector((state, sessionId: string) => {
  return selectPermissionRequests.select(state).filter((r) => r.sessionId === sessionId);
});

/** Select the current (oldest) permission request for a session */
export const selectCurrentRequest = createSelector((state, sessionId: string) => {
  const sessionRequests = selectRequestsForSession.select(state, sessionId);
  return sessionRequests[0] || null;
});

/** Select the count of pending requests for a session */
export const selectPendingCount = createSelector((state, sessionId: string) => {
  return selectRequestsForSession.select(state, sessionId).length;
});

