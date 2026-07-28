import { createAction } from '$lib/store-shim/utils/store/create-action';
import { createReducer } from '$lib/store-shim/utils/store/create-reducer';
import type {
  ChatAgentState,
  ChatStateSlice,
  StatusEvent,
  LastAttemptedMessage,
  ModelUnavailableInfo,
  SendMessagePayload,
  InitializeChatOptions,
  StreamStatusContext,
} from './chat-state-types';
import { sanitizeStatusEvent } from './chat-state-serialization';
import {
  agentStreamUpdateReceived,
  type AgentStreamUpdatePayload,
} from '../workspace-agents/workspace-agents-stream-slice';
import { workspaceDeleted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import { m } from '$shared/paraglide/messages.js';

// ============================================================================
// Initial State
// ============================================================================

export const emptyChatAgentState: ChatAgentState = {
  agentId: '',
  isInterrupting: false,
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
  lastChunkReceivedAt: 0,
  idleReconcileSuppressed: false,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getModelUnavailableInfo(value: unknown): ModelUnavailableInfo | null {
  if (!isRecord(value) || !isRecord(value.metadata)) return null;
  const { metadata } = value;
  if (metadata.modelUnavailable !== true || typeof metadata.nextAvailableModel !== 'string') {
    return null;
  }
  return {
    failedModel: typeof metadata.failedModel === 'string' ? metadata.failedModel : '',
    nextAvailableModel: metadata.nextAvailableModel,
  };
}

function getStreamFailureMessage(payload: AgentStreamUpdatePayload): string | null {
  if (payload.error) return payload.error;
  if (payload.eventType === 'timeout' || payload.finishReason === 'timeout') {
    return m.chat_state_timeout_error();
  }
  return null;
}

function reduceChunkReceived(
  state: ChatStateSlice,
  agentId: string,
  isTextChunk: boolean,
  timestamp: number,
): ChatStateSlice {
  if (!isTextChunk) {
    return updateAgent(state, agentId, {
      lastChunkTime: timestamp,
      isStalled: false,
      lastChunkReceivedAt: timestamp,
    });
  }

  const agent = getAgent(state, agentId);
  return updateAgent(state, agentId, {
    lastChunkTime: timestamp,
    isStalled: false,
    receivedFirstChunk: true,
    lastChunkReceivedAt: timestamp,
    statusEvents: !agent.receivedFirstChunk
      ? [
          ...agent.statusEvents,
          {
            phase: 'streaming',
            message: m.chat_state_streaming_status(),
            level: 'info' as const,
            timestamp,
          },
        ]
      : agent.statusEvents,
  });
}

function reduceAgentStreamUpdate(
  state: ChatStateSlice,
  payload: AgentStreamUpdatePayload,
): ChatStateSlice {
  const timestamp = payload.timestamp ?? 0;
  if (payload.eventType === 'started') {
    return updateAgent(state, payload.agentId, {
      error: null,
      modelUnavailable: null,
      lastChunkTime: timestamp,
      receivedFirstChunk: false,
      isStalled: false,
      statusEvents: [],
    });
  }
  if (payload.eventType === 'chunk') {
    return reduceChunkReceived(state, payload.agentId, true, timestamp);
  }
  if (payload.eventType === 'content-blocks') {
    return reduceChunkReceived(state, payload.agentId, false, timestamp);
  }
  if (payload.eventType === 'complete' || payload.eventType === 'timeout') {
    const failureMessage = getStreamFailureMessage(payload);
    return updateAgent(state, payload.agentId, {
      streamingStartTime: null,
      lastChunkTime: null,
      receivedFirstChunk: false,
      isStalled: false,
      statusEvents: [],
      lastAttemptedMessage: null,
      modelUnavailable: getModelUnavailableInfo(payload.completeMessage),
      error: failureMessage,
    });
  }
  if (payload.eventType === 'error') {
    return updateAgent(state, payload.agentId, {
      streamingStartTime: null,
      statusEvents: [],
      modelUnavailable: null,
      error: getStreamFailureMessage(payload) || m.chat_state_interrupted_error(),
    });
  }
  return state;
}

// ============================================================================
// Actions
// ============================================================================

/** Initialize chat session with loaded data (session/messages now live in agent-session slice) */
export const chatInitialized = createAction<
  [
    agentId: string,
    payload: {
      isStreaming: boolean;
      lastAttemptedMessage: LastAttemptedMessage | null;
    },
  ]
>('chatState/initialized');

/** Set error on chat init failure */
export const chatInitFailed =
  createAction<[agentId: string, error: string]>('chatState/initFailed');

/** Begin sending a message — sets processing/streaming flags */
export const chatSendStarted = createAction(
  'chatState/sendStarted',
  (agentId: string, wsId?: string, timestamp = Date.now()) => ({
    agentId,
    wsId,
    timestamp,
    timestampIso: new Date(timestamp).toISOString(),
  }),
);

/**
 * Set the idle-reconcile suppression marker. Dispatched true by
 * handleQueueProcessing right after chatSendStarted (a queued turn began, so
 * the prior turn's incoming `agent:idle` must not clear the fresh flags) and
 * false by handleAgentIdle once it has consumed the marker.
 */
export const chatIdleReconcileSuppressionSet = createAction<[agentId: string, suppressed: boolean]>(
  'chatState/idleReconcileSuppressionSet',
);

/** Send failed (activation or network error) */
export const chatSendFailed =
  createAction<[agentId: string, error: string]>('chatState/sendFailed');

/** Agent was interrupted — clear streaming without error */
export const chatInterrupted = createAction<[agentId: string]>('chatState/interrupted');

/** Clear model unavailable info */
export const chatModelUnavailableCleared = createAction<[agentId: string]>(
  'chatState/modelUnavailableCleared',
);

/** Stop completed — clear all streaming/interrupt flags */
export const chatStopCompleted = createAction<[agentId: string]>('chatState/stopCompleted');

/** Reset chat to initial empty state (destroy) */
export const chatReset = createAction<[agentId: string]>('chatState/reset');

/** Reconcile streaming state when panel remounts */
export const chatStreamingReconciled = createAction(
  'chatState/streamingReconciled',
  (agentId: string) => ({ agentId, timestamp: Date.now() }),
);

// --- Streaming event actions ---

/** Stream completed — finalize streaming flags (messages now in agent-session) */
export const streamCompleted = createAction<
  [
    agentId: string,
    payload: {
      lastAttemptedMessage: LastAttemptedMessage | null;
      modelUnavailable: ModelUnavailableInfo | null;
    },
  ]
>('chatState/streamCompleted');

/** Status event received during streaming */
export const streamStatusReceived = createAction(
  'chatState/streamStatusReceived',
  (
    agentId: string,
    statusEvent: unknown,
    resetFirstChunk: boolean,
    context?: StreamStatusContext,
  ): [string, StatusEvent, boolean, StreamStatusContext?] => [
    agentId,
    sanitizeStatusEvent(statusEvent, Date.now()),
    resetFirstChunk,
    context,
  ],
);

/** Restore status events persisted by chat-state sagas during initialization */
export const chatStatusEventsHydrated = createAction<
  [agentId: string, statusEvents: StatusEvent[]]
>('chatState/statusEventsHydrated');

/** Stream timed out */
export const streamTimedOut = createAction<[agentId: string]>('chatState/streamTimedOut');

/** Stall detected by stall detection saga */
export const chatStallDetected = createAction<[agentId: string]>('chatState/stallDetected');

/** State reconciliation: clear stuck processing state */
export const chatStuckStateCleared = createAction<[agentId: string]>('chatState/stuckStateCleared');

/** Clear error */
export const chatErrorCleared = createAction<[agentId: string]>('chatState/errorCleared');

/** Set isInterrupting flag (stop chat in progress) */
export const chatStopInitiated = createAction<[agentId: string]>('chatState/stopInitiated');

// --- Rebind tracking actions (managed by component $effect, read by sagas) ---

/** Mark workspace rebind as started (async initializeChat in flight) */
export const chatRebindStarted = createAction<[agentId: string]>('chatState/rebindStarted');

/** Mark workspace rebind as completed and record the tracked workspace ID */
export const chatRebindEnded = createAction<[agentId: string]>('chatState/rebindEnded');

/** Update tracked workspace ID (e.g. after recordMount or recordRebind) */
export const chatTrackedWorkspaceSet = createAction<[agentId: string, trackedWsId: string | null]>(
  'chatState/trackedWorkspaceSet',
);

// --- Transcript hydration tracking actions ---

/** Transcript load started for an agent */
export const transcriptHydrationStarted = createAction<[agentId: string]>(
  'chatState/transcriptHydrationStarted',
);

/** Transcript load completed (success or error) for an agent */
export const transcriptHydrationSettled = createAction<[agentId: string]>(
  'chatState/transcriptHydrationSettled',
);

// --- Initialize chat saga trigger (no reducer state change) ---

/** Trigger the initialize-chat saga. Dispatched from ChatPanel to start chat initialization. */
export const initializeChatRequested = createAction(
  'chatState/initializeChatRequested',
  (agentId: string, payload: { wsId: string; options?: InitializeChatOptions }) => ({
    agentId,
    ...payload,
  }),
);

// --- Send message saga trigger (no reducer state change) ---

/** Trigger the send-message saga. Dispatched from ChatPanel after DOM serialization. */
export const sendMessage = createAction(
  'chatState/sendMessage',
  (agentId: string, payload: SendMessagePayload & { wsId: string }) => ({ agentId, payload }),
);

// ============================================================================
// Reducer
// ============================================================================

export const chatStateReducer = createReducer<ChatStateSlice>(initialState)
  .with(chatInitialized, (state, { payload: [agentId, data] }) =>
    updateAgent(state, agentId, {
      agentId,
      error: null,
      lastAttemptedMessage: data.lastAttemptedMessage,
    }),
  )
  .with(chatInitFailed, (state, { payload: [agentId, error] }) =>
    updateAgent(state, agentId, { error, modelUnavailable: null }),
  )
  .with(chatSendStarted, (state, { payload: { agentId, timestamp } }) =>
    updateAgent(state, agentId, {
      error: null,
      modelUnavailable: null,
      streamingStartTime: timestamp,
      lastMessageTime: timestamp,
      lastChunkTime: null,
      receivedFirstChunk: false,
      isStalled: false,
      statusEvents: [],
      idleReconcileSuppressed: false,
    }),
  )
  .with(chatIdleReconcileSuppressionSet, (state, { payload: [agentId, suppressed] }) =>
    updateAgent(state, agentId, { idleReconcileSuppressed: suppressed }),
  )
  .with(chatSendFailed, (state, { payload: [agentId, error] }) =>
    updateAgent(state, agentId, {
      streamingStartTime: null,
      error,
      modelUnavailable: null,
      idleReconcileSuppressed: false,
    }),
  )
  .with(chatInterrupted, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, {
      streamingStartTime: null,
      idleReconcileSuppressed: false,
    }),
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
      streamingStartTime: null,
      idleReconcileSuppressed: false,
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
  .with(agentStreamUpdateReceived, (state, { payload: [payload] }) =>
    reduceAgentStreamUpdate(state, payload),
  )
  .with(streamCompleted, (state, { payload: [agentId, data] }) =>
    updateAgent(state, agentId, {
      streamingStartTime: null,
      lastChunkTime: null,
      receivedFirstChunk: false,
      isStalled: false,
      statusEvents: [],
      lastAttemptedMessage: data.lastAttemptedMessage,
      modelUnavailable: data.modelUnavailable,
      idleReconcileSuppressed: false,
    }),
  )
  .with(streamStatusReceived, (state, { payload: [agentId, statusEvent, resetFirstChunk] }) => {
    const agent = getAgent(state, agentId);
    return updateAgent(state, agentId, {
      statusEvents: [...agent.statusEvents, sanitizeStatusEvent(statusEvent)],
      receivedFirstChunk: resetFirstChunk ? false : agent.receivedFirstChunk,
    });
  })
  .with(chatStatusEventsHydrated, (state, { payload: [agentId, statusEvents] }) =>
    updateAgent(state, agentId, {
      agentId,
      statusEvents,
    }),
  )
  .with(streamTimedOut, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, {
      streamingStartTime: null,
      error: m.chat_state_timeout_error(),
      idleReconcileSuppressed: false,
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
      idleReconcileSuppressed: false,
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
  .with(transcriptHydrationStarted, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, { agentId, transcriptHydration: 'loading' }),
  )
  .with(transcriptHydrationSettled, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, { agentId, transcriptHydration: 'settled' }),
  )
  .with(workspaceDeleted, (state, { payload: [, agentIds] }) => {
    if (agentIds.length === 0) return state;
    let changed = false;
    const byAgentId: Record<string, ChatAgentState> = { ...state.byAgentId };
    for (const agentId of agentIds) {
      if (agentId in byAgentId) {
        delete byAgentId[agentId];
        changed = true;
      }
    }
    return changed ? { ...state, byAgentId } : state;
  });
