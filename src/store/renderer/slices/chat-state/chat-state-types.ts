// ============================================================================
// Per-Agent Chat State
// ============================================================================

export interface StatusEvent {
  phase: string;
  message: string;
  level: 'info' | 'warn' | 'error';
  timestamp: number;
}

export interface StreamStatusContext {
  sessionId: string;
}

export interface LastAttemptedMessage {
  text: string;
  options?: SendMessageOptions;
}

/**
 * Lifecycle phase of a turn-scoped retry record (#999):
 * - 'pending'   — send dispatched / message enqueued; the turn's
 *                 `agent:stream:start` has not been observed yet.
 * - 'streaming' — the turn's stream `started` was observed.
 * - 'ended'     — the turn's terminal stream event was observed; the
 *                 disposition (success/failure) rides the follow-up lifecycle
 *                 event (`agent:idle` / `agent:failed`).
 */
export type TurnRetryRecordPhase = 'pending' | 'streaming' | 'ended';

/**
 * Turn-scoped retry record (#999): each send/enqueue attempt gets a
 * client-generated `turnKey` so the error banner's "Try again" can pair with
 * the payload of the turn that actually failed — not whatever single
 * per-agent record happened to be resident. `lastAttemptedMessage` remains
 * the banner resolver; records exist to move that pointer to the right turn
 * as turns start/drain.
 */
export interface TurnRetryRecord {
  /** Client-generated unique key assigned at send/enqueue time. */
  turnKey: string;
  attempt: LastAttemptedMessage;
  phase: TurnRetryRecordPhase;
  /**
   * The daemon `QueuedMessage.id` for enqueued attempts — correlates the
   * record with `agent:queue:updated` snapshots so a dequeue (drain start)
   * promotes this record to the banner pointer.
   */
  queuedMessageId?: string;
  /** Set when a queue snapshot no longer contains `queuedMessageId` (drain started). */
  dequeued?: boolean;
  /** The turn's assistant messageId, correlated from the stream `started` event. */
  messageId?: string;
}

export interface ModelUnavailableInfo {
  failedModel: string;
  nextAvailableModel: string;
}

export interface SendMessageOptions {
  contextItems?: SerializableContextItem[];
  noteIds?: string[];
  personality?: string;
  resetHistory?: boolean;
  model?: string;
  agentId?: string;
  contextReferences?: ContextReference[];
  /**
   * Image blocks the original send carried, recorded so "Try again" resends
   * them with the message (#965). Plain base64 data — serializable/redux-safe.
   */
  imageBlocks?: Array<{ type: 'image'; data: string; mimeType: string }>;
}

/**
 * Serializable subset of the chat input ContextItem.
 * Excludes the `file` field (a non-serializable `File` object).
 */
export type SerializableContextItem = Omit<ChatInputContextItem, 'file'>;

/**
 * Transcript hydration status: 'loading' when a transcript fetch is in flight,
 * 'settled' when it completes (success or error). Defaults to undefined (not yet started).
 */
export type TranscriptHydrationStatus = 'loading' | 'settled';

/**
 * Serializable per-agent chat state stored in Redux.
 * Serializable per-agent chat state without non-serializable fields
 * (those stay in the saga).
 */
export interface ChatAgentState {
  agentId: string;
  // NOTE: isStreaming and isProcessing have been moved to agent-session slice.
  // Read them from AgentSession via canonical agent-session selectors.
  isInterrupting: boolean;
  error: string | null;
  lastChunkTime: number | null;
  receivedFirstChunk: boolean;
  streamingStartTime: number | null;
  lastAttemptedMessage: LastAttemptedMessage | null;
  /**
   * The `turnKey` the current `lastAttemptedMessage` belongs to (#999).
   * `null` for legacy/unscoped records (hydration, edit-regenerate,
   * enqueue-failure banners) — those keep the pre-#999 idle-clear semantics.
   */
  lastAttemptedTurnKey: string | null;
  /**
   * FIFO turn-scoped retry records (#999) for turns that are pending
   * (queued/sent, awaiting stream start) or in flight. Bounded (capped and
   * finalized on `agent:idle`), plain array per store serialization rules.
   */
  turnRetryRecords: TurnRetryRecord[];
  modelUnavailable: ModelUnavailableInfo | null;
  statusEvents: StatusEvent[];
  /** Workspace ID last recorded by the rebind tracker (mirrors WorkspaceRebindTracker). */
  trackedWorkspaceId: string | null;
  /** True while an async initializeChat triggered by a workspace rebind is in flight. */
  isRebinding: boolean;
  /** Timestamp of the last accepted message send (for saga-owned rate limiting) */
  lastMessageTime: number;
  /** Timestamp of the last chunk received (for reconciliation skip logic) */
  lastChunkReceivedAt: number;
  /**
   * Transcript hydration status for this agent. Undefined means hydration has not
   * started; 'loading' means a fetch is in flight; 'settled' means the fetch completed
   * (success or error). Gates the welcome page: skeleton shows while loading, welcome
   * shows only when settled with zero messages.
   */
  transcriptHydration?: TranscriptHydrationStatus;
}

/**
 * Payload for the sendMessage saga-trigger action.
 * DOM-derived context may be raw; the saga owns serialization before IPC.
 */
export interface SendMessagePayload {
  text: string;
  contextItems?: ChatInputContextItem[];
  serializedContextItems?: SerializableContextItem[];
  workspaceContextStr?: string;
  noteIds?: string[];
  /** Image blocks extracted from serialized context items */
  imageBlocks?: Array<{ type: 'image'; data: string; mimeType: string }>;
  /** Queued message id to remove before replaying a queued message. */
  queuedMessageId?: string;
  /** Whether this is a "send queued message now" flow that skips queue-vs-send decision */
  skipQueueCheck?: boolean;
  /** Whether saga-owned stop orchestration should run before sending. */
  forceSubmit?: boolean;
  /** Agent name used for reinitializing chat on workspace change */
  agentName?: string;
  /** Agent model used for reinitializing chat on workspace change */
  agentModel?: string;
  /** Whether this is the initial workspace agent */
  isInitialWorkspaceAgent?: boolean;
}

/**
 * Options for the initializeChat saga-trigger action.
 * Optional parameters for the initializeChatRequested action.
 */
export interface InitializeChatOptions {
  agentName?: string;
  agentModel?: string;
  agentType?: string;
  isInitialWorkspaceAgent?: boolean;
}

import type { ContextItem as ChatInputContextItem } from '$lib/components/chat/input/context-api';
import type { ContextReference } from '$features/agent/agent-context';

// ============================================================================
// Top-level slice state (flat, agent-keyed)
// ============================================================================

export interface ChatStateSlice {
  byAgentId: Record<string, ChatAgentState>;
}

// ============================================================================
// Constants
// ============================================================================

export const STATUS_EVENTS_STORAGE_KEY = 'chat-status-events';

/** Minimum time between messages in ms (rate limiting) */
export const MIN_MESSAGE_SEND_INTERVAL = 100;
