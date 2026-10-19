import {
  reconcileDiscussionAgentMentions,
  type DiscussionAgentMention,
} from '$features/discussions/discussion-agent-mentions';
import {
  createCollection,
  getItem,
  getItems,
  type Collection,
} from '@themislib/themis/utils/collections/collection-utils';
import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  isDiscussionReactionResult,
  type DiscussionReactionResult,
  type DiscussionReactionValue,
  isDiscussionMessage,
  isDiscussionConversation,
  DEFAULT_DISCUSSION_ID,
  NEW_DISCUSSION_ID,
  discussionKey,
  DISCUSSION_MAX_RECIPIENTS,
  type DiscussionConversation,
  type DiscussionAuthor,
  type DiscussionConversationsResult,
  type DiscussionRecipientsResult,
  type DiscussionError,
  type DiscussionMessage,
  type DiscussionListResult,
} from '$shared/types/workspace-discussion';

export interface PendingDiscussionMessage {
  id: string;
  body: string;
  draftVersion: number;
  status: 'sending' | 'failed';
  error: DiscussionError | null;
  recipientPrincipalIds?: string[];
  recipientAgentIds?: string[];
  agentMentions?: DiscussionAgentMention[];
  author?: DiscussionAuthor;
  createdAt?: string;
  replyToMessageId?: string;
  replyTo?: DiscussionMessage['replyTo'];
  replyVersion?: number;
}
export interface WorkspaceDiscussion {
  epoch: number;
  replyToMessageId: string | null;
  replyVersion: number;
  reactionUpdates: Collection<DiscussionReactionResult, 'messageId'>;
  reacting: string[];
  reactionError: DiscussionError | null;
  metadataBefore: number | null;
  metadataFloor: number | null;
  authorized: boolean;
  recipientPrincipalIds: string[];
  recipientsLocked: boolean;
  createdConversationId: string | null;
  messages: Collection<DiscussionMessage, 'id'>;
  pending: Collection<PendingDiscussionMessage, 'id'>;
  draft: string;
  agentMentions: DiscussionAgentMention[];
  draftVersion: number;
  loading: boolean;
  loadingOlder: boolean;
  initialized: boolean;
  hasMore: boolean;
  beforeSequence: number | null;
  /** Last history row synchronized by a list page; live messages never advance it. */
  syncedSequence: number | null;
  /** Local read boundary; independent of synchronized history and retained across pane mounts. */
  readSequence: number | null;
  /** A forward read is unfinished; Retry must resume it before loading older history. */
  catchUp: boolean;
  requestId: string | null;
  error: DiscussionError | null;
  unsupported: boolean;
  sending: boolean;
  sendError: DiscussionError | null;
}
export interface WorkspaceDiscussionState {
  context: string | null;
  /** Stable across reconnects; never shared between different people/backends. */
  owner: string | null;
  workspaceIds: string[];
  requestedIds: string[];
  nextEpoch: number;
  byWorkspaceId: Record<string, Record<string, WorkspaceDiscussion>>;
  conversationsSupported: boolean | null;
  sharingEnabled: boolean | null;
  messageActionsSupported: boolean | null;
  agentMessagingSupported: boolean | null;
  directories: Record<string, DiscussionDirectory>;
  recipients: Record<string, DiscussionRecipients>;
  directoryRequestedIds: string[];
}
export interface DiscussionTarget {
  context: string;
  workspaceId: string;
  conversationId?: string;
  epoch: number;
}
export const emptyDiscussion: WorkspaceDiscussion = {
  epoch: 0,
  replyToMessageId: null,
  replyVersion: 0,
  reactionUpdates: createCollection('messageId'),
  reacting: [],
  reactionError: null,
  metadataBefore: null,
  metadataFloor: null,
  authorized: false,
  recipientPrincipalIds: [],
  recipientsLocked: false,
  createdConversationId: null,
  messages: createCollection('id'),
  pending: createCollection('id'),
  draft: '',
  agentMentions: [],
  draftVersion: 0,
  loading: false,
  loadingOlder: false,
  initialized: false,
  hasMore: false,
  beforeSequence: null,
  syncedSequence: null,
  readSequence: null,
  catchUp: false,
  requestId: null,
  error: null,
  unsupported: false,
  sending: false,
  sendError: null,
};
export const initialState: WorkspaceDiscussionState = {
  context: null,
  owner: null,
  workspaceIds: [],
  requestedIds: [],
  nextEpoch: 0,
  byWorkspaceId: {},
  conversationsSupported: null,
  sharingEnabled: null,
  messageActionsSupported: null,
  agentMessagingSupported: null,
  directories: {},
  recipients: {},
  directoryRequestedIds: [],
};

export const discussionRequested = createAction<[workspaceId: string, conversationId?: string]>(
  'workspaceDiscussion/requested',
);
export const discussionOlderRequested = createAction<
  [workspaceId: string, conversationId?: string]
>('workspaceDiscussion/olderRequested');
export const discussionDraftChanged = createAction<
  [workspaceId: string, body: string, conversationId?: string]
