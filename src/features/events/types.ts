/**
 * Type definitions for the Workspace Event System
 *
 * This is the single source of truth for all event types in the workspace.
 * All event-related types should be imported from this file.
 */

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
  /**
   * ISO timestamp of when the terminal stop/failure occurred. Accompanies
   * `stopReason` on terminal lifecycle events; optional on the wire (older
   * daemons omit it).
   */
  stopReasonTimestamp?: string | null;
  /**
   * Derived corrupted/poisoned-session flag (monorepo#940). Present (`true`)
   * only on the terminal-failure `agent:status-changed` when the failure
   * classifies as session-fatal; omitted otherwise (absent ≠ present-false on
   * the wire) and on older daemons.
   */
  sessionCorrupted?: boolean;
  /**
   * Idle-visibility for hook-owning agents (PROTOCOL §3.1, within v3.1,
   * additive): light metadata for the agent's ACTIVE (`scheduled`/`running`)
   * background hooks (§5.40) — omitted when empty (absent, never `[]`) — so
   * a parent or client can tell a hook-waiting idle agent from a stalled
   * one. Rendered verbatim.
   */
  waitingOnHooks?: Array<{ hookId: string; name: string; nextRunAt?: string; expiresAt?: string }>;
  /**
   * Idle-visibility for PR-monitor-owning agents — the `waitingOnHooks`
   * companion for centralized PR monitoring (§5.42): light metadata for the
   * agent's active PR monitors, omitted when empty (absent, never `[]`), so
   * a parent or client can tell a PR-monitor-waiting idle agent from a
   * stalled one. Rendered verbatim.
   */
  waitingOnPrMonitors?: Array<{
    monitorId: string;
    repo: string;
    prNumber: number;
    title?: string;
  }>;
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
  AgentRetired: 'agent:retired',
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
  AgentStreamActivity: 'agent:stream:activity',
  AgentStreamEnd: 'agent:stream:end',

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

  // Script events (PROTOCOL §6.5)
  ScriptState: 'script:state',
  ScriptOutput: 'script:output',

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
  DisplayStatusChanged: 'workspace:displayStatus-changed',

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

interface WorkspaceEventBase {
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
    /** Turn-correlation id stamped on the user-row echo (PROTOCOL §6.6); omitted when absent. */
    turnId?: string;
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
    /** Whether the agent's workspace is archived; additive — absent on older daemons (treat absent as not archived) */
    workspaceArchived?: boolean;
    /** Whether the agent is awaiting delegated sub-agents (pending completion watches); absent on older daemons */
    isWaitingForOtherAgents?: boolean;
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
interface ProvenanceInfo {
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

export function isAgentIdleEvent(event: WorkspaceEvent): event is AgentIdleEvent {
  return event.type === 'agent:idle';
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
 * IPC payload for raw agent:status events
 */
export interface AgentStatusPayload extends Omit<CanonicalAgentStatusFields, 'status'> {
  agentId: string;
  workspaceId?: string;
  status: string;
}

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
  | 'git:op-failed';

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
}
