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
 * A parked, turn-scoped retry payload for a daemon-queued send (#999).
 * `seq` is a per-agent monotonic enqueue sequence (derived in the reducer as
 * max existing seq + 1) — promotion picks the highest drained seq, because
 * `Record` key iteration order is NOT insertion order for integer-like keys,
 * so key order alone cannot encode FIFO enqueue order.
 */
export interface QueuedRetryRecord {
  seq: number;
  record: LastAttemptedMessage;
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
   * Turn-scoped retry records for daemon-queued sends (#999), keyed by the
   * QueuedMessage id returned from a successful enqueue. When the daemon
   * drains an entry (its id leaves the `agent:queue:updated` snapshot), the
   * record is PROMOTED into `lastAttemptedMessage` so a failure in the
   * drained turn retries that turn's own payload — not the previous
   * in-flight turn's. User-removed entries drop their record instead of
   * promoting.
   */
  queuedRetryRecords: Record<string, QueuedRetryRecord>;
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

/**
 * Cap on parked `queuedRetryRecords` per agent (#973-family memory bound).
 * Records normally leave via snapshot diff, user removal, or reset — but a
 * dropped events subscription or per-agent deletion can strand them for the
 * app session, and each can carry MB-scale base64 imageBlocks. Parking
 * beyond the cap evicts the oldest (lowest-seq) records first; 20 comfortably
 * exceeds any realistic queue depth.
 */
export const MAX_QUEUED_RETRY_RECORDS = 20;
