import type { QueuedMessage } from "$shared/types";
import { createAction } from "$lib/store-shim/utils/store/create-action";
import { createReducer } from "$lib/store-shim/utils/store/create-reducer";
import {
  createCollection,
  getItem,
  getItems,
} from "$lib/store-shim/utils/collections/collection-utils";
import type { AgentQueueEntryState, AgentQueueState } from "./agent-queue-types";

const RECENTLY_REMOVED_MESSAGE_ID_LIMIT = 100;

const createEmptyAgentQueueEntry = (): AgentQueueEntryState => ({
  messages: createCollection<QueuedMessage, "id">("id"),
  recentlyRemovedMessageIds: [],
  lastSnapshotCount: 0,
  isHydrating: false,
  error: null,
});

export const initialState: AgentQueueState = {
  byAgentId: {},
};

export const hydrateAgentQueueRequested = createAction<[agentId: string]>(
  "agentQueue/hydrateRequested",
);

export const replaceAgentQueue = createAction<[agentId: string, messages: QueuedMessage[]]>(
  "agentQueue/replaceQueue",
);

export const removeQueuedMessageFromAgentQueue = createAction<[
  agentId: string,
  messageId: string,
]>("agentQueue/removeQueuedMessage");

/** Saga trigger: optimistically remove a queued message and ask the backend to remove it. */
export const removeQueuedMessageRequested = createAction<[
  agentId: string,
  messageId: string,
]>("agentQueue/removeRequested");

/** Un-mark a recently-removed ID so a later hydration can bring the message back. */
export const restoreRecentlyRemovedMessageId = createAction<[
  agentId: string,
  messageId: string,
]>("agentQueue/restoreRecentlyRemovedMessageId");

export const clearAgentQueue = createAction<[agentId: string]>("agentQueue/clearQueue");

export const setAgentQueueHydrating = createAction<[agentId: string, isHydrating: boolean]>(
  "agentQueue/setHydrating",
);

export const setAgentQueueError = createAction<[agentId: string, error: string | null]>(
  "agentQueue/setError",
);

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
  const filtered = messages.filter(
    (message) => !recentlyRemovedMessageIds.includes(message.id),
  );
  return filtered.length === messages.length
    ? messages
    : filtered.map((message, position) => ({ ...message, position }));
}

export const agentQueueReducer = createReducer<AgentQueueState>(initialState)
  .with(hydrateAgentQueueRequested, (state, { payload: [agentId] }) => {
    const current = state.byAgentId[agentId] ?? createEmptyAgentQueueEntry();
    return setAgentQueueEntry(state, agentId, {
      ...current,
      recentlyRemovedMessageIds: current.recentlyRemovedMessageIds ?? [],
      isHydrating: true,
      error: null,
    });
  })
  .with(replaceAgentQueue, (state, { payload: [agentId, messages] }) => {
    const current = state.byAgentId[agentId] ?? createEmptyAgentQueueEntry();
    const recentlyRemovedMessageIds = current.recentlyRemovedMessageIds ?? [];
    const visibleMessages = suppressRecentlyRemovedMessages(
      messages,
      recentlyRemovedMessageIds,
    );
    return setAgentQueueEntry(state, agentId, {
      ...current,
      recentlyRemovedMessageIds,
      messages: createCollection<QueuedMessage, "id">("id", visibleMessages),
      lastSnapshotCount: messages.length,
      isHydrating: false,
      error: null,
    });
  })
  .with(removeQueuedMessageFromAgentQueue, (state, { payload: [agentId, messageId] }) => {
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
      ? createCollection<QueuedMessage, "id">(
          "id",
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
  })
  .with(restoreRecentlyRemovedMessageId, (state, { payload: [agentId, messageId] }) => {
    const current = state.byAgentId[agentId];
    if (!current) return state;
    const currentRecentlyRemovedMessageIds = current.recentlyRemovedMessageIds ?? [];
    if (!currentRecentlyRemovedMessageIds.includes(messageId)) return state;
    return setAgentQueueEntry(state, agentId, {
      ...current,
      recentlyRemovedMessageIds: currentRecentlyRemovedMessageIds.filter(
        (id) => id !== messageId,
      ),
    });
  })
  .with(clearAgentQueue, (state, { payload: [agentId] }) => {
    if (!state.byAgentId[agentId]) return state;
    const remaining = { ...state.byAgentId };
    delete remaining[agentId];
    return { ...state, byAgentId: remaining };
  })
  .with(setAgentQueueHydrating, (state, { payload: [agentId, isHydrating] }) => {
    const current = state.byAgentId[agentId];
    if (!current && !isHydrating) return state;
    return setAgentQueueEntry(state, agentId, {
      ...(current ?? createEmptyAgentQueueEntry()),
      recentlyRemovedMessageIds: current?.recentlyRemovedMessageIds ?? [],
      isHydrating,
      error: isHydrating ? null : (current?.error ?? null),
    });
  })
  .with(setAgentQueueError, (state, { payload: [agentId, error] }) => {
    const current = state.byAgentId[agentId];
    if (!current && error === null) return state;
    return setAgentQueueEntry(state, agentId, {
      ...(current ?? createEmptyAgentQueueEntry()),
      recentlyRemovedMessageIds: current?.recentlyRemovedMessageIds ?? [],
      isHydrating: false,
      error,
    });
  });
