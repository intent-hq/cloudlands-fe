/**
 * Type definitions for the Workspace Event System
 *
 * This is the single source of truth for all event types in the workspace.
 * All event-related types should be imported from this file.
 */

import type { SessionStats } from '../../shared/types/agent-session';

// ============================================================================
// Actor Types
// ============================================================================

/**
 * All possible actor types in the system.
 * - 'user': Human user performing actions
 * - 'agent': AI agent performing actions
 * - 'system': System-level operations (git, file watcher, etc.)
 * - 'external': External sources (webhooks, integrations)
 * - 'tool': Tool execution context (for observability)
 */
export type ActorType = 'user' | 'agent' | 'system' | 'external' | 'tool';

/**
 * Unified actor interface for all event types.
 * This is the canonical definition - import from here, not from other modules.
 */
export interface EventActor {
  type: ActorType;
  id?: string; // Optional for backward compatibility with user actors
  name?: string; // Optional - will be derived from id or type if not provided
  email?: string; // For user actors
  model?: string; // For agent actors
  metadata?: Record<string, any>;
}

/**
 * Canonical agent status metadata carried by agent IPC/domain events.
 * Properties are required for in-scope lifecycle event payloads; use explicit
 * null when a value is not semantically known for a refresh-style notification.
 */
export interface CanonicalAgentStatusFields {
  status: string | null;
  activationState: string | null;
  isActive: boolean | null;
  isStreaming: boolean | null;
  isProcessing: boolean | null;
  isResponding: boolean | null;
  stopReason: string | null;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Workspace event types.
 *
 * - `WorkspaceEventType` (value): runtime constants (backward compatible with `WorkspaceEventType.FileModified` style)
 * - `WorkspaceEventType` (type): string-literal union derived from the constants
 */
export const WorkspaceEventType = {
  // File events
  FileChanged: 'file:changed',
  FileCreated: 'file:created',
  FileDeleted: 'file:deleted',
  FileRenamed: 'file:renamed',
  // Backward-compatible alias (older code/tests used FileModified)
  FileModified: 'file:changed',

  // Agent lifecycle events
  AgentStarted: 'agent:started',
  AgentCompleted: 'agent:completed',
  AgentFailed: 'agent:failed',
  AgentError: 'agent:failed',
  AgentToolCall: 'agent:tool:call',
  AgentMessage: 'agent:message',

  // Agent interaction events (for agent-to-agent communication)
  AgentCreated: 'agent:created',
  AgentDeleted: 'agent:deleted',
  AgentRestored: 'agent:restored',
  AgentRenamed: 'agent:renamed',
  AgentIdle: 'agent:idle',
  AgentStatusChanged: 'agent:status-changed',
  AgentMessageSent: 'agent:message:sent',
  AgentMessageReceived: 'agent:message:received',
  AgentSubscribed: 'agent:subscribed',
  AgentUnsubscribed: 'agent:unsubscribed',
  AgentWokenBySubscription: 'agent:woken-by-subscription',
  AgentDeliveryConfirmed: 'agent:delivery-confirmed',
  AgentEventDeliveryFailed: 'agent:event-delivery-failed',
  AgentEventDeliveryTimeout: 'agent:event-delivery-timeout',
  AgentSubscriptionsRestored: 'agent:subscriptions-restored',
  AgentSubscriptionsChanged: 'agent:subscriptions-changed',
  AgentMessageDeliveryFailed: 'agent:message:delivery-failed',

  // Agent streaming events (for WebSocket API)
  AgentStreamStart: 'agent:stream:start',
  AgentStreamChunk: 'agent:stream:chunk',
  AgentStreamContentBlocks: 'agent:stream:content-blocks',
  AgentStreamEnd: 'agent:stream:end',
  AgentStreamMessage: 'agent:stream:message',
  AgentStreamToolUse: 'agent:stream:tool_use',
  AgentStreamToolResult: 'agent:stream:tool_result',

  // Agent queue events (for WebSocket API)
  AgentQueueUpdated: 'agent:queue:updated',
  AgentQueueProcessing: 'agent:queue:processing',
  AgentQueueProcessingCancelled: 'agent:queue:processing-cancelled',
  AgentQueueStaleMessage: 'agent:queue:stale-message',

  // Agent process-registry lifecycle events
  AgentProcessQueued: 'agent:process:queued',
  AgentProcessResumed: 'agent:process:resumed',
  AgentProcessEvicted: 'agent:process:evicted',

  // Agent user message events (for cross-client sync)
  AgentUserMessageSent: 'agent:user-message:sent',

  // Agent session stats (PROTOCOL §5.24)
  AgentSessionStatsChanged: 'agent:session-stats-changed',

  // Git events
  GitCommit: 'git:commit',
  GitPush: 'git:push',
  GitPull: 'git:pull',
  GitBranch: 'git:branch',
  GitMerge: 'git:merge',

  // Note events
  NoteCreated: 'note:created',
  NoteUpdated: 'note:updated',
  NoteDeleted: 'note:deleted',

  // Task events
  TaskStatusChanged: 'task:status-changed',
  TaskReadyTasksChanged: 'task:ready-tasks-changed',

  // Terminal events
  TerminalCommand: 'terminal:command',

  // Test events
  TestStarted: 'test:started',
  TestCompleted: 'test:completed',

  // Build events
  BuildStarted: 'build:started',
  BuildCompleted: 'build:completed',

  // Workspace events
  Created: 'workspace:created',
  Updated: 'workspace:updated',
  Deleted: 'workspace:deleted',
  Opened: 'workspace:opened',
  Closed: 'workspace:closed',
  Activity: 'workspace:activity',

  // Spec events
  SpecUpdated: 'spec:updated',
  GoalUpdated: 'goal:updated',

  // Comment events
  CommentAdded: 'comment:added',

  // MCP events
  McpNotification: 'mcp:notification',
} as const;

export type WorkspaceEventType = (typeof WorkspaceEventType)[keyof typeof WorkspaceEventType];

// NOTE: We intentionally keep runtime constants here for readability/back-compat,
// while keeping the canonical schema as string-literal types.

// ============================================================================
// Base Event Interface
// ============================================================================

export interface WorkspaceEventBase {
  id: string;
  workspaceId: string;
  timestamp: string;
  type: WorkspaceEventType;
  actor: EventActor;
  sessionId?: string;
  correlationId?: string;
  parentEventId?: string;
  metadata?: Record<string, any>;
}

// ============================================================================
// Specific Event Types
// ============================================================================

/**
 * File mutation event.
 *
 * NOTE: The canonical file event taxonomy lives on `data.action`
 * (`'create' | 'modify' | 'delete' | 'rename'`). All file mutations — including
 * creates, deletes, and renames — are emitted as `file:changed` events with the
 * appropriate `action` value. The sibling string types `file:created`,
 * `file:deleted`, and `file:renamed` are reserved-but-unused: no production code
 * emits them, and external clients subscribing to those types will silently
 * receive zero events. Subscribe to `file:changed` and discriminate on
 * `data.action`.
 */
export interface FileChangedEvent extends WorkspaceEventBase {
  type: 'file:changed';
  data: {
    path: string;
    relativePath: string;
    action: 'create' | 'modify' | 'delete' | 'rename';
    oldPath?: string;
    additions?: number;
    deletions?: number;
    language?: string;
    size?: number;
    diff?: string;
    oldContent?: string;
    newContent?: string;
    oldContentSha?: string;
    newContentSha?: string;
  };
}

export interface AgentToolCallEvent extends WorkspaceEventBase {
  type: 'agent:tool:call';
  data: {
    toolName: string;
    toolKind: 'file' | 'terminal' | 'search' | 'note' | 'git' | 'other';
    input: any;
    output?: any;
    status: 'started' | 'completed' | 'error';
    error?: string;
    duration?: number;
    filesModified?: string[];
  };
}

/**
 * @deprecated Reserved — not currently emitted.
 * Production code uses `AgentMessageSentEvent` / `AgentMessageReceivedEvent` instead.
 */
export interface AgentMessageEvent extends WorkspaceEventBase {
  type: 'agent:message';
  data: {
    messageId: string;
    turnNumber: number;
    content: string;
    model?: string;
    temperature?: number;
    reasoning?: string;
  };
}

/**
 * @deprecated Reserved — not currently emitted.
 * No production code emits `git:commit` / `git:push` / `git:pull` / `git:branch` /
 * `git:merge` workspace events. Background git operations use the
 * `'git:op-*'` domain events instead.
 */
export interface GitOperationEvent extends WorkspaceEventBase {
  type: 'git:commit' | 'git:push' | 'git:pull' | 'git:branch' | 'git:merge';
  data: {
    operation: 'commit' | 'push' | 'pull' | 'branch' | 'merge';
    branch?: string;
    commit?: string;
    message?: string;
    files?: string[];
    remote?: string;
    ahead?: number;
    behind?: number;
  };
}

export interface NoteChangedEvent extends WorkspaceEventBase {
  type: 'note:created' | 'note:updated' | 'note:deleted';
  data: {
    noteId: string;
    title?: string;
    path: string;
    action: 'create' | 'update' | 'delete';
    sections?: string[];
    tags?: string[];
  };
}

/**
 * Task status change event
 * Emitted from the backend when a task's status changes (via UI or MCP tools)
 */
export interface TaskStatusChangedEvent extends WorkspaceEventBase {
  type: 'task:status-changed';
  data: {
    noteId: string;
    noteTitle: string;
    previousStatus: string;
    newStatus: string;
    /** Timestamp when status changed */
    changedAt: string;
    /** Agent ID if an agent made the change */
    agentId?: string;
  };
}

/**
 * Ready tasks changed event
 * Emitted when the list of ready tasks changes (e.g., after a task status change)
 * Contains the full list of ready task IDs for efficient UI updates
 */
export interface ReadyTasksChangedEvent extends WorkspaceEventBase {
  type: 'task:ready-tasks-changed';
  data: {
    /** Array of note IDs that are ready to work on */
    readyTaskIds: string[];
    /** What triggered the change (e.g., which task status changed) */
    triggeredBy?: {
      noteId: string;
      previousStatus: string;
      newStatus: string;
    };
    /** Timestamp when ready tasks were computed */
    computedAt: string;
  };
}

/** @deprecated Reserved — not currently emitted. */
export interface TestEvent extends WorkspaceEventBase {
  type: 'test:started' | 'test:completed';
  data: {
    testSuite?: string;
    testName?: string;
    status?: 'running' | 'passed' | 'failed' | 'skipped';
    duration?: number;
    error?: string;
    coverage?: number;
  };
}

/** @deprecated Reserved — not currently emitted. */
export interface BuildEvent extends WorkspaceEventBase {
  type: 'build:started' | 'build:completed';
  data: {
    buildId?: string;
    target?: string;
    status?: 'running' | 'success' | 'failed';
    duration?: number;
    error?: string;
    artifacts?: string[];
  };
}

export interface AgentFailedEvent extends WorkspaceEventBase {
  type: 'agent:failed';
  data: {
    error: string;
    turnNumber?: number;
    model?: string;
    respondingToMessageId?: string;
  };
}

/** @deprecated Reserved — not currently emitted. */
export interface TerminalCommandEvent extends WorkspaceEventBase {
  type: 'terminal:command';
  data: {
    command: string;
    workingDirectory?: string;
    exitCode?: number;
    output?: string;
    duration?: number;
  };
}

// ============================================================================
// Agent Interaction Events (for agent-to-agent communication)
// ============================================================================

/**
 * Emitted when a new agent is created (by user or another agent)
 */
export interface AgentCreatedEvent extends WorkspaceEventBase {
  type: 'agent:created';
  data: {
    agentId: string;
    agentName: string;
    model?: string;
    /** ID of the agent that created this agent (if created by another agent) */
    createdByAgentId?: string;
    /** Task note ID if agent was assigned to a task */
    taskNoteId?: string;
    /** Initial message sent to the agent */
    initialMessage?: string;
  };
}

/**
 * Emitted when an agent is deleted
 * This is important for delegation subscriptions to know when a child agent is removed
 */
export interface AgentDeletedEvent extends WorkspaceEventBase {
  type: 'agent:deleted';
  data: {
    agentId: string;
    agentName: string;
    /** Task note ID if agent was working on a task */
    taskNoteId?: string;
    /** Whether the deletion was user-initiated or system-initiated */
    reason?: 'user_action' | 'workspace_deleted' | 'cleanup';
    /** Whether this was a background agent (e.g., PR description generator) */
    isBackground?: boolean;
    /** ID of the parent agent that created this agent */
    parentAgentId?: string;
  };
}

/**
 * Emitted when a durable delete fails after `agent:deleted` was already broadcast.
 * Consumers should re-add the agent to their local state from the cached session
 * snapshot so the UI matches the on-disk truth again.
 */
export interface AgentRestoredEvent extends WorkspaceEventBase {
  type: 'agent:restored';
  data: {
    agentId: string;
    agentName: string;
    /** Full cached session snapshot captured before the failed delete */
    session: unknown;
    /** Task note ID if agent was working on a task */
    taskNoteId?: string;
    /** Whether this was a background agent */
    isBackground?: boolean;
    /** ID of the parent agent that created this agent */
    parentAgentId?: string;
    /** Why the agent was restored (currently only failed durable delete) */
    reason?: 'delete_failed';
    /** Error message from the failed delete, for diagnostics */
    error?: string;
  };
}

/**
 * Emitted when an agent finishes responding and becomes idle
 */
export interface AgentIdleEvent extends WorkspaceEventBase {
  type: 'agent:idle';
  data: {
    agentId: string;
    agentName: string;
    /** Reason the agent became idle */
    reason?: 'stream_complete' | 'interrupted' | 'error' | 'timeout';
    /** The finish reason from the LLM (e.g., 'end_turn', 'cancelled', 'error') */
    finishReason?: string;
    /** Number of messages in the conversation (optional) */
    messageCount?: number;
    /** Duration of the last response in ms */
    lastResponseDuration?: number;
    /** Summary of the agent's last response (truncated if long) */
    lastResponseSummary?: string;
    /** Task note ID if agent was working on a task */
    taskNoteId?: string;
    /** Title of the task note if agent was working on a task */
    taskTitle?: string;
    /** Specialist type (spec-writer, implementor, verifier) */
    specialist?: string;
    /** Whether this is a background agent (not user-facing) */
    isBackground?: boolean;
    /** Explicit completion report set by the agent via report_to_parent tool */
    completionReport?: string;
    /** ID of the parent agent that created this agent (for delegation) */
    parentAgentId?: string;
    /** User/queued message ID that produced the completed response, when known */
    respondingToMessageId?: string;
  } & CanonicalAgentStatusFields;
}

/**
 * Emitted when an agent's status changes (idle, responding, waiting, completed, failed)
 */
export interface AgentStatusChangedEvent extends WorkspaceEventBase {
  type: 'agent:status-changed';
  data: Omit<CanonicalAgentStatusFields, 'status'> & {
    agentId: string;
    previousStatus: 'idle' | 'responding' | 'waiting' | 'completed' | 'failed';
    status: 'idle' | 'responding' | 'waiting' | 'completed' | 'failed';
  };
}

/**
 * Emitted when an agent sends a message to another agent
 */
export interface AgentMessageSentEvent extends WorkspaceEventBase {
  type: 'agent:message:sent';
  data: {
    fromAgentId: string;
    fromAgentName: string;
    toAgentId: string;
    toAgentName: string;
    message: string;
    /** Priority of the message */
    priority: 'high' | 'normal' | 'interrupt';
  };
}

/**
 * @deprecated Reserved — not currently emitted.
 * No production code emits `agent:message:received` as a workspace event;
 * the notification formatter still type-narrows on it but no upstream emitter
 * has been wired. New code should use `AgentMessageSentEvent` for both halves
 * of agent-to-agent messaging or wait for a real emission site to be added.
 */
export interface AgentMessageReceivedEvent extends WorkspaceEventBase {
  type: 'agent:message:received';
  data: {
    fromAgentId: string;
    fromAgentName: string;
    toAgentId: string;
    toAgentName: string;
    message: string;
    /** Whether the message was queued (agent was busy) */
    wasQueued: boolean;
  };
}

/**
 * Emitted when an agent subscribes to workspace events
 */
export interface AgentSubscribedEvent extends WorkspaceEventBase {
  type: 'agent:subscribed';
  data: {
    agentId: string;
    agentName: string;
    subscriptionId: string;
    /** Event types being subscribed to */
    eventTypes: string[];
    /** Filter description for logging */
    filterDescription?: string;
  };
}

/**
 * Emitted when an agent unsubscribes from workspace events
 */
export interface AgentUnsubscribedEvent extends WorkspaceEventBase {
  type: 'agent:unsubscribed';
  data: {
    agentId: string;
    agentName: string;
    subscriptionId: string;
    /** Reason for unsubscription */
    reason?: 'manual-unsubscribe' | 'oneshot-fired' | 'delegation-complete';
    /** Group ID if this was a delegation group subscription */
    groupId?: string;
  };
}

/**
 * Emitted when an agent is woken up by a subscription event
 */
export interface AgentWokenBySubscriptionEvent extends WorkspaceEventBase {
  type: 'agent:woken-by-subscription';
  data: {
    agentId: string;
    agentName?: string;
    /** Number of events that triggered the wake-up */
    eventCount: number;
    /** Types of events that triggered the wake-up */
    eventTypes: string[];
  };
}

/**
 * Emitted after successful delivery of subscription events to an agent.
 * Gives external observers (UI, tests, monitoring) a signal that the delivery chain completed.
 */
export interface AgentDeliveryConfirmedEvent extends WorkspaceEventBase {
  type: 'agent:delivery-confirmed';
  data: {
    subscriberAgentId: string;
    deliveredEventIds: string[];
    subscriptionId?: string;
  };
}

/**
 * Emitted when event delivery to an agent fails after all retries
 */
export interface AgentEventDeliveryFailedEvent extends WorkspaceEventBase {
  type: 'agent:event-delivery-failed';
  data: {
    targetAgentId: string;
    eventCount: number;
    eventTypes: string[];
    error: string;
  };
}

/**
 * Emitted when event delivery to an agent times out (status unknown).
 * This is distinct from delivery failure — timeout means the message was sent
 * but we couldn't confirm completion within the timeout window.
 */
export interface AgentEventDeliveryTimeoutEvent extends WorkspaceEventBase {
  type: 'agent:event-delivery-timeout';
  data: {
    targetAgentId: string;
    eventCount: number;
    eventTypes: string[];
    timeoutMs: number;
  };
}

/**
 * Emitted when persisted subscriptions are restored on startup
 * Contains a batch count and list of unique agent IDs that have restored subscriptions
 */
export interface AgentSubscriptionsRestoredEvent extends WorkspaceEventBase {
  type: 'agent:subscriptions-restored';
  data: {
    /** Number of subscriptions restored */
    count: number;
    /** Array of unique agent IDs that have restored subscriptions */
    agentIds: string[];
  };
}

/**
 * Emitted whenever a workspace's subscription registry changes.
 * Used as a hint for renderers to refetch a snapshot.
 * May be workspace-scoped when no single agent target changed.
 */
export interface AgentSubscriptionsChangedEvent extends WorkspaceEventBase {
  type: 'agent:subscriptions-changed';
  data: {
    agentId?: string;
    subscriptionVersion: number;
    reason?: string;
  };
}

/**
 * Emitted when a direct agent-to-agent message fails to deliver
 */
export interface AgentMessageDeliveryFailedEvent extends WorkspaceEventBase {
  type: 'agent:message:delivery-failed';
  data: {
    fromAgentId: string;
    toAgentId: string;
    error: string;
    timestamp: string;
  };
}

/**
 * Emitted when an MCP push notification is received
 */
export interface McpNotificationEvent extends WorkspaceEventBase {
  type: 'mcp:notification';
  data: {
    topic: string;
    message: string;
    metadata?: Record<string, any>;
  };
}

/**
 * Emitted when an agent starts responding to a message.
 */
export interface AgentStartedEvent extends WorkspaceEventBase {
  type: 'agent:started';
  data: {
    agentId: string;
    agentName: string;
    model?: string;
    /** Reason the agent started (e.g., 'message_received') */
    reason?: string;
  };
}

/**
 * Emitted when an agent is renamed (via user action or MCP tool).
 * Carries enough context for renderers to update agent labels without a refetch.
 */
export interface AgentRenamedEvent extends WorkspaceEventBase {
  type: 'agent:renamed';
  data: {
    agentId: string;
    workspaceId: string;
    name: string;
  };
}

/**
 * Emitted when an agent's queue is updated (message queued, edited, or removed).
 * `data` mirrors the raw IPC payload sent to renderers — `queue` is the current
 * queue snapshot.
 */
export interface AgentQueueUpdatedEvent extends WorkspaceEventBase {
  type: 'agent:queue:updated';
  data: {
    agentId: string;
    queue: any[];
  };
}

/**
 * Emitted when the backend starts processing a queued message for an agent.
 */
export interface AgentQueueProcessingEvent extends WorkspaceEventBase {
  type: 'agent:queue:processing';
  data: {
    agentId: string;
    messageId: string;
    /** Optional content of the message being processed (for UI display) */
    content?: string;
    [key: string]: any;
  };
}

/**
 * Emitted when queue processing is cancelled (e.g., agent stopped).
 */
export interface AgentQueueProcessingCancelledEvent extends WorkspaceEventBase {
  type: 'agent:queue:processing-cancelled';
  data: {
    agentId: string;
    messageId?: string;
    /** True when the backend retained the message in its queue (it will be
     *  processed on a later cycle); false/absent when the message was dropped. */
    requeued?: boolean;
    [key: string]: any;
  };
}

/**
 * Emitted when the backend processes a queued message that has aged past the
 * staleness threshold. WebSocket subscribers receive this alongside the IPC
 * channel used by renderer windows.
 */
export interface AgentQueueStaleMessageEvent extends WorkspaceEventBase {
  type: 'agent:queue:stale-message';
  data: {
    agentId: string;
    messageId: string;
    ageMinutes: number;
    queuedAt: string;
  };
}

/**
 * Emitted when an agent spawn is queued waiting for a free process slot
 * (all slots active). Self-sufficient payload carries `{ agentId, used, cap }`
 * so clients can render the cap-saturation state without polling.
 */
export interface AgentProcessQueuedEvent extends WorkspaceEventBase {
  type: 'agent:process:queued';
  data: {
    agentId: string;
    used: number;
    cap: number;
  };
}

/**
 * Emitted when a queued agent spawn resumes (a slot freed).
 * Self-sufficient payload carries `{ agentId, used, cap }`.
 */
export interface AgentProcessResumedEvent extends WorkspaceEventBase {
  type: 'agent:process:resumed';
  data: {
    agentId: string;
    used: number;
    cap: number;
  };
}

/**
 * Emitted when the process registry evicts the LRU idle process.
 * Self-sufficient payload carries `{ agentId, used, cap }`.
 * No UI rendering required per task scope.
 */
export interface AgentProcessEvictedEvent extends WorkspaceEventBase {
  type: 'agent:process:evicted';
  data: {
    agentId: string;
    used: number;
    cap: number;
  };
}

/**
 * Emitted when the daemon opens an implicit agent-initiated turn (PROTOCOL
 * §6.6 / §7). Only agent-initiated (harness-wake) turns emit this event;
 * prompt (user-initiated) turns never do. `messageId` is the assistant
 * messageId minted for the wake turn — the same id carried by the turn's
 * `agent:stream:chunk` / `agent:tool:call` events and the persisted row.
 */
export interface AgentStreamStartEvent extends WorkspaceEventBase {
  type: 'agent:stream:start';
  data: {
    agentId: string;
    messageId: string;
    /** Why the daemon opened the turn — `"harness-wake"` is the only value today. */
    reason: string;
  };
}

/**
 * Emitted when an agent streams a text chunk (token-by-token)
 */
export interface AgentStreamChunkEvent extends WorkspaceEventBase {
  type: 'agent:stream:chunk';
  data: {
    agentId: string;
    content: any;
    streamId?: string;
  };
}

/**
 * Emitted when an agent streams content blocks (tool calls, structured content)
 */
export interface AgentStreamContentBlocksEvent extends WorkspaceEventBase {
  type: 'agent:stream:content-blocks';
  data: {
    agentId: string;
    content: any;
    streamId?: string;
  };
}

/**
 * Emitted when an agent's stream completes
 */
export interface AgentStreamEndEvent extends WorkspaceEventBase {
  type: 'agent:stream:end';
  data: {
    agentId: string;
    streamId?: string;
  };
}

/**
 * Emitted when a user sends a message to an agent (for cross-client sync).
 * Other clients viewing the same conversation can use this to display the
 * user message without waiting for the agent to respond.
 */
export interface AgentUserMessageSentEvent extends WorkspaceEventBase {
  type: 'agent:user-message:sent';
  data: {
    agentId: string;
    messageId: string;
    /** Stable app-owned logical ID used to merge optimistic and canonical messages. */
    appMessageId?: string;
    content: string;
    imageBlocks?: any[];
  };
}

/**
 * Emitted when an agent session's cumulative usage counters change
 * (PROTOCOL §5.24). Payload is self-sufficient (§6.7) — carries the full
 * current `SessionStats` snapshot, not a delta.
 */
export interface AgentSessionStatsChangedEvent extends WorkspaceEventBase {
  type: 'agent:session-stats-changed';
  data: {
    sessionId: string;
    agentId?: string;
    stats: SessionStats;
  };
}

// Union type for all specific events
export type SpecificWorkspaceEvent =
  | FileChangedEvent
  | AgentToolCallEvent
  | AgentMessageEvent
  | AgentFailedEvent
  | GitOperationEvent
  | NoteChangedEvent
  | TaskStatusChangedEvent
  | ReadyTasksChangedEvent
  | TerminalCommandEvent
  | TestEvent
  | BuildEvent
  // Agent interaction events
  | AgentCreatedEvent
  | AgentDeletedEvent
  | AgentRestoredEvent
  | AgentRenamedEvent
  | AgentStartedEvent
  | AgentIdleEvent
  | AgentStatusChangedEvent
  | AgentMessageSentEvent
  | AgentMessageReceivedEvent
  | AgentSubscribedEvent
  | AgentUnsubscribedEvent
  | AgentWokenBySubscriptionEvent
  | AgentDeliveryConfirmedEvent
  | AgentEventDeliveryFailedEvent
  | AgentEventDeliveryTimeoutEvent
  | AgentSubscriptionsRestoredEvent
  | AgentSubscriptionsChangedEvent
  // Agent process-registry events
  | AgentProcessQueuedEvent
  | AgentProcessResumedEvent
  | AgentProcessEvictedEvent
  | AgentMessageDeliveryFailedEvent
  // Agent queue events (for WebSocket API)
  | AgentQueueUpdatedEvent
  | AgentQueueProcessingEvent
  | AgentQueueProcessingCancelledEvent
  | AgentQueueStaleMessageEvent
  // MCP events
  | McpNotificationEvent
  // Agent streaming events
  | AgentStreamStartEvent
  | AgentStreamChunkEvent
  | AgentStreamContentBlocksEvent
  | AgentStreamEndEvent
  // Agent user message events (cross-client sync)
  | AgentUserMessageSentEvent
  // Agent session stats (PROTOCOL §5.24)
  | AgentSessionStatsChangedEvent;

// Main WorkspaceEvent type - includes legacy fields for backward compatibility
export interface WorkspaceEvent extends WorkspaceEventBase {
  // Legacy fields from shared/types.ts
  title?: string;
  description?: string;
  relatedChatMessageId?: string;
  relatedAgentId?: string;
  relatedToolCallId?: string;
  data?: any;
  codeChange?: CodeChange;
  agentId?: string;
  exchangeId?: string;
  provenance?: ProvenanceInfo;
}

// Code change type (legacy from shared/types.ts)
export interface CodeChange {
  id: string;
  fileName: string;
  filePath: string;
  type: 'add' | 'delete' | 'modify' | 'rename';
  additions: number;
  deletions: number;
  diff?: string;
  oldContent?: string;
  newContent?: string;
  oldContentSha?: string;
  newContentSha?: string;
  staged?: boolean;
}

// Provenance information
export interface ProvenanceInfo {
  source: 'agent' | 'user' | 'git' | 'system' | 'external';
  agent?: {
    name: string;
    id: string;
    sessionId?: string;
    model?: string;
    temperature?: number;
  };
  chat?: {
    messageId?: string;
    threadId?: string;
    turnNumber?: number;
  };
  execution?: {
    toolCallId?: string;
    timestamp?: string;
  };
}

// Filter types
export type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'less_than'
  | 'starts_with'
  | 'ends_with'
  | 'contains'
  | 'matches'
  | 'in'
  | 'not_in';

export interface EventFilter {
  field: string;
  operator: FilterOperator;
  value: any;
}

// Subscription types
export interface SubscribeOptions<T extends WorkspaceEvent = WorkspaceEvent> {
  filters?: EventFilter[];
  callback: (event: T) => void;
  includeHistorical?: boolean;
  historicalLimit?: number;
}

export interface EventSubscription {
  id: string;
  filters: EventFilter[];
  callback: (event: WorkspaceEvent) => void;
  includeHistorical?: boolean;
  unsubscribe?: () => void;
}

// Query types
export interface QueryOptions {
  filters: EventFilter[];
  sort?: {
    field: string;
    order: 'asc' | 'desc';
  };
  limit?: number;
  offset?: number;
}

export interface QueryResult<T extends WorkspaceEvent = WorkspaceEvent> {
  events: T[];
  total: number;
  hasMore: boolean;
}

// Aggregation types
export interface AggregationOptions {
  groupBy: string;
  metrics: AggregationMetric[];
  filters?: EventFilter[];
}

export interface AggregationMetric {
  field: string;
  operation: 'count' | 'sum' | 'avg' | 'min' | 'max';
  alias?: string;
}

export interface AggregationResult {
  groups: Array<{
    key: string;
    metrics: Record<string, number>;
    events?: WorkspaceEvent[];
  }>;
}

// Event correlation
export interface EventCorrelation {
  correlationId: string;
  rootEventId: string;
  events: WorkspaceEvent[];
  startTime: string;
  endTime?: string;
  status: 'active' | 'completed' | 'failed';
}

// Type guards
export function isFileChangedEvent(event: WorkspaceEvent): event is FileChangedEvent {
  return event.type === 'file:changed';
}

export function isAgentToolCallEvent(event: WorkspaceEvent): event is AgentToolCallEvent {
  return event.type === 'agent:tool:call';
}

export function isAgentMessageEvent(event: WorkspaceEvent): event is AgentMessageEvent {
  return event.type === 'agent:message';
}

export function isGitOperationEvent(event: WorkspaceEvent): event is GitOperationEvent {
  return event.type.startsWith('git:');
}

export function isNoteChangedEvent(event: WorkspaceEvent): event is NoteChangedEvent {
  return event.type.startsWith('note:');
}

export function isTaskStatusChangedEvent(event: WorkspaceEvent): event is TaskStatusChangedEvent {
  return event.type === 'task:status-changed';
}

export function isReadyTasksChangedEvent(event: WorkspaceEvent): event is ReadyTasksChangedEvent {
  return event.type === 'task:ready-tasks-changed';
}

// Helper types
export interface EventStatistics {
  totalEvents: number;
  eventsByType: Record<WorkspaceEventType, number>;
  eventsByActor: Record<ActorType, number>;
  eventsPerHour: number[];
  topFiles: Array<{ path: string; changeCount: number }>;
  topAgents: Array<{ name: string; eventCount: number }>;
}

// Additional type guards for missing event types
export function isTerminalCommandEvent(event: WorkspaceEvent): event is TerminalCommandEvent {
  return event.type === 'terminal:command';
}

export function isTestEvent(event: WorkspaceEvent): event is TestEvent {
  return event.type.startsWith('test:');
}

export function isBuildEvent(event: WorkspaceEvent): event is BuildEvent {
  return event.type.startsWith('build:');
}

// Type guards for agent interaction events
export function isAgentCreatedEvent(event: WorkspaceEvent): event is AgentCreatedEvent {
  return event.type === 'agent:created';
}

export function isAgentDeletedEvent(event: WorkspaceEvent): event is AgentDeletedEvent {
  return event.type === 'agent:deleted';
}

export function isAgentRestoredEvent(event: WorkspaceEvent): event is AgentRestoredEvent {
  return event.type === 'agent:restored';
}

export function isAgentIdleEvent(event: WorkspaceEvent): event is AgentIdleEvent {
  return event.type === 'agent:idle';
}

export function isAgentStatusChangedEvent(event: WorkspaceEvent): event is AgentStatusChangedEvent {
  return event.type === 'agent:status-changed';
}

export function isAgentMessageSentEvent(event: WorkspaceEvent): event is AgentMessageSentEvent {
  return event.type === 'agent:message:sent';
}

export function isAgentMessageReceivedEvent(
  event: WorkspaceEvent,
): event is AgentMessageReceivedEvent {
  return event.type === 'agent:message:received';
}

export function isAgentSubscribedEvent(event: WorkspaceEvent): event is AgentSubscribedEvent {
  return event.type === 'agent:subscribed';
}

export function isAgentUnsubscribedEvent(event: WorkspaceEvent): event is AgentUnsubscribedEvent {
  return event.type === 'agent:unsubscribed';
}

export function isAgentSessionStatsChangedEvent(
  event: WorkspaceEvent,
): event is AgentSessionStatsChangedEvent {
  return event.type === 'agent:session-stats-changed';
}

/**
 * Check if an event is any agent interaction event
 */
export function isAgentInteractionEvent(event: WorkspaceEvent): boolean {
  return (
    event.type === 'agent:created' ||
    event.type === 'agent:deleted' ||
    event.type === 'agent:restored' ||
    event.type === 'agent:idle' ||
    event.type === 'agent:status-changed' ||
    event.type === 'agent:message:sent' ||
    event.type === 'agent:message:received' ||
    event.type === 'agent:subscribed' ||
    event.type === 'agent:unsubscribed' ||
    event.type === 'agent:woken-by-subscription' ||
    event.type === 'agent:delivery-confirmed' ||
    event.type === 'agent:event-delivery-failed' ||
    event.type === 'agent:event-delivery-timeout' ||
    event.type === 'agent:subscriptions-changed' ||
    event.type === 'agent:message:delivery-failed'
  );
}

export function isAgentWokenBySubscriptionEvent(
  event: WorkspaceEvent,
): event is AgentWokenBySubscriptionEvent {
  return event.type === 'agent:woken-by-subscription';
}

export function isAgentDeliveryConfirmedEvent(
  event: WorkspaceEvent,
): event is AgentDeliveryConfirmedEvent {
  return event.type === 'agent:delivery-confirmed';
}

export function isAgentEventDeliveryFailedEvent(
  event: WorkspaceEvent,
): event is AgentEventDeliveryFailedEvent {
  return event.type === 'agent:event-delivery-failed';
}

export function isAgentMessageDeliveryFailedEvent(
  event: WorkspaceEvent,
): event is AgentMessageDeliveryFailedEvent {
  return event.type === 'agent:message:delivery-failed';
}

export function isMcpNotificationEvent(event: WorkspaceEvent): event is McpNotificationEvent {
  return event.type === 'mcp:notification';
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalize an actor object to ensure all required fields are present.
 * Handles partial actor objects by filling in defaults.
 */
export function normalizeActor(actor: Partial<EventActor> & { type: ActorType }): EventActor {
  return {
    type: actor.type,
    id: actor.id || generateEventId(),
    name: actor.name || (actor.type === 'system' ? 'System' : 'Unknown'),
    email: actor.email,
    model: actor.model,
    metadata: actor.metadata || {},
  };
}

/**
 * Create a workspace event with defaults
 */
export function createWorkspaceEvent(
  type: WorkspaceEventType,
  workspaceId: string,
  actor: Partial<EventActor> & { type: ActorType },
  data?: any,
  metadata?: Record<string, any>,
): WorkspaceEvent {
  return {
    id: generateEventId(),
    workspaceId,
    timestamp: new Date().toISOString(),
    type,
    actor: normalizeActor(actor),
    data,
    metadata: metadata || {},
  };
}

/**
 * Generate a unique event ID
 */
export function generateEventId(): string {
  // Use timestamp + random for uniqueness
  return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Convert event type - now just validates the type
 * (Previously converted from enum to string literal, but enum has been removed)
 */
export function convertEventType(type: WorkspaceEventType): WorkspaceEventType {
  // Simply return the type as-is since we no longer have enums
  return type;
}

// ============================================================================
// IPC Event Payload Types
// ============================================================================
//
// These types describe the data structure received by listenSync handlers
// in the renderer process. IPC events can arrive in two formats:
//
// 1. Direct IPC (flat): `window.webContents.send('event', { field1, field2 })`
//    - Handler receives: `{ payload: { field1, field2 } }`
//
// 2. Redux event dispatch (wrapped): workspace events dispatched via Redux actions
//    - Handler receives: `{ payload: WorkspaceEvent }`
//
// Use these types with extractEventData() to safely handle both formats.
// ============================================================================

/**
 * IPC payload for agent:deleted events
 *
 * @example
 * listenSync('agent:deleted', (event: IpcEventWrapper<AgentDeletedPayload>) => {
 *   const agentId = extractEventData<string>(event, 'agentId');
 * });
 */
export interface AgentDeletedPayload {
  agentId: string;
  agentName?: string;
  workspaceId?: string;
  taskNoteId?: string;
  reason?: 'user_action' | 'workspace_deleted' | 'cleanup';
}

/**
 * IPC payload for agent:restored events.
 *
 * Emitted as a compensating event when a durable delete fails after the
 * early `agent:deleted` broadcast. Carries the full cached session so
 * renderers can re-add the agent exactly as it was on disk.
 */
export interface AgentRestoredPayload {
  agentId: string;
  agentName?: string;
  workspaceId: string;
  /** Full cached session snapshot captured before the failed delete */
  session: unknown;
  taskNoteId?: string;
  isBackground?: boolean;
  parentAgentId?: string;
  reason?: 'delete_failed';
  error?: string;
}

/**
 * IPC payload for agent:renamed events
 */
export interface AgentRenamedPayload {
  agentId: string;
  workspaceId: string;
  name: string;
}

/**
 * IPC payload for agent:created events
 */
export interface AgentCreatedPayload {
  agentId: string;
  agentName: string;
  workspaceId: string;
  model?: string;
  createdByAgentId?: string;
  taskNoteId?: string;
  initialMessage?: string;
}

/**
 * IPC payload for agent:subscribed events
 */
export interface AgentSubscribedPayload {
  agentId: string;
  agentName?: string;
  workspaceId?: string;
  subscriptionId: string;
  eventTypes?: string[];
  filterDescription?: string;
}

/**
 * IPC payload for agent:unsubscribed events
 */
export interface AgentUnsubscribedPayload {
  agentId: string;
  agentName?: string;
  workspaceId?: string;
  subscriptionId: string;
  /** Reason for unsubscription */
  reason?: 'manual-unsubscribe' | 'oneshot-fired' | 'delegation-complete';
  /** Group ID if this was a delegation group subscription */
  groupId?: string;
}

/**
 * IPC payload for agent:idle events
 */
export interface AgentIdlePayload extends CanonicalAgentStatusFields {
  agentId: string;
  agentName?: string;
  workspaceId?: string;
  reason?: 'stream_complete' | 'interrupted' | 'error' | 'timeout';
  finishReason?: string;
  messageCount?: number;
  lastResponseDuration?: number;
  lastResponseSummary?: string;
  taskNoteId?: string;
  isBackground?: boolean;
  completionReport?: string;
  parentAgentId?: string;
  respondingToMessageId?: string;
}

/**
 * IPC payload for raw agent:status events
 */
export interface AgentStatusPayload extends Omit<CanonicalAgentStatusFields, 'status'> {
  agentId: string;
  workspaceId?: string;
  status: string;
}

/**
 * IPC payload for agent:status-changed events
 */
export interface AgentStatusChangedPayload extends Omit<CanonicalAgentStatusFields, 'status'> {
  agentId: string;
  workspaceId?: string;
  previousStatus?: 'idle' | 'responding' | 'waiting' | 'completed' | 'failed';
  status: 'idle' | 'responding' | 'waiting' | 'completed' | 'failed';
}

/**
 * IPC payload for agent:woken-by-subscription events
 */
export interface AgentWokenBySubscriptionPayload {
  agentId: string;
  agentName?: string;
  workspaceId?: string;
  eventCount: number;
  eventTypes: string[];
}

/**
 * IPC payload for agent:delivery-confirmed events
 */
export interface AgentDeliveryConfirmedPayload {
  subscriberAgentId: string;
  workspaceId?: string;
  deliveredEventIds: string[];
  subscriptionId?: string;
}

/**
 * IPC payload for agent:event-delivery-failed events
 */
export interface AgentEventDeliveryFailedPayload {
  targetAgentId: string;
  workspaceId?: string;
  eventCount: number;
  eventTypes: string[];
  error: string;
}

/**
 * IPC payload for agent:event-delivery-timeout events
 */
export interface AgentEventDeliveryTimeoutPayload {
  targetAgentId: string;
  workspaceId?: string;
  eventCount: number;
  eventTypes: string[];
  timeoutMs: number;
}

/**
 * IPC payload for agent:subscriptions-restored events
 */
export interface AgentSubscriptionsRestoredPayload {
  workspaceId?: string;
  count?: number;
  agentIds: string[];
}

/**
 * IPC payload for agent:subscriptions-changed events
 */
export interface AgentSubscriptionsChangedPayload {
  agentId?: string;
  workspaceId?: string;
  subscriptionVersion: number;
  reason?: string;
}

/**
 * IPC payload for note:created events
 */
export interface NoteCreatedPayload {
  workspaceId: string;
  noteId: string;
  note?: {
    id: string;
    title?: string;
    content?: string;
    path?: string;
  };
}

/**
 * IPC payload for note:updated events
 */
export interface NoteUpdatedPayload {
  workspaceId: string;
  noteId: string;
  content?: string;
  title?: string;
  changes?: {
    content?: string;
    title?: string;
  };
  /** Origin of the update — "agent" for agent-driven changes, "external" otherwise. */
  source?: 'agent' | 'external';
}

/**
 * IPC payload for note:deleted events
 */
export interface NoteDeletedPayload {
  workspaceId: string;
  noteId: string;
}

/**
 * IPC payload for task:status-changed events
 */
export interface TaskStatusChangedPayload {
  workspaceId: string;
  noteId: string;
  previousStatus?: string;
  newStatus: string;
  changedAt?: string;
  agentId?: string;
}

/**
 * IPC payload for task:ready-tasks-changed events
 */
export interface TaskReadyTasksChangedPayload {
  workspaceId: string;
  data: {
    readyTaskIds: string[];
    triggeredBy?: {
      noteId: string;
      previousStatus?: string;
      newStatus?: string;
    };
    computedAt?: string;
  };
}

/**
 * Wrapper type for IPC events received by listenSync handlers.
 * listenSync always wraps the incoming data in { payload: T }.
 */
export interface IpcEventWrapper<T = any> {
  payload: T;
}

/**
 * Union type representing all possible IPC event payloads for agent events.
 * This is useful for creating type-safe event handling maps.
 */
export type AgentEventPayload =
  | AgentCreatedPayload
  | AgentDeletedPayload
  | AgentRestoredPayload
  | AgentRenamedPayload
  | AgentSubscribedPayload
  | AgentUnsubscribedPayload
  | AgentIdlePayload
  | AgentStatusPayload
  | AgentStatusChangedPayload
  | AgentWokenBySubscriptionPayload
  | AgentDeliveryConfirmedPayload
  | AgentEventDeliveryFailedPayload
  | AgentEventDeliveryTimeoutPayload
  | AgentSubscriptionsRestoredPayload
  | AgentSubscriptionsChangedPayload;

/**
 * Union type representing all possible IPC event payloads for note events.
 */
export type NoteEventPayload = NoteCreatedPayload | NoteUpdatedPayload | NoteDeletedPayload;

/**
 * Union type representing all possible IPC event payloads for task events.
 */
export type TaskEventPayload = TaskStatusChangedPayload | TaskReadyTasksChangedPayload;

// ============================================================================
// Domain Event Types (moved from unified-event-bus.ts during Redux migration)
// ============================================================================

import type { WorkspaceId } from '../../shared/types';

/**
 * Domain events that can be emitted (simple broadcast events)
 */
export type DomainEvent =
  // Workspace events
  | 'workspace:created'
  | 'workspace:updated'
  | 'workspace:deleting'
  | 'workspace:deleted'
  | 'workspace:archived'
  | 'workspace:file-changes'
  // Note events
  | 'note:created'
  | 'note:updated'
  | 'note:deleted'
  | 'line-attribution:updated'
  // Comment events
  | 'comment:added'
  | 'comment:updated'
  | 'comment:deleted'
  | 'comment:resolved'
  | 'comment:status-changed'
  | 'comment:updated-batch'
  // Agent events
  | 'agent:session-created'
  | 'agent:session-updated'
  | 'agent:session-completed'
  // Git events
  | 'git:commit-created'
  | 'git:branch-changed'
  | 'git:auth-required'
  | 'github:auth-required'
  | 'git:status-changed'
  // Agent auth/error events
  | 'agent:auth-required'
  | 'agent:remote-error'
  | 'agent:plan-required'
  // Terminal events
  | 'terminal:created'
  | 'terminal:data'
  | 'terminal:exit'
  | 'terminal:error'
  | 'terminal:disposed'
  // Professional Terminal events
  | 'terminal:professional:data'
  | 'terminal:professional:exit'
  | 'terminal:professional:command:start'
  | 'terminal:professional:command:executed'
  | 'terminal:professional:command:finished'
  | 'terminal:professional:cwd:changed'
  // Source events
  | 'source:created'
  | 'source:updated'
  | 'source:deleted'
  // Auto-commit events
  | 'git:auto-commit-started'
  | 'git:auto-commit-succeeded'
  | 'git:auto-commit-hook-failure'
  // Background git operations events
  | 'git:op-started'
  | 'git:op-progress'
  | 'git:op-completed'
  | 'git:op-failed'
  // Log events
  | 'log:events-updated'
  // Script events
  | 'script:started'
  | 'script:stopped'
  | 'script:output'
  | 'script:error'
  | 'script:url-detected';

/**
 * Domain event data payloads
 */
export interface DomainEventPayloads {
  'workspace:created': { workspaceId: WorkspaceId; workspace: any; initialAgent?: any };
  'workspace:updated': { workspaceId: WorkspaceId; changes: any };
  'workspace:deleting': { workspaceId: WorkspaceId };
  'workspace:deleted': { workspaceId: WorkspaceId };
  'workspace:archived': { workspaceId: WorkspaceId };
  'workspace:file-changes': { workspaceId: WorkspaceId; changes?: any; diffChunk?: any };

  'note:created': { workspaceId: WorkspaceId; noteId: string; note: any; actor?: any };
  'note:updated': {
    workspaceId: WorkspaceId;
    noteId: string;
    title?: string;
    changes: any;
    actor?: { type: string; id: string; name: string; turnNumber?: number; messageId?: string };
    sessionId?: string;
  };
  'note:deleted': { workspaceId: WorkspaceId; noteId: string; actor?: any };
  'line-attribution:updated': {
    workspaceId: WorkspaceId;
    noteId: string;
    attributions: Record<
      number,
      {
        timestamp: number;
        author?: { id: string; name: string; type: 'user' | 'agent' | 'system' };
      }
    >;
  };

  'comment:added': { workspaceId: WorkspaceId; noteId: string; comment: any };
  'comment:updated': { workspaceId: WorkspaceId; noteId: string; commentId: string; changes: any };
  'comment:deleted': { workspaceId: WorkspaceId; noteId: string; commentId: string };
  'comment:resolved': { workspaceId: WorkspaceId; noteId: string; commentId: string };
  'comment:status-changed': {
    workspaceId: WorkspaceId;
    noteId: string;
    commentId: string;
    status: string;
  };
  'comment:updated-batch': {
    workspaceId: WorkspaceId;
    noteId: string;
    action?: 'added' | 'updated' | 'resolved' | 'deleted';
    comment?: any;
    comments?: any;
  };

  'agent:session-created': { workspaceId: WorkspaceId; sessionId: string };
  'agent:session-updated': {
    workspaceId: WorkspaceId;
    sessionId: string;
    agentId?: string;
  } & CanonicalAgentStatusFields;
  'agent:session-completed': {
    workspaceId: WorkspaceId;
    sessionId: string;
    agentId?: string;
  } & CanonicalAgentStatusFields;

  'git:commit-created': {
    workspaceId: WorkspaceId;
    commitSha: string;
    postCommitHandled?: boolean;
  };
  'git:branch-changed': { workspaceId: WorkspaceId; branch: string };
  'git:auth-required': {
    workspaceId?: WorkspaceId;
    operation: string;
    remote?: string;
    message: string;
    rawError?: string;
    command?: string;
    cwd?: string;
  };
  'github:auth-required': {
    workspaceId?: WorkspaceId;
    operation?: string;
    message: string;
  };
  'git:status-changed': { workspaceId: WorkspaceId };

  'agent:auth-required': {
    workspaceId?: WorkspaceId;
    agentId?: string;
    isRemote: boolean;
    host?: string;
    message: string;
  };
  'agent:remote-error': {
    workspaceId?: WorkspaceId;
    agentId?: string;
    errorType: 'connection' | 'authentication' | 'command-not-found' | 'unknown';
    message: string;
    details?: string;
  };
  'agent:plan-required': {
    workspaceId?: WorkspaceId;
    agentId?: string;
    message: string;
    helpUrl?: string;
  };

  'terminal:created': {
    terminalId: string;
    workspaceId: WorkspaceId;
    title: string;
    cwd: string;
    createdAt: string;
    background?: boolean;
  };
  'terminal:data': { terminalId: string; data: string };
  'terminal:exit': { terminalId: string; code: number | null; signal: string | null };
  'terminal:error': { terminalId: string; error: string };
  'terminal:disposed': { terminalId: string; workspaceId: WorkspaceId };

  'terminal:professional:data': { terminalId: string; data: string };
  'terminal:professional:exit': {
    terminalId: string;
    exitCode: number | null;
    signal: string | null;
  };
  'terminal:professional:command:start': { terminalId: string };
  'terminal:professional:command:executed': { terminalId: string; command: string };
  'terminal:professional:command:finished': { terminalId: string };
  'terminal:professional:cwd:changed': { terminalId: string; cwd: string };

  'source:created': { workspaceId: WorkspaceId; sourceId: string; source: any };
  'source:updated': { workspaceId: WorkspaceId; sourceId: string; source: any };
  'source:deleted': { workspaceId: WorkspaceId; sourceId: string };

  'git:auto-commit-started': {
    workspaceId: WorkspaceId;
    agentId: string;
    agentName?: string;
  };
  'git:auto-commit-succeeded': {
    workspaceId: WorkspaceId;
    agentId: string;
    agentName?: string;
    hash: string;
    message: string;
    fileCount: number;
  };
  'git:auto-commit-hook-failure': {
    workspaceId: WorkspaceId;
    agentId: string;
    agentName?: string;
    status: 'waking-agent' | 'retries-exhausted';
    hookOutput: string;
    retryCount: number;
  };

  'git:op-started': {
    operationId: string;
    workspaceId: WorkspaceId;
    operationType: 'commit' | 'push' | 'create-pr' | 'auto-commit';
    metadata?: { message?: string; prTitle?: string; agentId?: string; agentName?: string };
  };
  'git:op-progress': {
    operationId: string;
    workspaceId: WorkspaceId;
    operationType: 'commit' | 'push' | 'create-pr' | 'auto-commit';
    step: string;
    metadata?: { message?: string; prTitle?: string };
  };
  'git:op-completed': {
    operationId: string;
    workspaceId: WorkspaceId;
    operationType: 'commit' | 'push' | 'create-pr' | 'auto-commit';
    result?: {
      commitHash?: string;
      prNumber?: number;
      prUrl?: string;
      noChanges?: boolean;
      reason?: string;
      fileCount?: number;
    };
    metadata?: { message?: string; prTitle?: string; agentId?: string; agentName?: string };
  };
  'git:op-failed': {
    operationId: string;
    workspaceId: WorkspaceId;
    operationType: 'commit' | 'push' | 'create-pr' | 'auto-commit';
    error: string;
    metadata?: { message?: string; prTitle?: string; agentId?: string; agentName?: string };
  };

  'log:events-updated': { workspaceId: WorkspaceId; events: any };

  'script:started': {
    workspaceId: WorkspaceId;
    scriptId: string;
    scriptName: string;
    pid?: number;
    startedAt?: string;
  };
  'script:stopped': {
    workspaceId: WorkspaceId;
    scriptId: string;
    scriptName: string;
    exitCode?: number | null;
    signal?: string | null;
    stoppedAt?: string;
  };
  'script:output': {
    workspaceId: WorkspaceId;
    scriptId: string;
    lines: Array<{ text: string; stream: 'stdout' | 'stderr'; timestamp: string }>;
  };
  'script:error': {
    workspaceId: WorkspaceId;
    scriptId: string;
    scriptName: string;
    error: string;
  };
  'script:url-detected': {
    workspaceId: WorkspaceId;
    scriptId: string;
    scriptName: string;
    url: string;
  };
}
