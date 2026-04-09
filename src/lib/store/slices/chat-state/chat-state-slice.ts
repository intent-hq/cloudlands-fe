import { createAction } from '../../utils/create-action';
import { createReducer } from '../../utils/create-reducer';
import type {
  ChatAgentState,
  ChatStateSlice,
  StatusEvent,
  LastAttemptedMessage,
  ModelUnavailableInfo,
  SendMessagePayload,
  InitializeChatOptions,
} from './chat-state-types';

// ============================================================================
// Initial State
// ============================================================================

export const emptyChatAgentState: ChatAgentState = {
  agentId: '',
  isInterrupting: false,
  streamingContent: '',
  error: null,
  lastChunkTime: null,
  receivedFirstChunk: false,
  isStalled: false,
  streamingStartTime: null,
  lastAttemptedMessage: null,
  modelUnavailable: null,
  statusEvents: [],
  trackedWorkspaceId: null,
  isRebinding: false,
  lastMessageTime: 0,
  recentSendKeys: [],
  lastChunkReceivedAt: 0,
};

export const initialState: ChatStateSlice = {
  byAgentId: {},
};

// ============================================================================
// Helpers
// ============================================================================

function getAgent(state: ChatStateSlice, agentId: string): ChatAgentState {
  return state.byAgentId[agentId] ?? emptyChatAgentState;
}

function setAgent(
  state: ChatStateSlice,
  agentId: string,
  agentState: ChatAgentState,
): ChatStateSlice {
  return {
    ...state,
    byAgentId: {
      ...state.byAgentId,
      [agentId]: agentState,
    },
  };
}

function updateAgent(
  state: ChatStateSlice,
  agentId: string,
  partial: Partial<ChatAgentState>,
): ChatStateSlice {
  const current = getAgent(state, agentId);
  return setAgent(state, agentId, { ...current, ...partial });
}

// ============================================================================
// Actions
// ============================================================================

/** Initialize chat session with loaded data (session/messages now live in agent-session slice) */
export const chatInitialized = createAction<
  [agentId: string, payload: {
    isStreaming: boolean;
    streamingContent: string;
    lastAttemptedMessage: LastAttemptedMessage | null;
  }]
>('chatState/initialized');

/** Set error on chat init failure */
export const chatInitFailed = createAction<[agentId: string, error: string]>(
  'chatState/initFailed',
);

/** Begin sending a message — sets processing/streaming flags */
export const chatSendStarted = createAction(
  'chatState/sendStarted',
  (agentId: string, wsId: string) => ({ agentId, wsId, timestamp: Date.now() }),
);

/** Send failed (activation or network error) */
export const chatSendFailed = createAction<[agentId: string, error: string]>(
  'chatState/sendFailed',
);

/** Agent was interrupted — clear streaming without error */
export const chatInterrupted = createAction<[agentId: string]>(
  'chatState/interrupted',
);

/** Clear error and retry-related state before retry */
export const chatRetryCleared = createAction<[agentId: string]>(
  'chatState/retryCleared',
);

/** Clear error + modelUnavailable before model retry */
export const chatModelRetryCleared = createAction<[agentId: string]>(
  'chatState/modelRetryCleared',
);

/** Clear error/retry for smart retry (messages now managed via agent-session slice) */
export const chatSmartRetryPrepared = createAction<
  [agentId: string]
>('chatState/smartRetryPrepared');

/** Set model unavailable info */
export const chatModelUnavailableSet = createAction<
  [agentId: string, info: ModelUnavailableInfo]
>('chatState/modelUnavailableSet');

/** Clear model unavailable info */
export const chatModelUnavailableCleared = createAction<[agentId: string]>(
  'chatState/modelUnavailableCleared',
);

/** Stop completed — clear all streaming/interrupt flags */
export const chatStopCompleted = createAction<[agentId: string]>(
  'chatState/stopCompleted',
);

/** Reset chat to initial empty state (destroy) */
export const chatReset = createAction<[agentId: string]>(
  'chatState/reset',
);

/** Reconcile streaming state when panel remounts */
export const chatStreamingReconciled = createAction(
  'chatState/streamingReconciled',
  (agentId: string) => ({ agentId, timestamp: Date.now() }),
);

// --- Streaming event actions (dispatched by saga from DOM events) ---

/** Stream started event */
export const streamStarted = createAction(
  'chatState/streamStarted',
  (agentId: string, payload: { hasRestoredContent: boolean; existingContent: string }) => ({
    agentId, payload, timestamp: Date.now(),
  }),
);

/** Chunk received — update streaming content via RAF-batched saga (messages now in agent-session) */
export const streamChunkFlushed = createAction<
  [agentId: string, streamingContent: string]
>('chatState/streamChunkFlushed');

/** Record chunk received for stall detection (non-text or text) */
export const streamChunkReceived = createAction(
  'chatState/streamChunkReceived',
  (agentId: string, isTextChunk: boolean) => ({
    agentId, isTextChunk, timestamp: Date.now(),
  }),
);