>('workspaceDiscussion/draftChanged');
export const discussionAgentSelected = createAction<
  [
    workspaceId: string,
    agentId: string,
    name: string,
    start: number,
    end: number,
    conversationId?: string,
  ]
>('workspaceDiscussion/agentSelected');
export const discussionAgentRemoved = createAction<
  [workspaceId: string, agentId: string, conversationId?: string]
>('workspaceDiscussion/agentRemoved');
export const discussionSendRequested = createAction<[workspaceId: string, conversationId?: string]>(
  'workspaceDiscussion/sendRequested',
);
export const discussionRetryRequested = createAction<
  [workspaceId: string, messageId: string, conversationId?: string]
>('workspaceDiscussion/retryRequested');
export const discussionAgentCapabilityReceived = createAction<
  [context: string, supported: boolean]
>('workspaceDiscussion/agentCapabilityReceived');
export const discussionMessageActionsReceived = createAction<[context: string, supported: boolean]>(
  'workspaceDiscussion/messageActionsReceived',
);
export const discussionReplySelected = createAction<
  [workspaceId: string, messageId: string | null, conversationId?: string]
>('workspaceDiscussion/replySelected');
export const discussionReactionRequested = createAction<
  [
    workspaceId: string,
    messageId: string,
    reaction: DiscussionReactionValue,
    conversationId?: string,
  ]
>('workspaceDiscussion/reactionRequested');
export const discussionReactionReceived = createAction<
  [target: DiscussionTarget, result: DiscussionReactionResult]
>('workspaceDiscussion/reactionReceived');
export const discussionReactionStarted = createAction<[target: DiscussionTarget, key: string]>(
  'workspaceDiscussion/reactionStarted',
);
export const discussionReactionFinished = createAction<
  [target: DiscussionTarget, key: string, error: DiscussionError | null]
>('workspaceDiscussion/reactionFinished');
export const discussionMetadataProgress = createAction<
  [
    target: DiscussionTarget,
    requestId: string,
    messages: DiscussionMessage[],
    before: number | null,
    floor: number | null,
  ]
>('workspaceDiscussion/metadataProgress');
export const discussionSharingReceived = createAction<[context: string, enabled: boolean | null]>(
  'workspaceDiscussion/sharingReceived',
);
export const discussionSharingRefreshRequested = createAction(
  'workspaceDiscussion/sharingRefreshRequested',
);
export const discussionEnableSharingRequested = createAction<[workspaceId: string]>(
  'workspaceDiscussion/enableSharingRequested',
);
export const discussionReadThrough = createAction<[target: DiscussionTarget, sequence: number]>(
  'workspaceDiscussion/readThrough',
);
export const discussionContextChanged = createAction<
  [context: string | null, owner: string | null]
>('workspaceDiscussion/contextChanged');
export const discussionWorkspacesChanged = createAction<[workspaceIds: string[]]>(
  'workspaceDiscussion/workspacesChanged',
);
export const discussionMessageReceived = createAction<
  [target: DiscussionTarget, message: DiscussionMessage]
>('workspaceDiscussion/messageReceived');
export const discussionLoadStarted = createAction<
  [target: DiscussionTarget, requestId: string, older: boolean]
>('workspaceDiscussion/loadStarted');
export const discussionPageReceived = createAction<
  [
    target: DiscussionTarget,
    requestId: string,
    result: DiscussionListResult,
    direction: 'initial' | 'older' | 'newer',
  ]
>('workspaceDiscussion/pageReceived');
export const discussionLoadFinished = createAction<
  [target: DiscussionTarget, requestId: string, error: DiscussionError | null]
>('workspaceDiscussion/loadFinished');
export const discussionSendStarted = createAction<
  [target: DiscussionTarget, pending: PendingDiscussionMessage]
>('workspaceDiscussion/sendStarted');
export const discussionSendSucceeded = createAction<
  [
    target: DiscussionTarget,
    messageId: string,
    message: DiscussionMessage,
    conversation?: DiscussionConversation,
  ]
>('workspaceDiscussion/sendSucceeded');
export const discussionSendFailed = createAction<
  [target: DiscussionTarget, messageId: string, error: DiscussionError]
>('workspaceDiscussion/sendFailed');

