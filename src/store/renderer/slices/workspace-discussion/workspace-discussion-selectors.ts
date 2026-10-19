import {
  DEFAULT_DISCUSSION_ID,
  NEW_DISCUSSION_ID,
  type DiscussionAuthor,
} from '$shared/types/workspace-discussion';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { selectCanShareWorkspace } from '../workspace/workspace-selectors';
import { WorkspaceId } from '$shared/types/branded-ids';
import { store } from '../../store';
import {
  selectCanAdministerHost,
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
      ? {
          ...row,
          draft: '',
          agentMentions: [],
          messages: emptyDiscussion.messages,
          pending: emptyDiscussion.pending,
        }
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

export const selectDiscussionAuthor = store.createSelector((state): DiscussionAuthor | null => {
  const principal = selectPrincipalSnapshot.select(state)?.principal;
  return principal
    ? {
        principalId: principal.id,
        login: principal.login ?? null,
        displayName: principal.displayName ?? null,
        avatarUrl: principal.avatarUrl ?? null,
      }
    : null;
});
export const selectDiscussionUnread = store.createSelector(
  (state, workspaceId: string, conversationId = DEFAULT_DISCUSSION_ID) => {
    const row = selectWorkspaceDiscussion.select(state, workspaceId, conversationId);
    const owner = state.workspaceDiscussion.owner;
    const principalId =
      selectDiscussionAuthor.select(state)?.principalId ??
      (owner ? (JSON.parse(owner) as [string, string])[1] : null);
    const readSequence = row.readSequence;
    const unread =
      readSequence === null
        ? []
        : selectDiscussionMessages
            .select(state, workspaceId, conversationId)
            .filter(
              (message) =>
                message.sequence > readSequence &&
                (message.author.agentId !== undefined ||
                  message.author.principalId !== principalId),
            );
    return { count: unread.length, firstSequence: unread[0]?.sequence ?? null };
  },
);

export const selectDiscussionSharingOff = store.createSelector(
  (state) =>
    state.workspaceDiscussion.context === selectDiscussionContext.select(state) &&
    state.workspaceDiscussion.sharingEnabled === false,
);
export const selectDiscussionCanSend = store.createSelector(
  (state, workspaceId: string, conversationId = DEFAULT_DISCUSSION_ID) =>
    selectDiscussionReady.select(state, workspaceId, conversationId) &&
    !selectDiscussionSharingOff.select(state),
);
export const selectDiscussionCanEnableSharing = store.createSelector(
  (state, workspaceId: string) =>
    selectCanAdministerHost.select(state) && selectCanShareWorkspace.select(state, workspaceId),
);

export const selectDiscussionMessageActionsSupported = store.createSelector(
  (state) => state.workspaceDiscussion.messageActionsSupported,
);
export const selectDiscussionCanInteract = store.createSelector(
  (state, workspaceId: string, conversationId = DEFAULT_DISCUSSION_ID) =>
    conversationId !== NEW_DISCUSSION_ID &&
    state.workspaceDiscussion.messageActionsSupported === true &&
    selectDiscussionCanSend.select(state, workspaceId, conversationId),
);
export const selectDiscussionReply = store.createSelector(
  (state, workspaceId: string, conversationId = DEFAULT_DISCUSSION_ID) => {
    const row = selectWorkspaceDiscussion.select(state, workspaceId, conversationId);
    return row.replyToMessageId && row.authorized
      ? (getItem(row.messages, row.replyToMessageId) ?? null)
      : null;
  },
);

export const selectDiscussionRecipientsForComposer = store.createSelector(
  (state, workspaceId: string, conversationId = DEFAULT_DISCUSSION_ID) => {
    if (conversationId === NEW_DISCUSSION_ID)
      return selectDiscussionRecipients.select(state, workspaceId).selectedMembers;
    const conversation = getItem(
      selectDiscussionDirectory.select(state, workspaceId).conversations,
      conversationId,
    );
    const principalId = selectDiscussionAuthor.select(state)?.principalId;
    return conversation?.participants.filter((person) => person.principalId !== principalId) ?? [];
  },
);

export const selectDiscussionAgentMessagingSupported = store.createSelector((state) =>
  state.workspaceDiscussion.context === selectDiscussionContext.select(state)
    ? state.workspaceDiscussion.agentMessagingSupported
    : null,
);
