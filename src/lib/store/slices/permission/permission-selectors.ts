import { createSelector } from "../../utils/create-selector";

/** Select all permission requests */
export const selectPermissionRequests = createSelector((state) => {
  return state.permission.requests;
});

/** Select permission requests for a specific session/agent */
export const selectRequestsForSession = createSelector((state, sessionId: string) => {
  return state.permission.requests.filter((r) => r.sessionId === sessionId);
});

/** Select the current (oldest) permission request for a session */
export const selectCurrentRequest = createSelector((state, sessionId: string) => {
  const sessionRequests = state.permission.requests.filter((r) => r.sessionId === sessionId);
  return sessionRequests[0] || null;
});

/** Select the count of pending requests for a session */
export const selectPendingCount = createSelector((state, sessionId: string) => {
  return state.permission.requests.filter((r) => r.sessionId === sessionId).length;
});

