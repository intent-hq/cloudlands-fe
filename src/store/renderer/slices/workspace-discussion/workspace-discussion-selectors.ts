import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { WorkspaceId } from '$shared/types/branded-ids';
import { store } from '../../store';
import {
  selectCollaborationReady,
  selectPrincipalActionContext,
  selectPrincipalSnapshot,
} from '../principal/principal-selectors';
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
export const selectWorkspaceDiscussion = store.createSelector((state, workspaceId: string) =>
  selectDiscussionTarget.select(state, workspaceId)
    ? state.workspaceDiscussion.byWorkspaceId[workspaceId]
    : emptyDiscussion,
);
export const selectDiscussionMessages = store.createSelector((state, workspaceId: string) =>
  getItems(selectWorkspaceDiscussion.select(state, workspaceId).messages),
);
export const selectDiscussionPending = store.createSelector((state, workspaceId: string) =>
  getItems(selectWorkspaceDiscussion.select(state, workspaceId).pending),
);
export const selectDiscussionReady = store.createSelector((state, workspaceId: string) => {
  const row = selectWorkspaceDiscussion.select(state, workspaceId);
  return (
    !!selectDiscussionTarget.select(state, workspaceId) &&
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
