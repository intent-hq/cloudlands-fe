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
import { eventReceived } from '../workspace-events/workspace-events-slice';

// ============================================================================
// Initial State
// ============================================================================

export const emptyChatAgentState: ChatAgentState = {
  agentId: '',
  isInterrupting: false,
  error: null,
  lastChunkTime: null,
  receivedFirstChunk: false,
  streamingStartTime: null,
  lastAttemptedMessage: null,
  modelUnavailable: null,
  statusEvents: [],
  trackedWorkspaceId: null,
  isRebinding: false,
  lastMessageTime: 0,
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

/**
 * Preserve-on-failure predicate for the `agent:idle` reconcile finalize path
 * (#973), mirroring the clear-on-success semantics of the observed terminal
 * `complete` event (see reduceAgentStreamUpdate: cleared unless failureMessage
 * || modelUnavailable). A reconcile cannot observe how the missed turn ended, so
 * it reads the persisted flags instead: `error` set means the failure banner
 * is visible and its "Try again" still needs the record (#941); `modelUnavailable`
 * set means a "Retry with <model>" banner is pending (#964). Those two banners
 * are the record's only consumers — with neither flag set no UI can reach it,
 * so clearing is safe even if the missed turn actually failed (that failure
 * was missed too, so no banner is showing).
 */
function shouldPreserveLastAttemptedMessage(agent: ChatAgentState): boolean {
  return agent.error !== null || agent.modelUnavailable !== null;
}

/**
 * Finalize via `agent:idle` reconcile (#973): when the terminal stream
 * `complete` event was missed (window reload mid-turn, dropped subscription),
 * the successful turn is reconciled through `agent:idle` instead — previously
 * the only path that never cleared `lastAttemptedMessage`, leaving a
 * potentially MB-scale base64 payload (imageBlocks, #965) resident for the
 * app session.
 */
function reduceAgentIdleReconcile(state: ChatStateSlice, agentId: string): ChatStateSlice {
  const agent = state.byAgentId[agentId];
  // agent:idle fires for every agent in subscribed workspaces; never
  // materialize a chat-state entry for a chat that was never opened.
  // NOTE: no queued-turn suppression is needed here — the daemon withholds
  // `agent:idle` while ready-to-send messages remain queued (#969), so an
  // observed idle always belongs to the finished turn.
  if (!agent) return state;
  if (agent.lastAttemptedMessage === null || shouldPreserveLastAttemptedMessage(agent)) {
    return state;
  }
  return updateAgent(state, agentId, { lastAttemptedMessage: null });
}

function getStreamFailureMessage(payload: AgentStreamUpdatePayload): string | null {
  if (payload.error) return payload.error;
  if (payload.eventType === 'timeout' || payload.finishReason === 'timeout') {
    return 'The agent response timed out before it finished. Try again or check the provider status.';
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
      lastChunkReceivedAt: timestamp,
    });
  }

  const agent = getAgent(state, agentId);
  return updateAgent(state, agentId, {
    lastChunkTime: timestamp,
    receivedFirstChunk: true,
    lastChunkReceivedAt: timestamp,
    statusEvents: !agent.receivedFirstChunk
      ? [
          ...agent.statusEvents,
          {
            phase: 'streaming',
            message: 'Streaming response…',
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
    const modelUnavailable = getModelUnavailableInfo(payload.completeMessage);
    return updateAgent(state, payload.agentId, {
      streamingStartTime: null,
      lastChunkTime: null,
      receivedFirstChunk: false,
      statusEvents: [],
      // Preserve the retry payload when the turn FAILED so the error
      // banner's "Try again" can resend it (#941), and when the turn ended
      // model-unavailable so "Retry with <model>" has a message to resend
      // (#964); clear it only on a genuinely successful completion.
      lastAttemptedMessage: failureMessage || modelUnavailable
        ? getAgent(state, payload.agentId).lastAttemptedMessage
        : null,
      modelUnavailable,
      error: failureMessage,
    });
  }
  if (payload.eventType === 'error') {
    return updateAgent(state, payload.agentId, {
      streamingStartTime: null,
      statusEvents: [],
      modelUnavailable: null,
      error: getStreamFailureMessage(payload) || 'The response was interrupted. Please try again.',
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
 * Record the exact message content a send attempt carried so the error
 * banner's "Try again" can resend it verbatim (#941). Dispatched by the
 * send paths (chat-send-service, edit-regenerate-service) alongside
 * `chatSendStarted`.
 */
export const chatLastAttemptedMessageSet = createAction<
  [agentId: string, lastAttemptedMessage: LastAttemptedMessage | null]
>('chatState/lastAttemptedMessageSet');

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
      statusEvents: [],
    }),
  )
  .with(chatLastAttemptedMessageSet, (state, { payload: [agentId, lastAttemptedMessage] }) =>
    updateAgent(state, agentId, { lastAttemptedMessage }),
  )
  .with(chatSendFailed, (state, { payload: [agentId, error] }) =>
    updateAgent(state, agentId, {
      streamingStartTime: null,
      error,
      modelUnavailable: null,
    }),
  )
  .with(chatInterrupted, (state, { payload: [agentId] }) =>
    updateAgent(state, agentId, {
      streamingStartTime: null,
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
      statusEvents: [],
      lastAttemptedMessage: data.lastAttemptedMessage,
      modelUnavailable: data.modelUnavailable,
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
      error: 'The agent response timed out before it finished. Try again or check the provider status.',
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
  .with(eventReceived, (state, { payload: [, event] }) => {
    if (event.type !== 'agent:idle') return state;
    const data: unknown = event.data;
    if (!isRecord(data)) return state;
    // PROTOCOL.md: agent:idle always carries data.agentId.
    const agentId = data.agentId;
    if (typeof agentId !== 'string' || agentId.length === 0) return state;
    return reduceAgentIdleReconcile(state, agentId);
  })
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