/** Stream completed — finalize streaming flags (messages now in agent-session) */
export const streamCompleted = createAction<
  [agentId: string, payload: {
    lastAttemptedMessage: LastAttemptedMessage | null;
    modelUnavailable: ModelUnavailableInfo | null;
  }]
>('chatState/streamCompleted');

/** Stream error event (error messages now added via agent-session slice) */
export const streamErrored = createAction<
  [agentId: string, payload: {
    error: string;
  }]
>('chatState/streamErrored');

/** Status event received during streaming */
export const streamStatusReceived = createAction<
  [agentId: string, statusEvent: StatusEvent, resetFirstChunk: boolean]
>('chatState/streamStatusReceived');

/** Stream timed out */
export const streamTimedOut = createAction<[agentId: string]>(
  'chatState/streamTimedOut',
);

/** Stall detected by stall detection saga */
export const chatStallDetected = createAction<[agentId: string]>(
  'chatState/stallDetected',
);

/** State reconciliation: clear stuck processing state */
export const chatStuckStateCleared = createAction<[agentId: string]>(
  'chatState/stuckStateCleared',
);

/** Remove agent chat state on cleanup */
export const chatAgentRemoved = createAction<[agentId: string]>(
  'chatState/agentRemoved',
);

/** Clear error */
export const chatErrorCleared = createAction<[agentId: string]>(
  'chatState/errorCleared',
);

/** Set isInterrupting flag (stop chat in progress) */
export const chatStopInitiated = createAction<[agentId: string]>(
  'chatState/stopInitiated',
);

// --- Rebind tracking actions (managed by component $effect, read by sagas) ---

/** Mark workspace rebind as started (async initializeChat in flight) */
export const chatRebindStarted = createAction<[agentId: string]>(
  'chatState/rebindStarted',
);

/** Mark workspace rebind as completed and record the tracked workspace ID */
export const chatRebindEnded = createAction<[agentId: string]>(
  'chatState/rebindEnded',
);

/** Update tracked workspace ID (e.g. after recordMount or recordRebind) */
export const chatTrackedWorkspaceSet = createAction<[agentId: string, trackedWsId: string | null]>(
  'chatState/trackedWorkspaceSet',
);

// --- Rate limiting actions ---

/** Add a send key for idempotency deduplication */
export const addSendKey = createAction<[agentId: string, key: string]>(
  'chatState/addSendKey',
);

/** Remove a send key after TTL expiry */
export const removeSendKey = createAction<[agentId: string, key: string]>(
  'chatState/removeSendKey',
);

/** Clear all send keys and reset lastMessageTime (stream completion/error) */
export const clearSendKeys = createAction<[agentId: string]>(
  'chatState/clearSendKeys',
);

// --- Initialize chat saga trigger (no reducer state change) ---

/** Trigger the initialize-chat saga. Dispatched from ChatPanel to start chat initialization. */
export const initializeChatRequested = createAction(
  'chatState/initializeChatRequested',
  (agentId: string, payload: { wsId: string; options?: InitializeChatOptions }) => ({ agentId, ...payload }),
);

// --- Send message saga trigger (no reducer state change) ---

/** Trigger the send-message saga. Dispatched from ChatPanel after DOM serialization. */
export const sendMessage = createAction(
  'chatState/sendMessage',
  (agentId: string, payload: SendMessagePayload & { wsId: string }) => ({ agentId, payload }),
);

// --- Stream lifecycle saga triggers (no reducer state change) ---

/** Request stream cleanup for a session. Handled by chat-stream-saga. */
export const cleanupStreamRequested = createAction<[sessionId: string, preserveContent: boolean]>(
  'chatState/cleanupStreamRequested',
);


// ============================================================================
// Reducer
// ============================================================================

