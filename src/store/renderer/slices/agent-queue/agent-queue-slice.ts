import type { QueuedMessage } from '$shared/types';
import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  addItem,
  createCollection,
  getItem,
  getItems,
  removeItem,
  replaceItem,
  upsertItem,
} from '@themislib/themis/utils/collections/collection-utils';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import type {
  AgentQueueEntryState,
  AgentQueueState,
  QueuedMessageMutation,
  QueuedMessageMutationRequest,
  QueuedMessageMutationResult,
} from './agent-queue-types';

const RECENTLY_REMOVED_MESSAGE_ID_LIMIT = 100;

const createEmptyAgentQueueEntry = (): AgentQueueEntryState => ({
  messages: createCollection<QueuedMessage, 'id'>('id'),
  recentlyRemovedMessageIds: [],
  isHydrating: false,
  error: null,
});

export const initialState: AgentQueueState = {
  byAgentId: {},
  mutations: createCollection<QueuedMessageMutation, 'requestId'>('requestId'),
};

export const hydrateAgentQueueRequested = createAction<[agentId: string, workspaceId?: string]>(
  'agentQueue/hydrateRequested',
);

export const replaceAgentQueue =
  createAction<[agentId: string, messages: QueuedMessage[], workspaceId?: string]>(
    'agentQueue/replaceQueue',
  );

/** Fold one daemon-persisted mutation result into the queue without changing stable order. */
export const upsertQueuedMessageInAgentQueue = createAction<
  [agentId: string, message: QueuedMessage]
>('agentQueue/upsertQueuedMessage');

export const removeQueuedMessageFromAgentQueue = createAction<[agentId: string, messageId: string]>(
  'agentQueue/removeQueuedMessage',
);

/**
 * Saga trigger for a queued edit/remove/send-now. The chat command FIFO runs it in
 * per-agent order with sends; the consumer reads the settled outcome by requestId.
 */
export const queuedMessageMutationRequested = createAction<[request: QueuedMessageMutationRequest]>(
  'agentQueue/mutationRequested',
);

export const queuedMessageMutationFinished = createAction<
  [requestId: string, result: QueuedMessageMutationResult]
>('agentQueue/mutationFinished');

export const queuedMessageMutationConsumed = createAction<
  [consumerId: string, requestId: string]
>('agentQueue/mutationConsumed');

/** Drop every outcome owned by a consumer that unmounted. */
export const queuedMessageMutationsReleased = createAction<[consumerId: string]>(
  'agentQueue/mutationsReleased',
);

/** Un-mark a recently-removed ID so a later hydration can bring the message back. */
export const restoreRecentlyRemovedMessageId = createAction<[agentId: string, messageId: string]>(
  'agentQueue/restoreRecentlyRemovedMessageId',
);

export const clearAgentQueue = createAction<[agentId: string]>('agentQueue/clearQueue');

export const setAgentQueueHydrating =
  createAction<[agentId: string, isHydrating: boolean]>('agentQueue/setHydrating');

export const setAgentQueueError =
  createAction<[agentId: string, error: string | null]>('agentQueue/setError');

function setAgentQueueEntry(
  state: AgentQueueState,
  agentId: string,
  entry: AgentQueueEntryState,
): AgentQueueState {
  return {
    ...state,
    byAgentId: {
      ...state.byAgentId,
      [agentId]: entry,
    },
  };
}

function rememberRecentlyRemovedMessageId(ids: string[], messageId: string): string[] {
  if (ids[ids.length - 1] === messageId) return ids;
  const withoutExisting = ids.filter((id) => id !== messageId);
  const next = [...withoutExisting, messageId];
  return next.length > RECENTLY_REMOVED_MESSAGE_ID_LIMIT
    ? next.slice(next.length - RECENTLY_REMOVED_MESSAGE_ID_LIMIT)
    : next;
}

function suppressRecentlyRemovedMessages(
  messages: QueuedMessage[],
  recentlyRemovedMessageIds: string[],
): QueuedMessage[] {
  if (recentlyRemovedMessageIds.length === 0) return messages;
  const filtered = messages.filter((message) => !recentlyRemovedMessageIds.includes(message.id));
  return filtered.length === messages.length
    ? messages
    : filtered.map((message, position) => ({ ...message, position }));
}

function scopedEntry(
  state: AgentQueueState,
  agentId: string,
  workspaceId?: string,
): AgentQueueEntryState {
  const current = state.byAgentId[agentId];
  if (
    workspaceId !== undefined &&
    current?.workspaceId !== undefined &&
    current.workspaceId !== workspaceId
  ) {
    return { ...createEmptyAgentQueueEntry(), workspaceId };
  }
  const entry = current ?? createEmptyAgentQueueEntry();
  return workspaceId === undefined ? entry : { ...entry, workspaceId };
}

export const agentQueueReducer = createReducer<AgentQueueState>(initialState);

