import {
  DEFAULT_DISCUSSION_ID,
  NEW_DISCUSSION_ID,
  type DiscussionAuthor,
} from '$shared/types/workspace-discussion';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import {
  selectCanShareWorkspace,
  selectIsWorkspaceOwner,
  selectWorkspaceById,
} from '../workspace/workspace-selectors';
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
  emptyManagement,
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
      (!row.authorized ||
        (!row.initialized && state.workspaceDiscussion.conversationsSupported !== true))
      ? {
          ...row,
          draft: '',
          agentMentions: [],
          principalMentions: [],
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
      !state.workspaceDiscussion.deletedKeys.includes(
        JSON.stringify([workspaceId, conversationId]),
      ) &&
      (conversationId === DEFAULT_DISCUSSION_ID ||
        (conversationId === NEW_DISCUSSION_ID
          ? state.workspaceDiscussion.managementSupported === true
          : (state.workspaceDiscussion.conversationsSupported === true ||
              state.workspaceDiscussion.managementSupported === true) &&
            row.authorized)) &&
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
const selectDiscussionManagementReady = store.createSelector(
  (state, workspaceId: string) =>
    selectDiscussionManagementSupported.select(state) === true &&
    !!selectDiscussionContext.select(state) &&
    !!selectWorkspaceById.select(state, workspaceId),
);
export const selectDiscussionCanCreate = store.createSelector(
  (state, workspaceId: string) =>
    selectDiscussionManagementReady.select(state, workspaceId) &&
    !selectDiscussionSharingOff.select(state),
);
export const selectDiscussionDirectory = store.createSelector((state, workspaceId: string) =>
  selectDiscussionCacheVisible.select(state) &&
  (state.workspaceDiscussion.conversationsSupported === true ||
    state.workspaceDiscussion.managementSupported === true)
    ? (state.workspaceDiscussion.directories[workspaceId] ?? emptyDirectory)
    : emptyDirectory,
);
export const selectDiscussionConversations = store.createSelector((state, workspaceId: string) =>
  getItems(selectDiscussionDirectory.select(state, workspaceId).conversations),
);
export const selectDiscussionDefaultVisible = store.createSelector((state, workspaceId: string) => {
  if (
    selectDiscussionCacheVisible.select(state) &&
    state.workspaceDiscussion.deletedKeys.includes(
      JSON.stringify([workspaceId, DEFAULT_DISCUSSION_ID]),
    )
  )
    return false;
  if (state.workspaceDiscussion.managementSupported !== true) return true;
  const directory = selectDiscussionDirectory.select(state, workspaceId);
  // Pages accumulate in the directory. Absence is conclusive only after its last page.
  return (
    !!getItem(directory.conversations, DEFAULT_DISCUSSION_ID) ||
    directory.status !== 'ready' ||
    directory.hasMore
  );
});
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
    const readSequence = row.readSequence ?? 0;
    const unread = selectDiscussionMessages
      .select(state, workspaceId, conversationId)
      .filter(
        (message) =>
          message.sequence > readSequence &&
          (message.author.agentId !== undefined || message.author.principalId !== principalId),
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
    (conversationId !== NEW_DISCUSSION_ID ||
      selectDiscussionCanCreate.select(state, workspaceId)) &&
    selectDiscussionReady.select(state, workspaceId, conversationId) &&
    !selectDiscussionSharingOff.select(state) &&
    !selectDiscussionReadOnly.select(state, workspaceId, conversationId),
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

export const selectDiscussionAgentMessagingSupported = store.createSelector((state) =>
  state.workspaceDiscussion.context === selectDiscussionContext.select(state)
    ? state.workspaceDiscussion.agentMessagingSupported
    : null,
);

export const selectDiscussionAgentActivitySupported = store.createSelector((state) =>
  state.workspaceDiscussion.context === selectDiscussionContext.select(state)
    ? state.workspaceDiscussion.agentActivitySupported
    : null,
);
export const selectDiscussionPrincipalMentionsSupported = store.createSelector((state) =>
  state.workspaceDiscussion.context === selectDiscussionContext.select(state)
    ? state.workspaceDiscussion.principalMentionsSupported
    : null,
);
export const selectDiscussionCanControlAgent = store.createSelector(
  (state, workspaceId: string, conversationId = DEFAULT_DISCUSSION_ID) =>
    conversationId !== NEW_DISCUSSION_ID &&
    selectDiscussionCanTargetAgents.select(state, workspaceId, conversationId) &&
    selectDiscussionAgentActivitySupported.select(state) === true &&
    selectDiscussionCanSend.select(state, workspaceId, conversationId),
);
export const selectDiscussionAgentControlPending = store.createSelector(
  (state, workspaceId: string, conversationId = DEFAULT_DISCUSSION_ID) =>
    getItems(
      selectWorkspaceDiscussion.select(state, workspaceId, conversationId).agentControls,
    ).map((c) => c.key),
);

export const selectDiscussionReactionsSupported = store.createSelector((state) =>
  state.workspaceDiscussion.context === selectDiscussionContext.select(state)
    ? state.workspaceDiscussion.reactionsSupported
    : null,
);

export const selectDiscussionManagementSupported = store.createSelector((state) =>
  state.workspaceDiscussion.context === selectDiscussionContext.select(state)
    ? state.workspaceDiscussion.managementSupported
    : null,
);
export const selectDiscussionManagement = store.createSelector((state, workspaceId: string) =>
  selectDiscussionContext.select(state) === state.workspaceDiscussion.context
    ? (state.workspaceDiscussion.management[workspaceId] ?? emptyManagement)
    : emptyManagement,
);
export const selectDiscussionCanRename = store.createSelector(
  (state, workspaceId: string, conversationId = DEFAULT_DISCUSSION_ID) => {
    const workspace = selectWorkspaceById.select(state, workspaceId);
    return (
      selectDiscussionManagementReady.select(state, workspaceId) &&
      (workspace?.myRole === 'owner' || workspace?.myRole === 'manager') &&
      !state.workspaceDiscussion.deletedKeys.includes(
        JSON.stringify([workspaceId, conversationId]),
      ) &&
      getItem(selectDiscussionDirectory.select(state, workspaceId).conversations, conversationId)
        ?.kind === 'workspace'
    );
  },
);
export const selectDiscussionCanDelete = store.createSelector(
  (state, workspaceId: string, conversationId = DEFAULT_DISCUSSION_ID) =>
    selectDiscussionCanRename.select(state, workspaceId, conversationId) &&
    selectIsWorkspaceOwner.select(state, workspaceId),
);

export const selectDiscussionManagementPending = store.createSelector(
  (state, workspaceId: string, conversationId?: string) => {
    const request = selectDiscussionManagement.select(state, workspaceId);
    return (
      request.pending !== null &&
      (conversationId === undefined || request.conversationId === conversationId)
    );
  },
);

export const selectDiscussionReadOnly = store.createSelector(
  (state, workspaceId: string, conversationId = DEFAULT_DISCUSSION_ID) => {
    const conversation = getItem(
      selectDiscussionDirectory.select(state, workspaceId).conversations,
      conversationId,
    );
    return !!conversation && conversation.kind !== 'workspace';
  },
);

export const selectDiscussionCanTargetAgents = store.createSelector(
  (state, workspaceId: string, conversationId = DEFAULT_DISCUSSION_ID) =>
    selectDiscussionAgentMessagingSupported.select(state) === true &&
    selectDiscussionCanSend.select(state, workspaceId, conversationId) &&
    (conversationId === DEFAULT_DISCUSSION_ID ||
      (selectDiscussionManagementSupported.select(state) === true &&
        (conversationId === NEW_DISCUSSION_ID ||
          getItem(
            selectDiscussionDirectory.select(state, workspaceId).conversations,
            conversationId,
          )?.kind === 'workspace'))),
);
