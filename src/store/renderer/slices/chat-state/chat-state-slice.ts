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
  TurnRetryRecord,
} from './chat-state-types';
import { sanitizeStatusEvent } from './chat-state-serialization';
import {
  agentStreamUpdateReceived,
  type AgentStreamUpdatePayload,
} from '../workspace-agents/workspace-agents-stream-slice';
import { workspaceDeleted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import { eventReceived } from '../workspace-events/workspace-events-slice';
import {
  replaceAgentQueue,
  removeQueuedMessageFromAgentQueue,
} from '../agent-queue/agent-queue-slice';

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
  lastAttemptedTurnKey: null,
  turnRetryRecords: [],
  modelUnavailable: null,
  statusEvents: [],
  trackedWorkspaceId: null,
  isRebinding: false,
  lastMessageTime: 0,
  lastChunkReceivedAt: 0,
};

/**
 * Bounded turn-record cap (#999): enqueue-mode records append FIFO; anything
 * beyond this is dropped oldest-first. Generously above the daemon's
 * practical queue depth — the cap only guards against a pathological leak.
 */
const MAX_TURN_RETRY_RECORDS = 20;

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
 * Finalize via `agent:idle` reconcile (#973/#999): when the terminal stream
 * `complete` event was missed (window reload mid-turn, dropped subscription),
 * the successful turn is reconciled through `agent:idle` instead — previously
 * the only path that never cleared `lastAttemptedMessage`, leaving a
 * potentially MB-scale base64 payload (imageBlocks, #965) resident for the
 * app session.
 *
 * Turn-scoping (#999): idle finalizes only turns whose stream was OBSERVED to
 * start ('streaming'/'ended' records). 'pending' records survive — they cover
 * the delayed-idle race where idle-N is still in transit when turn N+1's send
 * is dispatched: N+1's record has not seen its `started` yet, so a late
 * idle-N must not clear it. The banner pointer clears only when the turn it
 * belongs to is finalized here (or, for legacy null-turnKey records —
 * hydration, enqueue-failure banners, edit-regenerate — under the pre-#999
 * rule).
 */
function reduceAgentIdleReconcile(state: ChatStateSlice, agentId: string): ChatStateSlice {
  const agent = state.byAgentId[agentId];
  // agent:idle fires for every agent in subscribed workspaces; never
  // materialize a chat-state entry for a chat that was never opened.
  // NOTE: no queued-turn suppression is needed here — the daemon withholds
  // `agent:idle` while ready-to-send messages remain queued (#969), so an
  // observed idle always belongs to the finished turn.
  if (!agent) return state;
  const preserve = shouldPreserveLastAttemptedMessage(agent);
  const keptRecords = agent.turnRetryRecords.filter(
    (record) =>
      record.phase === 'pending' ||
      (preserve && record.turnKey === agent.lastAttemptedTurnKey),
  );
  const recordsChanged = keptRecords.length !== agent.turnRetryRecords.length;

  let clearPointer = false;
  if (agent.lastAttemptedMessage !== null && !preserve) {
    clearPointer =
      agent.lastAttemptedTurnKey === null ||
      !keptRecords.some((record) => record.turnKey === agent.lastAttemptedTurnKey);
  }
  if (!recordsChanged && !clearPointer) return state;
  return updateAgent(state, agentId, {
    ...(recordsChanged ? { turnRetryRecords: keptRecords } : {}),
    ...(clearPointer ? { lastAttemptedMessage: null, lastAttemptedTurnKey: null } : {}),
  });
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

/**
 * Turn promotion on stream `started` (#999): the daemon starts turns FIFO
 * (direct send, or queue drain), so an observed `started` belongs to the
 * OLDEST pending record. Promote it — mark it 'streaming', correlate the
 * assistant messageId, and move the banner pointer (`lastAttemptedMessage` /
 * `lastAttemptedTurnKey`) to its payload so a subsequent failure banner
 * retries THIS turn. Records from previous turns ('streaming'/'ended') are
 * dropped — their turns are over and the pointer has moved on. With no
 * pending record (harness wake, turn queued before this window opened) the
 * pointer is left untouched.
 *
 * Known approximation: a harness-driven wake that starts while user messages
 * are still queued is attributed to the oldest queued record; the daemon
 * carries no turn correlation on `agent:stream:start` beyond messageId, which
 * the client cannot pair with a QueuedMessage.
 */
function promoteOldestPendingRecord(
  agent: ChatAgentState,
  assistantMessageId: string | undefined,
): Partial<ChatAgentState> {
  const pendingIndex = agent.turnRetryRecords.findIndex((record) => record.phase === 'pending');
  if (pendingIndex === -1) return {};
  const promoted: TurnRetryRecord = {
    ...agent.turnRetryRecords[pendingIndex],
    phase: 'streaming',
    ...(assistantMessageId ? { messageId: assistantMessageId } : {}),
  };
  return {
    turnRetryRecords: [
      promoted,
      ...agent.turnRetryRecords.filter(
        (record, index) => index !== pendingIndex && record.phase === 'pending',
      ),
    ],
    lastAttemptedMessage: promoted.attempt,
    lastAttemptedTurnKey: promoted.turnKey,
  };
}

/** Mark every 'streaming' record 'ended' when a terminal stream event lands (#999). */
function endStreamingRecords(agent: ChatAgentState): TurnRetryRecord[] {
  if (!agent.turnRetryRecords.some((record) => record.phase === 'streaming')) {
    return agent.turnRetryRecords;
  }
  return agent.turnRetryRecords.map((record) =>
    record.phase === 'streaming' ? { ...record, phase: 'ended' as const } : record,
  );
}

function reduceAgentStreamUpdate(
  state: ChatStateSlice,
  payload: AgentStreamUpdatePayload,
): ChatStateSlice {
  const timestamp = payload.timestamp ?? 0;
  if (payload.eventType === 'started') {
    const agent = getAgent(state, payload.agentId);
    return updateAgent(state, payload.agentId, {
      error: null,
      modelUnavailable: null,
      lastChunkTime: timestamp,
      receivedFirstChunk: false,
      statusEvents: [],
      ...promoteOldestPendingRecord(agent, payload.assistantMessageId),
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
    const agent = getAgent(state, payload.agentId);
    // This terminal maps the daemon's `agent:stream:end`, which is
    // disposition-NEUTRAL (PROTOCOL §7: the complete/error payloads are
    // identical by design) — a failed turn ends its stream the same way and
    // only the follow-up lifecycle event carries the disposition
    // (`agent:idle` on success, `agent:failed` on error). Clearing the
    // retry payload here therefore raced ahead of the failure banner and
    // left "Try again" a no-op (#984). Preserve the record and defer the
    // success-clear to the `agent:idle` finalize (reduceAgentIdleReconcile,
    // whose error/modelUnavailable guards keep the #941/#964 preserve-on-
    // failure semantics); the turn's record flips to 'ended' so that
    // finalize can tell it apart from a not-yet-started turn (#999). The one
    // disposition this event DOES carry is the user interrupt
    // (`stopReason: "interrupted"`, §7.2) — clear the abandoned payload
    // inline here (#965), because the synthetic post-interrupt `agent:idle`
    // (agent_manager.rs interrupt_inner, STAB-28) is SUPPRESSED when a
    // ready-to-send queue exists or the interrupt carries a message, so the
    // idle finalize can't be relied on. When the synthetic idle does arrive,
    // its reconcile is a harmless no-op on the already-cleared record.
    // Pending (queued) records survive an interrupt — the daemon keeps
    // draining the queue afterwards.
    const interrupted =
      !failureMessage && !modelUnavailable && payload.stopReason === 'interrupted';
    return updateAgent(state, payload.agentId, {
      streamingStartTime: null,
      lastChunkTime: null,
      receivedFirstChunk: false,
      statusEvents: [],
      lastAttemptedMessage: interrupted ? null : agent.lastAttemptedMessage,
      lastAttemptedTurnKey: interrupted ? null : agent.lastAttemptedTurnKey,
      turnRetryRecords: interrupted
        ? agent.turnRetryRecords.filter((record) => record.phase === 'pending')
        : endStreamingRecords(agent),
      modelUnavailable,
      error: failureMessage,
    });
  }
  if (payload.eventType === 'error') {
    const agent = getAgent(state, payload.agentId);
    return updateAgent(state, payload.agentId, {
      streamingStartTime: null,
      statusEvents: [],
      modelUnavailable: null,
      turnRetryRecords: endStreamingRecords(agent),
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
 * `chatSendStarted`. Sets the banner pointer WITHOUT turn-scoping
 * (`lastAttemptedTurnKey: null`) — the legacy/unscoped mode used by
 * hydration, edit-regenerate, and enqueue-failure banners; turn-scoped
 * attempts go through `chatTurnAttemptRecorded` (#999).
 */
export const chatLastAttemptedMessageSet = createAction<
  [agentId: string, lastAttemptedMessage: LastAttemptedMessage | null]
>('chatState/lastAttemptedMessageSet');

/**
 * Record a turn-scoped send/enqueue attempt (#999). `mode: 'send'` is the
 * direct (agent-idle) path: previous turns are over, so the records reset to
 * this single pending record and the banner pointer moves to it. `mode:
 * 'enqueue'` is the queue-on-send path: the record is APPENDED (FIFO,
 * bounded) and the banner pointer is left alone — the in-flight turn still
 * owns it; the stream `started` of this turn's eventual drain moves the
 * pointer here (promoteOldestPendingRecord).
 */
export const chatTurnAttemptRecorded = createAction<
  [
    agentId: string,
    record: {
      turnKey: string;
      attempt: LastAttemptedMessage;
      mode: 'send' | 'enqueue';
      queuedMessageId?: string;
    },
  ]
>('chatState/turnAttemptRecorded');

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
      // Hydrated records predate this window's turn keys (#999): unscoped.
      lastAttemptedTurnKey: null,
      turnRetryRecords: [],
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
    // Unscoped pointer set (#999): the payload has no turn key, so any prior
    // scoping no longer describes it.
    updateAgent(state, agentId, { lastAttemptedMessage, lastAttemptedTurnKey: null }),
  )
  .with(chatTurnAttemptRecorded, (state, { payload: [agentId, record] }) => {
    const agent = getAgent(state, agentId);
    const fresh: TurnRetryRecord = {
      turnKey: record.turnKey,
      attempt: record.attempt,
      phase: 'pending',
      ...(record.queuedMessageId !== undefined
        ? { queuedMessageId: record.queuedMessageId }
        : {}),
    };
    if (record.mode === 'send') {
      // Direct send: the agent was idle, so previous turns are over — reset
      // to this single pending record and move the banner pointer to it.
      return updateAgent(state, agentId, {
        turnRetryRecords: [fresh],
        lastAttemptedMessage: record.attempt,
        lastAttemptedTurnKey: record.turnKey,
      });
    }
    // Enqueue: append FIFO (bounded) WITHOUT touching the banner pointer —
    // the in-flight turn still owns it (#969); this record is promoted when
    // its drain's stream `started` is observed.
    const appended = [...agent.turnRetryRecords, fresh];
    return updateAgent(state, agentId, {
      turnRetryRecords:
        appended.length > MAX_TURN_RETRY_RECORDS
          ? appended.slice(appended.length - MAX_TURN_RETRY_RECORDS)
          : appended,
    });
  })
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
      // Keep the turn key paired with its payload (#999): a null passthrough
      // clears the scoping too; a non-null passthrough echoes post-reducer
      // state, so the resident key still describes it.
      ...(data.lastAttemptedMessage === null ? { lastAttemptedTurnKey: null } : {}),
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
  .with(replaceAgentQueue, (state, { payload: [agentId, messages] }) => {
    // Dequeue correlation (#999): `agent:queue:updated` carries the CURRENT
    // queue snapshot (§6.5) — a pending enqueue-record whose queuedMessageId
    // is no longer in it has started draining. Mark it dequeued and, when no
    // failure banner is pending and no turn is observably mid-stream, move
    // the banner pointer to the oldest such record so a PRE-STREAM-START
    // `agent:failed` on the drained turn pairs "Try again" with the drained
    // message (the normal post-start attribution rides the stream `started`
    // promotion instead). User deletions never reach here as records — the
    // optimistic `removeQueuedMessageFromAgentQueue` drops the record first.
    const agent = state.byAgentId[agentId];
    if (!agent || agent.turnRetryRecords.length === 0) return state;
    const liveIds = new Set(messages.map((message) => message.id));
    let dequeuedChanged = false;
    const records = agent.turnRetryRecords.map((record) => {
      if (
        record.phase === 'pending' &&
        record.queuedMessageId !== undefined &&
        !record.dequeued &&
        !liveIds.has(record.queuedMessageId)
      ) {
        dequeuedChanged = true;
        return { ...record, dequeued: true };
      }
      return record;
    });
    if (!dequeuedChanged) return state;
    const betweenTurns =
      agent.error === null &&
      !records.some((record) => record.phase === 'streaming');
    const promoted = betweenTurns
      ? records.find((record) => record.phase === 'pending' && record.dequeued)
      : undefined;
    return updateAgent(state, agentId, {
      turnRetryRecords: records,
      ...(promoted
        ? {
            lastAttemptedMessage: promoted.attempt,
            lastAttemptedTurnKey: promoted.turnKey,
          }
        : {}),
    });
  })
  .with(removeQueuedMessageFromAgentQueue, (state, { payload: [agentId, messageId] }) => {
    // User-initiated removal (delete / "Send now") — the queued message will
    // never drain as this record's turn, so drop the record (#999).
    const agent = state.byAgentId[agentId];
    if (!agent) return state;
    const records = agent.turnRetryRecords.filter(
      (record) => record.queuedMessageId !== messageId,
    );
    if (records.length === agent.turnRetryRecords.length) return state;
    return updateAgent(state, agentId, { turnRetryRecords: records });
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