agentQueueReducer.with(hydrateAgentQueueRequested, (state, { payload: [agentId, workspaceId] }) => {
  const current = scopedEntry(state, agentId, workspaceId);
  return setAgentQueueEntry(state, agentId, {
    ...current,
    recentlyRemovedMessageIds: current.recentlyRemovedMessageIds ?? [],
    isHydrating: true,
    error: null,
  });
});
agentQueueReducer.with(
  replaceAgentQueue,
  (state, { payload: [agentId, messages, workspaceId] }) => {
    const current = scopedEntry(state, agentId, workspaceId);
    const recentlyRemovedMessageIds = current.recentlyRemovedMessageIds ?? [];
    const visibleMessages = suppressRecentlyRemovedMessages(messages, recentlyRemovedMessageIds);
    return setAgentQueueEntry(state, agentId, {
      ...current,
      recentlyRemovedMessageIds,
      messages: createCollection<QueuedMessage, 'id'>('id', visibleMessages),
      isHydrating: false,
      error: null,
    });
  },
);
agentQueueReducer.with(
  upsertQueuedMessageInAgentQueue,
  (state, { payload: [agentId, message] }) => {
    const current = state.byAgentId[agentId] ?? createEmptyAgentQueueEntry();
    const recentlyRemovedMessageIds = current.recentlyRemovedMessageIds ?? [];
    if (recentlyRemovedMessageIds.includes(message.id)) return state;
    const existing = getItem(current.messages, message.id);
    const messages = existing
      ? replaceItem(current.messages, message.id, message)
      : addItem(current.messages, message);
    return setAgentQueueEntry(state, agentId, {
      ...current,
      messages,
      recentlyRemovedMessageIds,
    });
  },
);
agentQueueReducer.with(
  removeQueuedMessageFromAgentQueue,
  (state, { payload: [agentId, messageId] }) => {
    const current = state.byAgentId[agentId] ?? createEmptyAgentQueueEntry();
    const currentRecentlyRemovedMessageIds = current.recentlyRemovedMessageIds ?? [];
    const existingMessage = getItem(current.messages, messageId);

    const recentlyRemovedMessageIds = rememberRecentlyRemovedMessageId(
      currentRecentlyRemovedMessageIds,
      messageId,
    );

    if (!existingMessage && recentlyRemovedMessageIds === currentRecentlyRemovedMessageIds) {
      return state;
    }

    const messages = existingMessage
      ? createCollection<QueuedMessage, 'id'>(
          'id',
          getItems(current.messages)
            .filter((message) => message.id !== messageId)
            .map((message, position) => ({ ...message, position })),
        )
      : current.messages;

    return setAgentQueueEntry(state, agentId, {
      ...current,
      messages,
      recentlyRemovedMessageIds,
    });
  },
);
agentQueueReducer.with(
  restoreRecentlyRemovedMessageId,
  (state, { payload: [agentId, messageId] }) => {
    const current = state.byAgentId[agentId];
    if (!current) return state;
    const currentRecentlyRemovedMessageIds = current.recentlyRemovedMessageIds ?? [];
    if (!currentRecentlyRemovedMessageIds.includes(messageId)) return state;
    return setAgentQueueEntry(state, agentId, {
      ...current,
      recentlyRemovedMessageIds: currentRecentlyRemovedMessageIds.filter((id) => id !== messageId),
    });
  },
);
agentQueueReducer.with(queuedMessageMutationRequested, (state, { payload: [request] }) => {
  if (getItem(state.mutations, request.requestId)) return state;
  const { operation, ...identity } = request;
  return {
    ...state,
    mutations: addItem(state.mutations, {
      ...identity,
      kind: operation.kind,
      ...(operation.kind === 'edit' && operation.editing !== undefined
        ? { editing: operation.editing }
        : {}),
      status: 'pending',
    }),
  };
});
agentQueueReducer.with(queuedMessageMutationFinished, (state, { payload: [requestId, result] }) => {
  const entry = getItem(state.mutations, requestId);
  if (entry?.status !== 'pending') return state;
  return {
    ...state,
    mutations: upsertItem(state.mutations, {
      ...entry,
      status: result.status,
      ...(result.sendOutcome ? { sendOutcome: result.sendOutcome } : {}),
      ...(result.error ? { error: result.error } : {}),
    }),
  };
});
agentQueueReducer.with(
  queuedMessageMutationConsumed,
  (state, { payload: [consumerId, requestId] }) => {
    const entry = getItem(state.mutations, requestId);
    if (entry?.consumerId !== consumerId || entry.status === 'pending') return state;
    return { ...state, mutations: removeItem(state.mutations, requestId) };
  },
);
agentQueueReducer.with(queuedMessageMutationsReleased, (state, { payload: [consumerId] }) => {
  const owned = getItems(state.mutations).filter((entry) => entry.consumerId === consumerId);
  if (owned.length === 0) return state;
  return {
    ...state,
    mutations: owned.reduce(
      (mutations, entry) => removeItem(mutations, entry.requestId),
      state.mutations,
    ),
  };
});
agentQueueReducer.with(workspaceUnmounted, (state, { payload: [workspaceId] }) => {
  const owned = getItems(state.mutations).filter((entry) => entry.workspaceId === workspaceId);
  if (owned.length === 0) return state;
  return {
    ...state,
    mutations: owned.reduce(
      (mutations, entry) => removeItem(mutations, entry.requestId),
      state.mutations,
    ),
  };
});
agentQueueReducer.with(clearAgentQueue, (state, { payload: [agentId] }) => {
  if (!state.byAgentId[agentId]) return state;
  const remaining = { ...state.byAgentId };
  delete remaining[agentId];
  return { ...state, byAgentId: remaining };
});
agentQueueReducer.with(setAgentQueueHydrating, (state, { payload: [agentId, isHydrating] }) => {
  const current = state.byAgentId[agentId];
  if (!current && !isHydrating) return state;
  return setAgentQueueEntry(state, agentId, {
    ...(current ?? createEmptyAgentQueueEntry()),
    recentlyRemovedMessageIds: current?.recentlyRemovedMessageIds ?? [],
    isHydrating,
    error: isHydrating ? null : (current?.error ?? null),
  });
});
agentQueueReducer.with(setAgentQueueError, (state, { payload: [agentId, error] }) => {
  const current = state.byAgentId[agentId];
  if (!current && error === null) return state;
  return setAgentQueueEntry(state, agentId, {
    ...(current ?? createEmptyAgentQueueEntry()),
    recentlyRemovedMessageIds: current?.recentlyRemovedMessageIds ?? [],
    isHydrating: false,
    error,
  });
});
