import { store } from '../../store';
import {
  getItem,
  getItems,
  type Collection,
} from '@augmentcode/themis/utils/collections/collection-utils';
import type { PermissionRequest } from './permission-slice';
import { selectWorkspaceControlContext } from '../principal/principal-selectors';
import { selectAgentSessionWorkspaceId } from '../agent-session/agent-session-selectors';
import { selectWorkspaceManagementContext } from '../workspace/workspace-selectors';

export const selectPermissionState = store.createSelector((state) => state.permission);

export const selectPermissionRequestContext = store.createSelector((state, requestId: string) => {
  const context = selectWorkspaceControlContext.select(state);
  if (!context || state.permission.context !== context) return null;
  const request = getItem(state.permission.requests, requestId);
  const workspaceId = request && selectAgentSessionWorkspaceId.select(state, request.sessionId);
  return workspaceId ? selectWorkspaceManagementContext.select(state, workspaceId) : null;
});

export const selectPermissionRequestsCollection = store.createSelector(
  (state): Collection<PermissionRequest, 'requestId'> => {
    return state.permission.requests;
  },
);

/** Select all permission requests */
export const selectPermissionRequests = store.createSelector((state) => {
  return getItems(selectPermissionRequestsCollection.select(state)).filter(
    (request) => selectPermissionRequestContext.select(state, request.requestId) !== null,
  );
});

/** Select permission requests for a specific session/agent */
const selectRequestsForSession = store.createSelector((state, sessionId: string) => {
  return selectPermissionRequests.select(state).filter((r) => r.sessionId === sessionId);
});

/** Select the count of pending requests for a session */
export const selectPendingCount = store.createSelector((state, sessionId: string) => {
  return selectRequestsForSession.select(state, sessionId).length;
});
