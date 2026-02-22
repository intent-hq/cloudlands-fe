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
  AgentIdle: 'agent:idle',
  AgentStatusChanged: 'agent:status-changed',
  AgentMessageSent: 'agent:message:sent',
  AgentMessageReceived: 'agent:message:received',
  AgentSubscribed: 'agent:subscribed',
  AgentUnsubscribed: 'agent:unsubscribed',
  AgentWokenBySubscription: 'agent:woken-by-subscription',
  AgentEventDeliveryFailed: 'agent:event-delivery-failed',
  AgentSubscriptionsRestored: 'agent:subscriptions-restored',
  AgentMessageDeliveryFailed: 'agent:message:delivery-failed',

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

export interface FileCreatedEvent extends WorkspaceEventBase {
  type: 'file:created';
  data: {
    path: string;
    relativePath: string;
    content?: string;
    size?: number;
    language?: string;
  };
}

export interface FileDeletedEvent extends WorkspaceEventBase {
  type: 'file:deleted';
  data: {
    path: string;
    relativePath: string;
  };
}

export interface FileRenamedEvent extends WorkspaceEventBase {
  type: 'file:renamed';
  data: {
    oldPath: string;
    newPath: string;
    relativePath: string;
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
  };
}

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
  };
}

/**
 * Emitted when an agent's status changes (idle, responding, waiting, completed, failed)
 */
export interface AgentStatusChangedEvent extends WorkspaceEventBase {
  type: 'agent:status-changed';
  data: {
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
    priority: 'high' | 'normal';
  };
}

/**
 * Emitted when an agent receives a message from another agent
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

// Union type for all specific events
export type SpecificWorkspaceEvent =
  | FileChangedEvent
  | FileCreatedEvent
  | FileDeletedEvent
  | FileRenamedEvent
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
  | AgentIdleEvent
  | AgentStatusChangedEvent
  | AgentMessageSentEvent
  | AgentMessageReceivedEvent
  | AgentSubscribedEvent
  | AgentUnsubscribedEvent
  | AgentWokenBySubscriptionEvent
  | AgentEventDeliveryFailedEvent
  | AgentSubscriptionsRestoredEvent
  | AgentMessageDeliveryFailedEvent;

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

/**
 * Check if an event is any agent interaction event
 */
export function isAgentInteractionEvent(event: WorkspaceEvent): boolean {
  return (
    event.type === 'agent:created' ||
    event.type === 'agent:deleted' ||
    event.type === 'agent:idle' ||
    event.type === 'agent:status-changed' ||
    event.type === 'agent:message:sent' ||
    event.type === 'agent:message:received' ||
    event.type === 'agent:subscribed' ||
    event.type === 'agent:unsubscribed' ||
    event.type === 'agent:woken-by-subscription' ||
    event.type === 'agent:event-delivery-failed' ||
    event.type === 'agent:message:delivery-failed'
  );
}

export function isAgentWokenBySubscriptionEvent(
  event: WorkspaceEvent,
): event is AgentWokenBySubscriptionEvent {
  return event.type === 'agent:woken-by-subscription';
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
// 2. WorkspaceEventBus (wrapped): `eventBus.broadcastToRenderer(workspaceEvent)`
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
  subscriptionId: string;
  /** Reason for unsubscription */
  reason?: 'manual-unsubscribe' | 'oneshot-fired' | 'delegation-complete';
  /** Group ID if this was a delegation group subscription */
  groupId?: string;
}

/**
 * IPC payload for agent:idle events
 */
export interface AgentIdlePayload {
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
}

/**
 * IPC payload for agent:status-changed events
 */
export interface AgentStatusChangedPayload {
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
  eventCount: number;
  eventTypes: string[];
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
  | AgentRenamedPayload
  | AgentSubscribedPayload
  | AgentUnsubscribedPayload
  | AgentIdlePayload
  | AgentStatusChangedPayload
  | AgentWokenBySubscriptionPayload;

/**
 * Union type representing all possible IPC event payloads for note events.
 */
export type NoteEventPayload = NoteCreatedPayload | NoteUpdatedPayload | NoteDeletedPayload;

/**
 * Union type representing all possible IPC event payloads for task events.
 */
export type TaskEventPayload = TaskStatusChangedPayload | TaskReadyTasksChangedPayload;