export const workspaceDiscussionReducer = createReducer<WorkspaceDiscussionState>(initialState);
export function discussionRow(
  state: WorkspaceDiscussionState,
  workspaceId: string,
  conversationId = DEFAULT_DISCUSSION_ID,
): WorkspaceDiscussion | undefined {
  return state.byWorkspaceId[workspaceId]?.[conversationId];
}
const set = (
  state: WorkspaceDiscussionState,
  target: Pick<DiscussionTarget, 'workspaceId' | 'conversationId'>,
  value: WorkspaceDiscussion,
): WorkspaceDiscussionState => ({
  ...state,
  byWorkspaceId: {
    ...state.byWorkspaceId,
    [target.workspaceId]: {
      ...state.byWorkspaceId[target.workspaceId],
      [target.conversationId ?? DEFAULT_DISCUSSION_ID]: value,
    },
  },
});
function current(
  state: WorkspaceDiscussionState,
  target: DiscussionTarget,
): WorkspaceDiscussion | undefined {
  const row = discussionRow(state, target.workspaceId, target.conversationId);
  return state.context === target.context &&
    state.workspaceIds.includes(target.workspaceId) &&
    row?.epoch === target.epoch
    ? row
    : undefined;
}
function matches(target: DiscussionTarget, message: DiscussionMessage): boolean {
  return (
    message.workspaceId === target.workspaceId &&
    (message.conversationId ?? DEFAULT_DISCUSSION_ID) ===
      (target.conversationId ?? DEFAULT_DISCUSSION_ID)
  );
}
function receive(row: WorkspaceDiscussion, messages: DiscussionMessage[]): WorkspaceDiscussion {
  const merged = new Map(getItems(row.messages).map((m) => [m.id, m]));
  for (const message of messages) {
    // Server IDs differ from send retry keys. An echo never settles a local retry.
    const previous = merged.get(message.id);
    if (!previous) merged.set(message.id, message);
    else {
      const newer = (message.reactionVersion ?? -1) > (previous.reactionVersion ?? -1);
      if (newer || (previous.replyTo === undefined && message.replyTo !== undefined))
        merged.set(message.id, {
          ...previous,
          ...(previous.replyTo === undefined
            ? { replyTo: message.replyTo, replyToMessageId: message.replyToMessageId }
            : {}),
          ...(newer
            ? { reactions: message.reactions, reactionVersion: message.reactionVersion }
            : {}),
        });
    }
    const update = getItem(row.reactionUpdates, message.id);
    const currentMessage = merged.get(message.id) ?? message;
    if (update && update.reactionVersion > (currentMessage.reactionVersion ?? -1))
      merged.set(message.id, {
        ...currentMessage,
        reactions: update.reactions,
        reactionVersion: update.reactionVersion,
      });
  }
  return {
    ...row,
    messages: createCollection(
      'id',
      [...merged.values()].sort((a, b) => a.sequence - b.sequence),
    ),
  };
}
function interrupted(row: WorkspaceDiscussion): WorkspaceDiscussion {
  return {
    ...row,
    loading: false,
    loadingOlder: false,
    requestId: null,
    sending: false,
    reacting: [],
    metadataBefore: null,
    metadataFloor: null,
    pending: createCollection(
      'id',
      getItems(row.pending).map((m) =>
        m.status === 'sending' ? { ...m, status: 'failed' as const, error: 'unknown' as const } : m,
      ),
    ),
    sendError: getItems(row.pending).length ? 'unknown' : null,
  };
}
workspaceDiscussionReducer.with(
  discussionContextChanged,
  (state, { payload: [context, owner] }) => {
    if (context === state.context && (!owner || owner === state.owner)) return state;
    if (owner && owner !== state.owner)
      return {
        ...initialState,
        nextEpoch: state.nextEpoch,
        requestedIds: state.requestedIds,
        directoryRequestedIds: state.directoryRequestedIds,
        context,
        owner,
      };
    return {
      ...state,
      context,
      conversationsSupported: null,
      sharingEnabled: null,
      messageActionsSupported: null,
      agentMessagingSupported: null,
      directories: {},
      recipients: {},
      byWorkspaceId: Object.fromEntries(
        Object.entries(state.byWorkspaceId).map(([ws, rows]) => [
          ws,
          Object.fromEntries(
            Object.entries(rows).map(([id, row]) => [
              id,
              {
                ...interrupted(row),
                authorized:
                  context && id !== DEFAULT_DISCUSSION_ID && id !== NEW_DISCUSSION_ID
                    ? false
                    : row.authorized,
              },
            ]),
          ),
        ]),
      ),
    };
  },
);
workspaceDiscussionReducer.with(
  discussionWorkspacesChanged,
  (state, { payload: [workspaceIds] }) => ({
    ...state,
    workspaceIds,
    requestedIds: state.requestedIds.filter((key) => workspaceIds.includes(JSON.parse(key)[0])),
    directoryRequestedIds: state.directoryRequestedIds.filter((id) => workspaceIds.includes(id)),
    byWorkspaceId: Object.fromEntries(
      Object.entries(state.byWorkspaceId).filter(([id]) => workspaceIds.includes(id)),
    ),
    directories: Object.fromEntries(
      Object.entries(state.directories).filter(([id]) => workspaceIds.includes(id)),
    ),
    recipients: Object.fromEntries(
      Object.entries(state.recipients).filter(([id]) => workspaceIds.includes(id)),
    ),
  }),
);
workspaceDiscussionReducer.with(
  discussionRequested,
  (state, { payload: [workspaceId, conversationId = DEFAULT_DISCUSSION_ID] }) => {
    const key = discussionKey(workspaceId, conversationId);
    if (!state.requestedIds.includes(key))
      state = { ...state, requestedIds: [...state.requestedIds, key] };
    if (
      !state.context ||
      !state.workspaceIds.includes(workspaceId) ||
      discussionRow(state, workspaceId, conversationId)
    )
      return state;
    return set(
      { ...state, nextEpoch: state.nextEpoch + 1 },
      { workspaceId, conversationId },
      {
        ...emptyDiscussion,
        epoch: state.nextEpoch + 1,
        authorized:
          conversationId === DEFAULT_DISCUSSION_ID || conversationId === NEW_DISCUSSION_ID,
      },
    );
  },
);
workspaceDiscussionReducer.with(
  discussionDraftChanged,
  (state, { payload: [workspaceId, draft, conversationId = DEFAULT_DISCUSSION_ID] }) => {
    const row = discussionRow(state, workspaceId, conversationId);
    return row && state.context && state.workspaceIds.includes(workspaceId)
      ? set(
          state,
          { workspaceId, conversationId },
          {
            ...row,
            draft,
            agentMentions: reconcileDiscussionAgentMentions(row.draft, draft, row.agentMentions),
            draftVersion: row.draftVersion + 1,
          },
        )
      : state;
  },
);
workspaceDiscussionReducer.with(
  discussionAgentSelected,
  (
    state,
    { payload: [workspaceId, agentId, name, start, end, conversationId = DEFAULT_DISCUSSION_ID] },
  ) => {
    const row = discussionRow(state, workspaceId, conversationId);
    if (
      !row ||
      !state.context ||
      !row.authorized ||
      state.agentMessagingSupported !== true ||
      conversationId !== DEFAULT_DISCUSSION_ID ||
      !state.workspaceIds.includes(workspaceId) ||
      !agentId ||
      !name.trim() ||
      row.agentMentions.length >= DISCUSSION_MAX_RECIPIENTS ||
      row.agentMentions.some((mention) => mention.agentId === agentId) ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start ||
      end > row.draft.length
    )
      return state;
    const label = name.replace(/\s+/g, ' ').trim();
    const prefix = start > 0 && !/\s/.test(row.draft[start - 1]) ? ' ' : '';
    const token = `@${label}`;
    const draft = row.draft.slice(0, start) + prefix + token + ' ' + row.draft.slice(end);
    return set(
      state,
      { workspaceId, conversationId },
      {
        ...row,
        draft,
        draftVersion: row.draftVersion + 1,
        agentMentions: [
          ...reconcileDiscussionAgentMentions(row.draft, draft, row.agentMentions),
          {
            agentId,
            name: label,
            start: start + prefix.length,
            end: start + prefix.length + token.length,
          },
        ],
      },
    );
  },
);
workspaceDiscussionReducer.with(
  discussionAgentRemoved,
  (state, { payload: [workspaceId, agentId, conversationId = DEFAULT_DISCUSSION_ID] }) => {
    const row = discussionRow(state, workspaceId, conversationId);
    if (!row || !state.context || !state.workspaceIds.includes(workspaceId)) return state;
    const mention = row.agentMentions.find((selected) => selected.agentId === agentId);
    if (!mention) return state;
    const end = mention.end + (row.draft[mention.end] === ' ' ? 1 : 0);
    const draft = row.draft.slice(0, mention.start) + row.draft.slice(end);
    return set(
      state,
      { workspaceId, conversationId },
      {
        ...row,
        draft,
        agentMentions: row.agentMentions
          .filter((selected) => selected.agentId !== agentId)
          .map((selected) =>
            selected.start >= end
              ? {
                  ...selected,
                  start: selected.start - (end - mention.start),
                  end: selected.end - (end - mention.start),
                }
              : selected,
          ),
        draftVersion: row.draftVersion + 1,
      },
    );
  },
);
workspaceDiscussionReducer.with(discussionReadThrough, (state, { payload: [target, sequence] }) => {
  const row = current(state, target);
  if (
    !row?.authorized ||
    !Number.isSafeInteger(sequence) ||
    sequence <= (row.readSequence ?? -1) ||
    !getItems(row.messages).some((message) => message.sequence === sequence)
  )
    return state;
  return set(state, target, { ...row, readSequence: sequence });
});
workspaceDiscussionReducer.with(
  discussionMessageReceived,
  (state, { payload: [target, message] }) => {
    const row = current(state, target);
    return row && matches(target, message) ? set(state, target, receive(row, [message])) : state;
  },
);
workspaceDiscussionReducer.with(
  discussionLoadStarted,
  (state, { payload: [target, requestId, older] }) => {
    const row = current(state, target);
    return row
      ? set(state, target, {
          ...row,
          requestId,
          loading: !older,
          loadingOlder: older,
          catchUp: row.catchUp || (!older && row.initialized),
          error: null,
          unsupported: false,
        })
      : state;
  },
);
workspaceDiscussionReducer.with(
  discussionPageReceived,
  (state, { payload: [target, requestId, result, direction] }) => {
    const row = current(state, target);
    if (!row || row.requestId !== requestId || result.messages.some((m) => !matches(target, m)))
      return state;
    if (result.conversation) state = rememberConversation(state, result.conversation);
    return set(state, target, {
      ...receive(row, result.messages),
      authorized: true,
      ...(direction === 'newer'
        ? {
            syncedSequence: result.messages.at(-1)?.sequence ?? row.syncedSequence,
            catchUp: result.hasMore,
          }
        : {
            beforeSequence: result.messages[0]?.sequence ?? row.beforeSequence,
            hasMore: result.hasMore,
            ...(direction === 'initial'
              ? {
                  syncedSequence: result.messages.at(-1)?.sequence ?? 0,
                  readSequence: row.readSequence ?? result.messages.at(-1)?.sequence ?? 0,
                  catchUp: false,
                }
              : {}),
          }),
      initialized: true,
    });
  },
);
workspaceDiscussionReducer.with(
  discussionLoadFinished,
  (state, { payload: [target, requestId, error] }) => {
    const row = current(state, target);
    if (!row || row.requestId !== requestId) return state;
    if (
      error === 'forbidden' &&
      target.conversationId &&
      target.conversationId !== DEFAULT_DISCUSSION_ID
    )
      state = forgetConversation(state, target.workspaceId, target.conversationId);
    return set(state, target, {
      ...(error === 'forbidden' &&
      target.conversationId &&
      target.conversationId !== DEFAULT_DISCUSSION_ID
        ? { ...emptyDiscussion, epoch: row.epoch }
        : row),
      requestId: null,
      loading: false,
      loadingOlder: false,
      error,
      unsupported: error === 'unsupported',
    });
  },
);
workspaceDiscussionReducer.with(discussionSendStarted, (state, { payload: [target, pending] }) => {
  const row = current(state, target);
  if (!row) return state;
  return set(state, target, {
    ...row,
    pending: createCollection('id', [
      ...getItems(row.pending).filter((m) => m.id !== pending.id),
      pending,
    ]),
    sending: true,
    recipientsLocked: row.recipientsLocked || target.conversationId === NEW_DISCUSSION_ID,
    sendError: null,
  });
});
function failSend(
  row: WorkspaceDiscussion,
  messageId: string,
  error: DiscussionError,
): WorkspaceDiscussion {
  const pending = getItems(row.pending).map((m) =>
    m.id === messageId ? { ...m, status: 'failed' as const, error } : m,
  );
  return {
    ...row,
    pending: createCollection('id', pending),
    sending: pending.some((m) => m.status === 'sending'),
    sendError: error,
    unsupported:
      row.unsupported ||
      (error === 'unsupported' &&
        !getItems(row.pending).find((m) => m.id === messageId)?.recipientAgentIds?.length),
  };
}
workspaceDiscussionReducer.with(
  discussionSendFailed,
  (state, { payload: [target, messageId, error] }) => {
    const row = current(state, target);
    if (!row || !getItem(row.pending, messageId)) return state;
    if (
      target.conversationId === NEW_DISCUSSION_ID &&
      (error === 'invalid' || error === 'forbidden')
    ) {
      // A definitive rejection created nothing. Keep the text editable; a corrected send gets a fresh key.
      return set(state, target, {
        ...row,
        pending: createCollection('id'),
        sending: false,
        recipientsLocked: false,
        sendError: error,
      });
    }
    if (
      error === 'forbidden' &&
      target.conversationId &&
      target.conversationId !== DEFAULT_DISCUSSION_ID
    ) {
      return set(forgetConversation(state, target.workspaceId, target.conversationId), target, {
        ...emptyDiscussion,
        epoch: row.epoch,
        error,
      });
    }
    return set(state, target, failSend(row, messageId, error));
  },
);

