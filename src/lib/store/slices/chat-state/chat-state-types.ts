// ============================================================================
// Per-Agent Chat State
// ============================================================================

export interface StatusEvent {
  phase: string;
  message: string;
  level: 'info' | 'warn' | 'error';
  timestamp: number;
}

export interface LastAttemptedMessage {
  text: string;
  options?: SendMessageOptions;
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
}

/**
 * Serializable subset of the chat input ContextItem.
 * Excludes the `file` field (a non-serializable `File` object).
 */
export type SerializableContextItem = Omit<ChatInputContextItem, 'file'>;

/**
 * Serializable per-agent chat state stored in Redux.
 * Mirrors the old ChatState from chat.service.ts but
 * without non-serializable fields (those stay in the saga).
 */
export interface ChatAgentState {
  agentId: string;
  // NOTE: isStreaming and isProcessing have been moved to agent-session slice.
  // Read them from AgentSession via canonical agent-session selectors.
  isInterrupting: boolean;
  streamingContent: string;
  error: string | null;
  lastChunkTime: number | null;
  receivedFirstChunk: boolean;
  isStalled: boolean;
  streamingStartTime: number | null;
  lastAttemptedMessage: LastAttemptedMessage | null;
  modelUnavailable: ModelUnavailableInfo | null;
  statusEvents: StatusEvent[];
  /** Workspace ID last recorded by the rebind tracker (mirrors WorkspaceRebindTracker). */
  trackedWorkspaceId: string | null;
  /** True while an async initializeChat triggered by a workspace rebind is in flight. */
  isRebinding: boolean;
  /** Timestamp of the last message send (for rate limiting) */
  lastMessageTime: number;
  /** Timestamp of the last chunk received (for reconciliation skip logic) */
  lastChunkReceivedAt: number;
}

/**
 * Payload for the sendMessage saga-trigger action.
 * All DOM-derived data is serialized by the component before dispatch.
 */
export interface SendMessagePayload {
  text: string;
  serializedContextItems?: Omit<ContextItem, 'file'>[];
  workspaceContextStr?: string;
  noteIds?: string[];
  /** Image blocks extracted from serialized context items */
  imageBlocks?: Array<{ type: 'image'; data: string; mimeType: string }>;
  /** Whether this is a "send queued message now" flow that skips queue-vs-send decision */
  skipQueueCheck?: boolean;
  /** Agent name used for reinitializing chat on workspace change */
  agentName?: string;
  /** Agent model used for reinitializing chat on workspace change */
  agentModel?: string;
  /** Whether this is the initial workspace agent */
  isInitialWorkspaceAgent?: boolean;
}

/** Payload for the initial workspace message saga-trigger action. */
export interface InitialMessagePayload {
  wsId: string;
  message?: string | null;
  imageBlocks?: Array<{ type: 'image'; data: string; mimeType: string }> | null;
  contextReferences?: ContextReference[] | null;
  /** True when backend already sent the message before ChatPanel hydration. */
  alreadySent?: boolean;
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

// Re-export ContextItem so the types file stays self-contained for serialization
import type { ContextItem } from '$features/context/types';
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

export const STALL_DETECTION_MS = 90_000; // 90 seconds
export const STATE_RECONCILIATION_INTERVAL_MS = 10_000; // Check every 10 seconds
export const STATE_RECONCILIATION_FAILURE_THRESHOLD = 2;
export const STUCK_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
export const CHUNK_THROTTLE_MS = 16; // ~60fps
export const STATUS_EVENTS_STORAGE_KEY = 'chat-status-events';

/** Minimum time between messages in ms (rate limiting) */
export const MIN_MESSAGE_SEND_INTERVAL = 100;

/** Stream timeout constant — re-exported from shared config for saga use */
export { AGENT_STREAMING_CONFIG } from '$shared/constants/agent-streaming';
