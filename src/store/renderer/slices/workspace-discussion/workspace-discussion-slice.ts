import {
  createCollection,
  getItem,
  getItems,
  type Collection,
} from '@themislib/themis/utils/collections/collection-utils';
import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  isDiscussionMessage,
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
}
export interface WorkspaceDiscussion {
  epoch: number;
  messages: Collection<DiscussionMessage, 'id'>;
  pending: Collection<PendingDiscussionMessage, 'id'>;
  draft: string;
  draftVersion: number;
  loading: boolean;
  loadingOlder: boolean;
  initialized: boolean;
  hasMore: boolean;
  beforeSequence: number | null;
  /** Last history row synchronized by a list page; live messages never advance it. */
  syncedSequence: number | null;
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
  byWorkspaceId: Record<string, WorkspaceDiscussion>;
}
export interface DiscussionTarget {
  context: string;
  workspaceId: string;
  epoch: number;
}
export const emptyDiscussion: WorkspaceDiscussion = {
  epoch: 0,
  messages: createCollection('id'),
  pending: createCollection('id'),
  draft: '',
  draftVersion: 0,
  loading: false,
  loadingOlder: false,
  initialized: false,
  hasMore: false,
  beforeSequence: null,
  syncedSequence: null,
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
};

export const discussionRequested = createAction<[workspaceId: string]>(
  'workspaceDiscussion/requested',
);
export const discussionOlderRequested = createAction<[workspaceId: string]>(
  'workspaceDiscussion/olderRequested',
);
export const discussionDraftChanged = createAction<[workspaceId: string, body: string]>(
  'workspaceDiscussion/draftChanged',
);
export const discussionSendRequested = createAction<[workspaceId: string]>(
  'workspaceDiscussion/sendRequested',
);
export const discussionRetryRequested = createAction<[workspaceId: string, messageId: string]>(
  'workspaceDiscussion/retryRequested',
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
  [target: DiscussionTarget, messageId: string, message: DiscussionMessage]
>('workspaceDiscussion/sendSucceeded');
export const discussionSendFailed = createAction<
  [target: DiscussionTarget, messageId: string, error: DiscussionError]
>('workspaceDiscussion/sendFailed');

export const workspaceDiscussionReducer = createReducer<WorkspaceDiscussionState>(initialState);
const set = (
  state: WorkspaceDiscussionState,
  id: string,
  value: WorkspaceDiscussion,
): WorkspaceDiscussionState => ({
  ...state,
  byWorkspaceId: { ...state.byWorkspaceId, [id]: value },
});
function current(
  state: WorkspaceDiscussionState,
  target: DiscussionTarget,
): WorkspaceDiscussion | undefined {
  const row = state.byWorkspaceId[target.workspaceId];
  return state.context === target.context &&
    state.workspaceIds.includes(target.workspaceId) &&
    row?.epoch === target.epoch
    ? row
    : undefined;
}
function receive(row: WorkspaceDiscussion, messages: DiscussionMessage[]): WorkspaceDiscussion {
  const merged = new Map(getItems(row.messages).map((m) => [m.id, m]));
  for (const message of messages) {
    // Server IDs differ from send retry keys. An echo never settles a local retry.
    if (!merged.has(message.id)) merged.set(message.id, message);
  }
  return {
    ...row,
    messages: createCollection(
      'id',
      [...merged.values()].sort((a, b) => a.sequence - b.sequence),
    ),
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
        context,
        owner,
      };
    return {
      ...state,
      context,
      byWorkspaceId: Object.fromEntries(
        Object.entries(state.byWorkspaceId).map(([id, row]) => [
          id,
          {
            ...row,
            loading: false,
            loadingOlder: false,
            requestId: null,
            sending: false,
            pending: createCollection(
              'id',
              getItems(row.pending).map((m) =>
                m.status === 'sending'
                  ? { ...m, status: 'failed' as const, error: 'unknown' as const }
                  : m,
              ),
            ),
            sendError: getItems(row.pending).length ? ('unknown' as const) : null,
          },
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
    requestedIds: state.requestedIds.filter((id) => workspaceIds.includes(id)),
    byWorkspaceId: Object.fromEntries(
      Object.entries(state.byWorkspaceId).filter(([id]) => workspaceIds.includes(id)),
    ),
  }),
);
workspaceDiscussionReducer.with(discussionRequested, (state, { payload: [id] }) => {
  if (!state.requestedIds.includes(id))
    state = { ...state, requestedIds: [...state.requestedIds, id] };
  if (!state.context || !state.workspaceIds.includes(id) || state.byWorkspaceId[id]) return state;
  return set({ ...state, nextEpoch: state.nextEpoch + 1 }, id, {
    ...emptyDiscussion,
    epoch: state.nextEpoch + 1,
  });
});
workspaceDiscussionReducer.with(discussionDraftChanged, (state, { payload: [id, draft] }) => {
  const row = state.byWorkspaceId[id];
  return row && state.context && state.workspaceIds.includes(id)
    ? set(state, id, { ...row, draft, draftVersion: row.draftVersion + 1 })
    : state;
});
workspaceDiscussionReducer.with(
  discussionMessageReceived,
  (state, { payload: [target, message] }) => {
    const row = current(state, target);
    return row && message.workspaceId === target.workspaceId
      ? set(state, target.workspaceId, receive(row, [message]))
      : state;
  },
);
workspaceDiscussionReducer.with(
  discussionLoadStarted,
  (state, { payload: [target, requestId, older] }) => {
    const row = current(state, target);
    return row
      ? set(state, target.workspaceId, {
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
    if (
      !row ||
      row.requestId !== requestId ||
      result.messages.some((m) => m.workspaceId !== target.workspaceId)
    )
      return state;
    return set(state, target.workspaceId, {
      ...receive(row, result.messages),
      ...(direction === 'newer'
        ? {
            syncedSequence: result.messages.at(-1)?.sequence ?? row.syncedSequence,
            catchUp: result.hasMore,
          }
        : {
            beforeSequence: result.messages[0]?.sequence ?? row.beforeSequence,
            hasMore: result.hasMore,
            ...(direction === 'initial'
              ? { syncedSequence: result.messages.at(-1)?.sequence ?? 0, catchUp: false }
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
    return set(state, target.workspaceId, {
      ...row,
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
  return set(state, target.workspaceId, {
    ...row,
    pending: createCollection('id', [
      ...getItems(row.pending).filter((m) => m.id !== pending.id),
      pending,
    ]),
    sending: true,
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
    unsupported: row.unsupported || error === 'unsupported',
  };
}
workspaceDiscussionReducer.with(
  discussionSendFailed,
  (state, { payload: [target, messageId, error] }) => {
    const row = current(state, target);
    if (!row || !getItem(row.pending, messageId)) return state;
    return set(state, target.workspaceId, failSend(row, messageId, error));
  },
);

workspaceDiscussionReducer.with(
  discussionSendSucceeded,
  (state, { payload: [target, messageId, message] }) => {
    const row = current(state, target);
    if (!row) return state;
    const sent = getItem(row.pending, messageId);
    if (!sent) return state;
    if (
      !isDiscussionMessage(message) ||
      message.workspaceId !== target.workspaceId ||
      sent.body !== message.body
    )
      return set(state, target.workspaceId, failSend(row, messageId, 'unknown'));
    const pending = getItems(row.pending).filter((m) => m.id !== messageId);
    return set(state, target.workspaceId, {
      ...receive(row, [message]),
      pending: createCollection('id', pending),
      draft: row.draftVersion === sent.draftVersion && row.draft === sent.body ? '' : row.draft,
      sending: pending.some((m) => m.status === 'sending'),
      sendError: pending.find((m) => m.status === 'failed')?.error ?? null,
    });
  },
);