workspaceDiscussionReducer.with(
  discussionSendSucceeded,
  (state, { payload: [target, messageId, message, conversation] }) => {
    const row = current(state, target);
    if (!row) return state;
    const sent = getItem(row.pending, messageId);
    if (!sent) return state;
    if (
      !isDiscussionMessage(message) ||
      (target.conversationId === NEW_DISCUSSION_ID
        ? message.workspaceId !== target.workspaceId ||
          !conversation ||
          !isDiscussionConversation(conversation) ||
          conversation.id !== message.conversationId ||
          conversation.id === DEFAULT_DISCUSSION_ID
        : !matches(target, message)) ||
      sent.body !== message.body ||
      message.author.agentId !== undefined ||
      JSON.stringify([...(sent.recipientAgentIds ?? [])].sort()) !==
        JSON.stringify([...(message.recipientAgentIds ?? [])].sort()) ||
      (sent.replyToMessageId ?? null) !== (message.replyToMessageId ?? null)
    )
      return set(state, target, failSend(row, messageId, 'unknown'));
    const pending = getItems(row.pending).filter((m) => m.id !== messageId);
    if (conversation) state = rememberConversation(state, conversation);
    const clearDraft =
      row.draftVersion === sent.draftVersion &&
      row.draft === sent.body &&
      (sent.replyVersion === undefined || row.replyVersion === sent.replyVersion);
    const settled = {
      ...receive(row, [message]),
      pending: createCollection('id', pending),
      draft: clearDraft ? '' : row.draft,
      agentMentions: clearDraft ? [] : row.agentMentions,
      replyToMessageId:
        row.replyVersion === sent.replyVersion &&
        row.replyToMessageId === (sent.replyToMessageId ?? null)
          ? null
          : row.replyToMessageId,
      sending: pending.some((m) => m.status === 'sending'),
      sendError: pending.find((m) => m.status === 'failed')?.error ?? null,
    };
    if (target.conversationId === NEW_DISCUSSION_ID && conversation) {
      const destination = discussionRow(state, target.workspaceId, conversation.id);
      state = set(
        { ...state, nextEpoch: state.nextEpoch + 1 },
        { workspaceId: target.workspaceId, conversationId: conversation.id },
        {
          ...settled,
          messages: receive(destination ?? emptyDiscussion, [message]).messages,
          epoch: destination?.epoch ?? state.nextEpoch + 1,
          authorized: true,
          recipientPrincipalIds: [],
          recipientsLocked: false,
        },
      );
      return set(state, target, {
        ...emptyDiscussion,
        epoch: row.epoch,
        authorized: true,
        createdConversationId: conversation.id,
      });
    }
    return set(state, target, settled);
  },
);

