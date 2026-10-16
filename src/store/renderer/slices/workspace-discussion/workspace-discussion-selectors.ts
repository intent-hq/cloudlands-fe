import { DEFAULT_DISCUSSION_ID, NEW_DISCUSSION_ID } from '$shared/types/workspace-discussion';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { WorkspaceId } from '$shared/types/branded-ids';
import { store } from '../../store';
import {
  selectCollaborationReady,
  selectPrincipalActionContext,
  selectPrincipalSnapshot,
} from '../principal/principal-selectors';
import { selectLabsMultiplayerEnabled } from '../user-preferences/user-preferences-selectors';
import {
  emptyDiscussion,
  emptyDirectory,
  emptyRecipients,
  discussionRow,
  type DiscussionTarget,
} from './workspace-discussion-slice';

export const selectDiscussionContext = store.createSelector((state) =>
  selectCollaborationReady.select(state) ? selectPrincipalActionContext.select(state) : null,
);
export const selectDiscussionOwner = store.createSelector((state) => {
  const principal = selectPrincipalSnapshot.select(state)?.principal;
  return principal ? JSON.stringify([state.connections.windowBackendId, principal.id]) : null;
});
export const selectDiscussionWorkspaceIds = store.createSelector((state) =>
  getItems(state.workspace.workspaces).map((w) => String(w.id)),
);
export const selectDiscussionTarget = store.createSelector<
  [workspaceId: string, conversationId?: string],
  DiscussionTarget | null
>((state, workspaceId, conversationId = DEFAULT_DISCUSSION_ID) => {
  const context = selectDiscussionContext.select(state);
  const workspace = getItem(state.workspace.workspaces, WorkspaceId(workspaceId));
  const row = discussionRow(state.workspaceDiscussion, workspaceId, conversationId);
  return context &&
    state.workspaceDiscussion.context === context &&
    workspace &&
    state.workspaceDiscussion.workspaceIds.includes(workspaceId) &&
    row
    ? { context, workspaceId, conversationId, epoch: row.epoch }
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
export const selectWorkspaceDiscussion = store.createSelector(
  (state, workspaceId: string, conversationId = DEFAULT_DISCUSSION_ID) => {
    const workspace = getItem(state.workspace.workspaces, WorkspaceId(workspaceId));
    if (!workspace || !selectDiscussionCacheVisible.select(state)) return emptyDiscussion;
    const row =
      discussionRow(state.workspaceDiscussion, workspaceId, conversationId) ?? emptyDiscussion;
    return conversationId !== DEFAULT_DISCUSSION_ID &&
      conversationId !== NEW_DISCUSSION_ID &&
      !row.authorized
      ? { ...row, draft: '', messages: emptyDiscussion.messages, pending: emptyDiscussion.pending }
      : row;
  },
);
export const selectDiscussionMessages = store.createSelector(
  (state, workspaceId: string, conversationId = DEFAULT_DISCUSSION_ID) =>
    selectWorkspaceDiscussion.select(state, workspaceId, conversationId).authorized
      ? getItems(selectWorkspaceDiscussion.select(state, workspaceId, conversationId).messages)
      : [],
);
export const selectDiscussionPending = store.createSelector(
  (state, workspaceId: string, conversationId = DEFAULT_DISCUSSION_ID) =>
    selectWorkspaceDiscussion.select(state, workspaceId, conversationId).authorized
      ? getItems(selectWorkspaceDiscussion.select(state, workspaceId, conversationId).pending)
      : [],
);
/** A mounted pane may request its first row before the slice has ever seen this workspace. */
export const selectDiscussionReady = store.createSelector(
  (state, workspaceId: string, conversationId = DEFAULT_DISCUSSION_ID) => {
    const workspace = getItem(state.workspace.workspaces, WorkspaceId(workspaceId));
    const row = selectWorkspaceDiscussion.select(state, workspaceId, conversationId);
    return (
      !!selectDiscussionContext.select(state) &&
      !!workspace &&
      (conversationId === DEFAULT_DISCUSSION_ID ||
        (state.workspaceDiscussion.conversationsSupported === true &&
          (conversationId === NEW_DISCUSSION_ID || row.authorized))) &&
      !row.unsupported &&
      row.error !== 'forbidden'
    );
  },
);

export const selectDiscussionRequestedIds = store.createSelector(
  (state) => state.workspaceDiscussion.requestedIds,
);
export const selectDiscussionUninitializedIds = store.createSelector((state) =>
  state.workspaceDiscussion.requestedIds.filter((key) => {
    const [ws, id] = JSON.parse(key);
    return !discussionRow(state.workspaceDiscussion, ws, id);
  }),
);
export const selectDiscussionCanCreate = store.createSelector(
  (state, workspaceId: string) =>
    state.workspaceDiscussion.conversationsSupported === true &&
    selectDiscussionReady.select(state, workspaceId),
);
export const selectDiscussionDirectory = store.createSelector((state, workspaceId: string) =>
  selectDiscussionCacheVisible.select(state)
    ? (state.workspaceDiscussion.directories[workspaceId] ?? emptyDirectory)
    : emptyDirectory,
);
export const selectDiscussionConversations = store.createSelector((state, workspaceId: string) =>
  getItems(selectDiscussionDirectory.select(state, workspaceId).conversations),
);
export const selectDiscussionRecipients = store.createSelector((state, workspaceId: string) => {
  const row = selectDiscussionCacheVisible.select(state)
    ? (state.workspaceDiscussion.recipients[workspaceId] ?? emptyRecipients)
    : emptyRecipients;
  const selected = selectWorkspaceDiscussion.select(
    state,
    workspaceId,
    NEW_DISCUSSION_ID,
  ).recipientPrincipalIds;
  return {
    status: row.status,
    query: row.query,
    members: getItems(row.members),
    selectedMembers: getItems(row.knownMembers).filter((m) => selected.includes(m.principalId)),
    hasMore: row.hasMore,
    error: row.error,
  };
});
export const selectDiscussionCreatedId = store.createSelector(
  (state, workspaceId: string) =>
    selectWorkspaceDiscussion.select(state, workspaceId, NEW_DISCUSSION_ID).createdConversationId,
);

export const selectDiscussionCapability = store.createSelector(
  (state) => state.workspaceDiscussion.conversationsSupported,
);
export const selectDiscussionDirectoryRequestedIds = store.createSelector(
  (state) => state.workspaceDiscussion.directoryRequestedIds,
);
export const selectDiscussionRecipientState = store.createSelector(
  (state, workspaceId: string) => state.workspaceDiscussion.recipients[workspaceId],
);