export const chatStateReducer = createReducer<ChatStateSlice>(initialState)
  .with(chatInitialized, (state, { payload: [agentId, data] }) =>
    updateAgent(state, agentId, {
      agentId,
      streamingContent: data.streamingContent,
      error: null,
      lastAttemptedMessage: data.lastAttemptedMessage,
    }),
  )
  .with(chatInitFailed, (state, { payload: [agentId, error] }) =>
    updateAgent(state, agentId, { error }),
  )
  .with(chatSendStarted, (state, { payload: { agentId, timestamp } }) =>
    updateAgent(state, agentId, {
      streamingContent: '',
      error: null,
      streamingStartTime: timestamp,
      lastChunkTime: null,
      receivedFirstChunk: false,
      isStalled: false,
      statusEvents: [],
    }),
  )
  .with(chatSendFailed, (state, { payload: [agentId, error] }) =>
    updateAgent(state, agentId, {
      streamingStartTime: null,
      error,
    }),
  )
  .with(chatInterrupted, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, {
      streamingStartTime: null,
    }),
  )
  .with(chatRetryCleared, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, { error: null, lastAttemptedMessage: null }),
  )
  .with(chatModelRetryCleared, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, { error: null, modelUnavailable: null, lastAttemptedMessage: null }),
  )
  .with(chatSmartRetryPrepared, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, {
      error: null,
      modelUnavailable: null,
      lastAttemptedMessage: null,
    }),
  )
  .with(chatModelUnavailableSet, (state, { payload: [agentId, info] }) =>
    updateAgent(state, agentId, { modelUnavailable: info }),
  )
  .with(chatModelUnavailableCleared, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, { modelUnavailable: null }),
  )
  .with(chatErrorCleared, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, { error: null }),
  )
  .with(chatStopInitiated, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, { isInterrupting: true }),
  )
  .with(chatStopCompleted, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, {
      isInterrupting: false,
      streamingContent: '',
      streamingStartTime: null,
    }),
  )
  .with(chatReset, (state, { payload: [agentId] }) =>
    setAgent(state, agentId, { ...emptyChatAgentState }),
  )
  .with(chatStreamingReconciled, (state, { payload: { agentId, timestamp } }) => {
    const agent = getAgent(state, agentId);
    // Only update the streamingStartTime (isProcessing/isStreaming are on agent-session now)
    if (!agent.streamingStartTime) {
      return updateAgent(state, agentId, {
        streamingStartTime: timestamp,
      });
    }
    return state;
  })
  .with(streamStarted, (state, { payload: { agentId, payload: data, timestamp } }) =>
    updateAgent(state, agentId, {
      streamingContent: data.hasRestoredContent ? data.existingContent : '',
      error: null,
      lastChunkTime: timestamp,
      isStalled: false,
    }),
  )
  .with(streamChunkFlushed, (state, { payload: [agentId, streamingContent] }) =>
    updateAgent(state, agentId, { streamingContent }),
  )
  .with(streamChunkReceived, (state, { payload: { agentId, isTextChunk, timestamp } }) => {
    if (!isTextChunk) {
      return updateAgent(state, agentId, { lastChunkTime: timestamp, isStalled: false, lastChunkReceivedAt: timestamp });
    }
    const agent = getAgent(state, agentId);
    return updateAgent(state, agentId, {
      lastChunkTime: timestamp,
      isStalled: false,
      receivedFirstChunk: true,
      lastChunkReceivedAt: timestamp,
      statusEvents: !agent.receivedFirstChunk
        ? [...agent.statusEvents, {
            phase: 'streaming',
            message: 'Streaming response…',
            level: 'info' as const,
            timestamp,
          }]
        : agent.statusEvents,
    });
  })
  .with(streamCompleted, (state, { payload: [agentId, data] }) =>
    updateAgent(state, agentId, {
      streamingContent: '',
      streamingStartTime: null,
      lastChunkTime: null,
      receivedFirstChunk: false,
      isStalled: false,
      statusEvents: [],
      lastAttemptedMessage: data.lastAttemptedMessage,
      modelUnavailable: data.modelUnavailable,
    }),
  )
  .with(streamErrored, (state, { payload: [agentId, data] }) =>
    updateAgent(state, agentId, {
      streamingContent: '',
      streamingStartTime: null,
      statusEvents: [],
      error: data.error,
    }),
  )
  .with(streamStatusReceived, (state, { payload: [agentId, statusEvent, resetFirstChunk] }) => {
    const agent = getAgent(state, agentId);
    return updateAgent(state, agentId, {
      statusEvents: [...agent.statusEvents, statusEvent],
      receivedFirstChunk: resetFirstChunk ? false : agent.receivedFirstChunk,
    });
  })
  .with(streamTimedOut, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, {
      streamingStartTime: null,
    }),
  )
  .with(chatStallDetected, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, { isStalled: true }),
  )
  .with(chatStuckStateCleared, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, {
      isStalled: false,
      streamingStartTime: null,
      lastChunkTime: null,
      receivedFirstChunk: false,
    }),
  )
  .with(chatRebindStarted, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, { isRebinding: true }),
  )
  .with(chatRebindEnded, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, { isRebinding: false }),
  )
  .with(chatTrackedWorkspaceSet, (state, { payload: [agentId, trackedWsId] }) =>
    updateAgent(state, agentId, { trackedWorkspaceId: trackedWsId }),
  )
  .with(chatAgentRemoved, (state, { payload: [agentId] }) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [agentId]: _, ...restAgents } = state.byAgentId;
    return { ...state, byAgentId: restAgents };
  })
  .with(addSendKey, (state, { payload: [agentId, key] }) => {
    const agent = getAgent(state, agentId);
    if (agent.recentSendKeys.includes(key)) return state;
    return updateAgent(state, agentId, {
      recentSendKeys: [...agent.recentSendKeys, key],
    });
  })
  .with(removeSendKey, (state, { payload: [agentId, key] }) => {
    const agent = getAgent(state, agentId);
    const filtered = agent.recentSendKeys.filter((k) => k !== key);
    if (filtered.length === agent.recentSendKeys.length) return state;
    return updateAgent(state, agentId, { recentSendKeys: filtered });
  })
  .with(clearSendKeys, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, { recentSendKeys: [] }),
  );