type DiscussionStatus = 'idle' | 'loading' | 'ready' | 'error';
export interface DiscussionDirectory {
  conversations: Collection<DiscussionConversation, 'id'>;
  status: DiscussionStatus;
  hasMore: boolean;
  beforeId?: string;
  error: DiscussionError | null;
  requestId: string | null;
}
export interface DiscussionRecipients {
  members: Collection<DiscussionAuthor, 'principalId'>;
  knownMembers: Collection<DiscussionAuthor, 'principalId'>;
  query: string;
  status: DiscussionStatus;
  hasMore: boolean;
  afterPrincipalId?: string;
  error: DiscussionError | null;
  requestId: string | null;
}
export const emptyDirectory: DiscussionDirectory = {
  conversations: createCollection('id'),
  status: 'idle',
  hasMore: false,
  error: null,
  requestId: null,
};
export const emptyRecipients: DiscussionRecipients = {
  members: createCollection('principalId'),
  knownMembers: createCollection('principalId'),
  query: '',
  status: 'idle',
  hasMore: false,
  error: null,
  requestId: null,
};
export const discussionCapabilityReceived = createAction<[context: string, supported: boolean]>(
  'workspaceDiscussion/capabilityReceived',
);
export const discussionNewRequested = createAction<[workspaceId: string]>(
  'workspaceDiscussion/newRequested',
);
export const discussionRecipientsChanged = createAction<
  [workspaceId: string, principalIds: string[]]
