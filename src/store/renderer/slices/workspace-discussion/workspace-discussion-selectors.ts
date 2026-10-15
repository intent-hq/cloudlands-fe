import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { WorkspaceId } from '$shared/types/branded-ids';
import { store } from '../../store';
import {
  selectCollaborationReady,
  selectPrincipalActionContext,
  selectPrincipalSnapshot,
} from '../principal/principal-selectors';
import { selectLabsMultiplayerEnabled } from '../user-preferences/user-preferences-selectors';
import { emptyDiscussion, type DiscussionTarget } from './workspace-discussion-slice';

export const selectDiscussionContext = store.createSelector((state) =>
  selectCollaborationReady.select(state) ? selectPrincipalActionContext.select(state) : null,
);
export const selectDiscussionOwner = store.createSelector((state) => {
  const principal = selectPrincipalSnapshot.select(state)?.principal;
  return principal ? JSON.stringify([state.connections.windowBackendId, principal.id]) : null;
});
export const selectDiscussionWorkspaceIds = store.createSelector((state) =>
  getItems(state.workspace.workspaces)
    .filter((w) => (w.memberCount ?? 1) > 1)
    .map((w) => String(w.id)),
);
export const selectDiscussionTarget = store.createSelector<
  [workspaceId: string],
  DiscussionTarget | null
>((state, workspaceId) => {
  const context = selectDiscussionContext.select(state);
  const workspace = getItem(state.workspace.workspaces, WorkspaceId(workspaceId));
  const row = state.workspaceDiscussion.byWorkspaceId[workspaceId];
  return context &&
    state.workspaceDiscussion.context === context &&
    workspace &&
    (workspace.memberCount ?? 1) > 1 &&
    state.workspaceDiscussion.workspaceIds.includes(workspaceId) &&
    row
    ? { context, workspaceId, epoch: row.epoch }
    : null;
});
/** Cached presentation survives a transport outage. It never grants request authority. */
const selectDiscussionCacheVisible = store.createSelector((state) => {
  const owner = state.workspaceDiscussion.owner;
  if (
    !owner ||
    !selectLabsMultiplayerEnabled.select(state) ||
    state.principal.status === 'revoked' ||
    state.principal.error === 'incompatible-response' ||
    state.connections.authRejected?.id === state.connections.windowBackendId
  )
    return false;
  const admittedOwner = selectDiscussionOwner.select(state);
  if (admittedOwner) return admittedOwner === owner;
  // principal state intentionally forgets its snapshot while reconnect admission is pending.
  // Keep the last admitted display on this backend until identity is known again; a
  // backend switch, explicit denial, or a newly bound different person hides it at once.
  try {
    const [backendId, principalId] = JSON.parse(owner) as [string, string];
    const knownPrincipalId =
      state.principal.boundPrincipalId ?? state.principal.snapshot?.principal.id;
    return (
      backendId === state.connections.windowBackendId &&
      (knownPrincipalId == null || knownPrincipalId === principalId)
    );
  } catch {
    return false;
  }
});
export const selectWorkspaceDiscussion = store.createSelector((state, workspaceId: string) => {
  const workspace = getItem(state.workspace.workspaces, WorkspaceId(workspaceId));
  return workspace && (workspace.memberCount ?? 1) > 1 && selectDiscussionCacheVisible.select(state)
    ? (state.workspaceDiscussion.byWorkspaceId[workspaceId] ?? emptyDiscussion)
    : emptyDiscussion;
});
export const selectDiscussionMessages = store.createSelector((state, workspaceId: string) =>
  getItems(selectWorkspaceDiscussion.select(state, workspaceId).messages),
);
export const selectDiscussionPending = store.createSelector((state, workspaceId: string) =>
  getItems(selectWorkspaceDiscussion.select(state, workspaceId).pending),
);
/** A mounted pane may request its first row before the slice has ever seen this workspace. */
export const selectDiscussionReady = store.createSelector((state, workspaceId: string) => {
  const workspace = getItem(state.workspace.workspaces, WorkspaceId(workspaceId));
  const row = selectWorkspaceDiscussion.select(state, workspaceId);
  return (
    !!selectDiscussionContext.select(state) &&
    !!workspace &&
    (workspace.memberCount ?? 1) > 1 &&
    !row.unsupported &&
    row.error !== 'forbidden'
  );
});

export const selectDiscussionRequestedIds = store.createSelector(
  (state) => state.workspaceDiscussion.requestedIds,
);
export const selectDiscussionUninitializedIds = store.createSelector((state) =>
  state.workspaceDiscussion.requestedIds.filter(
    (id) => !state.workspaceDiscussion.byWorkspaceId[id],
  ),
);
