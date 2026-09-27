import { store } from '../../store';
import {
  getItem,
  getItems,
  type Collection,
} from '@augmentcode/themis/utils/collections/collection-utils';
import type { PermissionRequest } from './permission-slice';
import { selectHostRole, selectWorkspaceAccessContext } from '../principal/principal-selectors';
import { selectAgentSessionWorkspaceId } from '../agent-session/agent-session-selectors';
import { selectWorkspaceManagementContext } from '../workspace/workspace-selectors';

export const selectPermissionState = store.createSelector((state) => state.permission);

/** The server filters the read; guests enter only with a current explicit workspace grant. */
export const selectPermissionReadContext = store.createSelector((state): string | null => {
  const context = selectWorkspaceAccessContext.select(state);
  if (!context) return null;
  if (selectHostRole.select(state) !== 'guest') return context;
  return state.workspace.workspaces.ids.some(
    (id) => selectWorkspaceManagementContext.select(state, id) !== null,
  )
    ? context
    : null;
});

export const selectPermissionRequestContext = store.createSelector((state, requestId: string) => {
  const context = selectPermissionReadContext.select(state);
  if (!context || state.permission.context !== context) return null;
  const request = getItem(state.permission.requests, requestId);
  const workspaceId = request && selectAgentSessionWorkspaceId.select(state, request.sessionId);
  return workspaceId && selectWorkspaceManagementContext.select(state, workspaceId)
    ? JSON.stringify([context, workspaceId, request.sessionId])
    : null;
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