>('workspaceDiscussion/recipientsChanged');
export const discussionDirectoryRequested = createAction<[workspaceId: string, older?: boolean]>(
  'workspaceDiscussion/directoryRequested',
);
export const discussionRecipientsRequested = createAction<
  [workspaceId: string, query?: string, older?: boolean]
>('workspaceDiscussion/recipientsRequested');
export const discussionDirectoryStarted = createAction<
  [context: string, workspaceId: string, requestId: string]
>('workspaceDiscussion/directoryStarted');
export const discussionDirectoryReceived = createAction<
  [context: string, workspaceId: string, requestId: string, result: DiscussionConversationsResult]
>('workspaceDiscussion/directoryReceived');
export const discussionDirectoryFailed = createAction<
  [context: string, workspaceId: string, requestId: string, error: DiscussionError]
>('workspaceDiscussion/directoryFailed');
export const discussionRecipientsStarted = createAction<
  [context: string, workspaceId: string, requestId: string, query: string]
>('workspaceDiscussion/recipientsStarted');
export const discussionRecipientsReceived = createAction<
  [
    context: string,
    workspaceId: string,
    requestId: string,
    result: DiscussionRecipientsResult,
    older: boolean,
  ]
>('workspaceDiscussion/recipientsReceived');
export const discussionRecipientsFailed = createAction<
  [context: string, workspaceId: string, requestId: string, error: DiscussionError]
>('workspaceDiscussion/recipientsFailed');
export const discussionConversationReceived = createAction<
  [context: string, conversation: DiscussionConversation]
