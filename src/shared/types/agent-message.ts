/**
 * Unified AgentMessage Type Definition
 *
 * Single source of truth for all agent message types across the application.
 * Consolidates definitions from:
 * - src/shared/types.ts (main definition)
 * - src/lib/types/agent.ts (legacy)
 * - src/features/agent/agent-types.ts (provider version)
 * - src/features/agent/agent-providers/base-provider.ts (provider variant)
 *
 * Supports both core messages (with full metadata) and provider messages (simplified).
 */

import type { ContentBlock } from './content-block';
import type { AgentId } from './branded-ids';

/**
 * Message role type
 */
export const MESSAGE_ROLES = ['user', 'assistant', 'tool', 'system', 'error'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

/**
 * Tool call information
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: any;
  result?: any;
  error?: string;
  timestamp?: string;

  // Optional fields for backward compatibility and extended tracking
  toolName?: string; // Alias for name
  parameters?: any; // Alias for arguments
  status?: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
}

/**
 * Tool result information
 */
export interface ToolResult {
  toolCallId: string;
  content: any;
  isError?: boolean;
  timestamp?: string;
}

/**
 * Serve-time author projection the daemon attaches to every `user` row of a
 * multiplayer workspace (PROTOCOL §5.5, intent-hq/intentd#1869): the
 * principal resolved from the row's `metadata.fromPrincipalId` stamp, else
 * the workspace's legacy author, else its owner. Profile fields are `null`
 * when the principal row is gone; `principalId` is always the row's id.
 */
export interface MessageAuthor {
  principalId: string;
  login: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * Message metadata containing operational information
 */
export interface MessageMetadata {
  // Model information
  model?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  duration_ms?: number;
  total_cost_usd?: number;

  // Streaming metadata
  chunksReceived?: number;
  firstChunkTime?: number;
  lastChunkTime?: number;

  // Error recovery
  isError?: boolean;
  errorCode?: string;
  recoverable?: boolean;
  recovered?: boolean;
  recoveredAt?: string;
  originalMessageId?: string;

  // Message state
  isInitialMessage?: boolean;
  streamComplete?: boolean;
  action?: string;
  interrupted?: boolean;

  // Merging
  merged?: boolean;
  mergedCount?: number;

  // Interruption cause on interrupted assistant rows (PROTOCOL §7); also
  // carried by the terminal `agent:stream:end` event. `interruptedBy` is only
  // present for `preempted_by_message`. Open union: unknown future daemon
  // reasons pass through and resolve to the generic Stopped label.
  interruptReason?:
    | 'user_stop'
    | 'preempted_by_message'
    | 'daemon_shutdown'
    | 'agent_stopped'
    | 'system_suspend'
    | (string & {});
  interruptedBy?: { kind: 'user' } | { kind: 'agent'; agentId?: string; name?: string };

  // Streaming
  stopReason?: string;
  // Abnormal finish reason persisted on the turn's assistant row (PROTOCOL
  // §7.3): "refusal" | "max_tokens" | "max_turn_requests" today (open union);
  // absent on normal end_turn completions.
  finishReason?: string;
  sessionId?: string;
  frontendSessionId?: string;
  streamId?: string;
  auggieSessionId?: string; // Raw auggie session ID (UUID format without prefix)

  // Context
  contextReferences?: any[];

  // Queued-message delivery info stamped by the daemon on drained queue
  // entries (PROTOCOL §5.5 "Dequeue-wait annotation"). `batchId` is shared by
  // every row drained in one multi-message batch flush; absent on
  // single-message deliveries and on rows from older daemons. Batch entries
  // whose wait fell below the 5-second annotation threshold carry ONLY
  // `batchId` (no `queuedAt`/`waitedMs`), so the wait fields are optional.
  // `queuedMessageId` names the queue entry (`QueuedMessage.id`) the row was
  // drained from; absent on rows from older daemons.
  queueInfo?: {
    queuedAt?: string;
    waitedMs?: number;
    batchId?: string;
    queuedMessageId?: string;
  };

  // Daemon-stamped authoring principal on user-origin rows (PROTOCOL §5.5,
  // intent-hq/intentd#1869). Overwrites any client-supplied value; stripped
  // from non-user-origin rows. The resolved profile rides `AgentMessage.author`.
  fromPrincipalId?: string;

  // Allow additional properties
  [key: string]: any;
}

/**
 * Core AgentMessage type - comprehensive message with all fields
 * Used throughout the application for message handling
 */
export interface AgentMessage {
  // Identifiers
  id: string;
  appMessageId?: string;
  agentId?: AgentId;

  // Core content
  role: MessageRole;
  contentBlocks?: ContentBlock[];

  // Timing
  timestamp: string | Date;
  turnNumber?: number;

  // Daemon-assigned per-agent monotonic sequence number (PROTOCOL §5.5) —
  // present on every daemon-persisted row (getConversation pages, §7.1
  // snapshot rows, terminal-frame reconciles via `messageSeq`). Absent only
  // on local-only rows: optimistic user rows before the daemon echo and
  // in-flight assistant messages before the terminal frame. The transcript
  // orders by this, not timestamps (clock-skew immune).
  seq?: number;

  // Tool interactions
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];

  // Error handling
  error?: string;
  errorCode?: string;

  // Streaming state
  isStreaming?: boolean;
  streamingComplete?: boolean;
  // Renderer-local, never on the wire: the renderer wrote this row's terminal
  // state without the §7.1 stream delivering it — the firehose placeholder on
  // a covered agent (created on any firehose event with no in-flight row, so
  // it may still be `isStreaming`), a firehose terminal on an existing row, or
  // the close-time / retained-row `settleStreaming` normalize. Absent means
  // daemon-canonical (or still streaming under the §7.1 stream). Cleared by
  // construction when a §7.1 snapshot/delta replaces the row by id (transcript
  // rows never carry it) and by dedup when a canonical row merges into it.
  provisional?: true;

  // Serve-time author projection on `user` rows (PROTOCOL §5.5,
  // intent-hq/intentd#1869). Absent on non-user rows, on local-only optimistic
  // rows before the daemon echo, and on rows from older daemons.
  author?: MessageAuthor;

  // Metadata
  metadata?: MessageMetadata;
}

/**
 * Simplified provider message type
 * Used for provider communication (no id, no timestamp)
 */
export interface ProviderMessage {
  role: MessageRole;
  contentBlocks?: ContentBlock[];
  toolCalls?: ToolCall[];
  metadata?: Record<string, any>;
}