>('workspaceDiscussion/conversationReceived');
export const discussionMembershipInvalidated = createAction<[workspaceId: string]>(
  'workspaceDiscussion/membershipInvalidated',
);
function rememberConversation(
  state: WorkspaceDiscussionState,
  conversation: DiscussionConversation,
): WorkspaceDiscussionState {
  const directory = state.directories[conversation.workspaceId] ?? emptyDirectory;
  return {
    ...state,
    directories: {
      ...state.directories,
      [conversation.workspaceId]: {
        ...directory,
        conversations: createCollection(
          'id',
          [
            ...getItems(directory.conversations).filter((c) => c.id !== conversation.id),
            conversation,
          ].sort((a, b) =>
            a.id === b.id
              ? 0
              : a.id === DEFAULT_DISCUSSION_ID
                ? -1
                : b.id === DEFAULT_DISCUSSION_ID
                  ? 1
                  : a.id > b.id
                    ? -1
                    : 1,
          ),
        ),
      },
    },
  };
}
function admitted(state: WorkspaceDiscussionState, context: string, workspaceId: string): boolean {
  return state.context === context && state.workspaceIds.includes(workspaceId);
}
workspaceDiscussionReducer.with(
  discussionCapabilityReceived,
  (state, { payload: [context, supported] }) =>
    state.context === context ? { ...state, conversationsSupported: supported } : state,
);
workspaceDiscussionReducer.with(discussionNewRequested, (state, { payload: [workspaceId] }) => {
  const row = discussionRow(state, workspaceId, NEW_DISCUSSION_ID);
  if (!row?.createdConversationId || !state.context) return state;
  return set(
    { ...state, nextEpoch: state.nextEpoch + 1 },
    { workspaceId, conversationId: NEW_DISCUSSION_ID },
    { ...emptyDiscussion, epoch: state.nextEpoch + 1, authorized: true },
  );
});
workspaceDiscussionReducer.with(
  discussionRecipientsChanged,
  (state, { payload: [workspaceId, principalIds] }) => {
    const row = discussionRow(state, workspaceId, NEW_DISCUSSION_ID);
    if (!row || row.recipientsLocked || !state.context || state.conversationsSupported !== true)
      return state;
    const known = state.recipients[workspaceId]?.knownMembers;
    if (
      !known ||
      principalIds.length > DISCUSSION_MAX_RECIPIENTS ||
      principalIds.some((id) => !getItem(known, id))
    )
      return state;
    return set(
      state,
      { workspaceId, conversationId: NEW_DISCUSSION_ID },
      { ...row, recipientPrincipalIds: [...new Set(principalIds)] },
    );
  },
);
workspaceDiscussionReducer.with(
  discussionDirectoryRequested,
  (state, { payload: [workspaceId] }) =>
    state.directoryRequestedIds.includes(workspaceId)
      ? state
      : { ...state, directoryRequestedIds: [...state.directoryRequestedIds, workspaceId] },
);
workspaceDiscussionReducer.with(
  discussionDirectoryStarted,
  (state, { payload: [context, workspaceId, requestId] }) =>
    admitted(state, context, workspaceId)
      ? {
          ...state,
          directories: {
            ...state.directories,
            [workspaceId]: {
              ...(state.directories[workspaceId] ?? emptyDirectory),
              requestId,
              status: 'loading',
              error: null,
            },
          },
        }
      : state,
);
workspaceDiscussionReducer.with(
  discussionDirectoryReceived,
  (state, { payload: [context, workspaceId, requestId, result] }) => {
    const row = state.directories[workspaceId];
    if (!row || row.requestId !== requestId || !admitted(state, context, workspaceId)) return state;
    for (const c of result.conversations) state = rememberConversation(state, c);
    return {
      ...state,
      directories: {
        ...state.directories,
        [workspaceId]: {
          ...state.directories[workspaceId],
          status: 'ready',
          requestId: null,
          hasMore: result.hasMore,
          beforeId: result.conversations.at(-1)?.id ?? row.beforeId,
        },
      },
    };
  },
);
workspaceDiscussionReducer.with(
  discussionDirectoryFailed,
  (state, { payload: [context, workspaceId, requestId, error] }) => {
    const row = state.directories[workspaceId];
    return row?.requestId === requestId && admitted(state, context, workspaceId)
      ? {
          ...state,
          directories: {
            ...state.directories,
            [workspaceId]: { ...row, status: 'error', requestId: null, error },
          },
        }
      : state;
  },
);
workspaceDiscussionReducer.with(
  discussionRecipientsStarted,
  (state, { payload: [context, workspaceId, requestId, query] }) => {
    if (!admitted(state, context, workspaceId)) return state;
    const row = state.recipients[workspaceId] ?? emptyRecipients;
    return {
      ...state,
      recipients: {
        ...state.recipients,
        [workspaceId]: {
          ...row,
          ...(row.query !== query
            ? {
                members: createCollection<DiscussionAuthor, 'principalId'>('principalId'),
                afterPrincipalId: undefined,
                hasMore: false,
              }
            : {}),
          query,
          requestId,
          status: 'loading',
          error: null,
        },
      },
    };
  },
);
workspaceDiscussionReducer.with(
  discussionRecipientsReceived,
  (state, { payload: [context, workspaceId, requestId, result, older] }) => {
    const row = state.recipients[workspaceId];
    if (!row || row.requestId !== requestId || !admitted(state, context, workspaceId)) return state;
    const known = new Map(getItems(row.knownMembers).map((m) => [m.principalId, m]));
    for (const m of result.members) known.set(m.principalId, m);
    return {
      ...state,
      recipients: {
        ...state.recipients,
        [workspaceId]: {
          ...row,
          status: 'ready',
          requestId: null,
          members: createCollection('principalId', [
            ...(older ? getItems(row.members) : []),
            ...result.members,
          ]),
          knownMembers: createCollection('principalId', [...known.values()]),
          hasMore: result.hasMore,
          afterPrincipalId: result.members.at(-1)?.principalId ?? row.afterPrincipalId,
        },
      },
    };
  },
);
workspaceDiscussionReducer.with(
  discussionRecipientsFailed,
  (state, { payload: [context, workspaceId, requestId, error] }) => {
    const row = state.recipients[workspaceId];
    return row?.requestId === requestId && admitted(state, context, workspaceId)
      ? {
          ...state,
          recipients: {
            ...state.recipients,
            [workspaceId]: { ...row, status: 'error', requestId: null, error },
          },
        }
      : state;
  },
);
workspaceDiscussionReducer.with(
  discussionConversationReceived,
  (state, { payload: [context, conversation] }) =>
    admitted(state, context, conversation.workspaceId)
      ? rememberConversation(state, conversation)
      : state,
);
workspaceDiscussionReducer.with(
  discussionMembershipInvalidated,
  (state, { payload: [workspaceId] }) => {
    const rows = state.byWorkspaceId[workspaceId];
    let nextEpoch = state.nextEpoch;
    return {
      ...state,
      directories: { ...state.directories, [workspaceId]: emptyDirectory },
      recipients: { ...state.recipients, [workspaceId]: emptyRecipients },
      byWorkspaceId: {
        ...state.byWorkspaceId,
        [workspaceId]: Object.fromEntries(
          Object.entries(rows ?? {}).map(([id, row]) => [
            id,
            {
              ...interrupted(row),
              epoch: ++nextEpoch,
              authorized: id === DEFAULT_DISCUSSION_ID || id === NEW_DISCUSSION_ID,
              ...(id === NEW_DISCUSSION_ID && !row.recipientsLocked
                ? { recipientPrincipalIds: [] }
                : {}),
            },
          ]),
        ),
      },
      nextEpoch,
    };
  },
);

function forgetConversation(
  state: WorkspaceDiscussionState,
  workspaceId: string,
  conversationId: string,
): WorkspaceDiscussionState {
  const directory = state.directories[workspaceId];
  if (!directory) return state;
  return {
    ...state,
    directories: {
      ...state.directories,
      [workspaceId]: {
        ...directory,
        conversations: createCollection(
          'id',
          getItems(directory.conversations).filter((c) => c.id !== conversationId),
        ),
      },
    },
  };
}

workspaceDiscussionReducer.with(
  discussionSharingReceived,
  (state, { payload: [context, enabled] }) =>
    state.context === context ? { ...state, sharingEnabled: enabled } : state,
);

workspaceDiscussionReducer.with(
  discussionAgentCapabilityReceived,
  (state, { payload: [context, supported] }) =>
    state.context === context ? { ...state, agentMessagingSupported: supported } : state,
);
workspaceDiscussionReducer.with(
  discussionMessageActionsReceived,
  (state, { payload: [context, supported] }) =>
    state.context === context ? { ...state, messageActionsSupported: supported } : state,
);
workspaceDiscussionReducer.with(
  discussionReplySelected,
  (state, { payload: [workspaceId, messageId, conversationId = DEFAULT_DISCUSSION_ID] }) => {
    const row = discussionRow(state, workspaceId, conversationId);
    if (
      !state.context ||
      !row?.authorized ||
      (messageId !== null &&
        (state.messageActionsSupported !== true || !getItem(row.messages, messageId)))
    )
      return state;
    return set(
      state,
      { workspaceId, conversationId },
      { ...row, replyToMessageId: messageId, replyVersion: row.replyVersion + 1 },
    );
  },
);
workspaceDiscussionReducer.with(
  discussionReactionReceived,
  (state, { payload: [target, result] }) => {
    const row = current(state, target);
    if (!row || !isDiscussionReactionResult(result)) return state;
    const previous = getItem(row.reactionUpdates, result.messageId);
    const message = getItem(row.messages, result.messageId);
    if (
      result.reactionVersion <=
      Math.max(previous?.reactionVersion ?? -1, message?.reactionVersion ?? -1)
    )
      return state;
    const updated = {
      ...row,
      reactionUpdates: createCollection('messageId', [
        ...getItems(row.reactionUpdates).filter((r) => r.messageId !== result.messageId),
        result,
      ]),
    };
    return set(state, target, receive(updated, getItems(row.messages)));
  },
);
workspaceDiscussionReducer.with(discussionReactionStarted, (state, { payload: [target, key] }) => {
  const row = current(state, target);
  return row
    ? set(state, target, {
        ...row,
        reacting: [...row.reacting.filter((k) => k !== key), key],
        reactionError: null,
      })
    : state;
});
workspaceDiscussionReducer.with(
  discussionReactionFinished,
  (state, { payload: [target, key, error] }) => {
    const row = current(state, target);
    if (
      row &&
      error === 'forbidden' &&
      target.conversationId &&
      target.conversationId !== DEFAULT_DISCUSSION_ID
    )
      return set(forgetConversation(state, target.workspaceId, target.conversationId), target, {
        ...emptyDiscussion,
        epoch: row.epoch,
        error,
      });
    return row
      ? set(state, target, {
          ...row,
          reacting: row.reacting.filter((k) => k !== key),
          reactionError: error,
        })
      : state;
  },
);
workspaceDiscussionReducer.with(
  discussionMetadataProgress,
  (state, { payload: [target, requestId, messages, before, floor] }) => {
    const row = current(state, target);
    if (!row || row.requestId !== requestId || messages.some((m) => !matches(target, m)))
      return state;
    return set(state, target, {
      ...receive(row, messages),
      metadataBefore: before,
      metadataFloor: floor,
    });
  },
);
