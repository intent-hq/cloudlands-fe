/**
 * Agent Overview Visualization Types
 *
 * Types for the force-directed graph visualization showing agents,
 * their delegations, and interactions with files/notes.
 */

import type { TaskStatus } from '$shared/types';

// ============================================================================
// Node Types
// ============================================================================

type NodeType = 'agent' | 'file' | 'note' | 'task';

interface BaseNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number | null; // Fixed position for coordinator
  fy?: number | null;
}

export interface AgentNode extends BaseNode {
  type: 'agent';
  agentId: string;
  name: string;
  isCoordinator: boolean;
  isBackground?: boolean;
  status: 'idle' | 'responding' | 'waiting' | 'completed' | 'failed';
  specialist?: string | null;
  parentAgentId?: string | null;
  /** Canonical task note assigned to this agent, when present. */
  taskNoteId?: string | null;
  createdAt: string;
  /** IDs of agents this agent is waiting for (subscriptions) */
  waitingForAgentIds?: string[];
  /** Name of the currently active tool call */
  activeToolName?: string;
  /** Input parameters of the currently active tool call */
  activeToolInput?: Record<string, unknown>;
  /** Last meaningful response line from the agent */
  lastResponse?: string;
  /** Agent type (e.g., 'commit-message', 'pr-description', 'code-review') */
  agentType?: string | null;
  /** Batch ID grouping children created in the same parent response */
  delegationBatchId?: string | null;
}

export interface FileNode extends BaseNode {
  type: 'file';
  path: string;
  fileName: string;
  lastAction: 'read' | 'write' | 'create' | 'delete' | 'modify';
  lastActionTimestamp: string;
}

export interface NoteNode extends BaseNode {
  type: 'note';
  noteId: string;
  title: string;
  lastAction: 'read' | 'write' | 'create' | 'update';
  lastActionTimestamp: string;
}

export interface TaskNode extends BaseNode {
  type: 'task';
  taskId: string;
  title: string;
  description?: string;
  state: TaskStatus;
  dependsOn: string[];
  lastAction?: 'create' | 'update' | 'read';
  lastActionTimestamp?: string;
}

export type GraphNode = AgentNode | FileNode | NoteNode | TaskNode;

// ============================================================================
// Edge Types
// ============================================================================

type EdgeType =
  | 'delegation'
  | 'task-assignment'
  | 'message'
  | 'waiting-on'
  | 'file-read'
  | 'file-write'
  | 'note-read'
  | 'note-write'
  | 'task-create'
  | 'task-update';

interface BaseEdge {
  id: string;
  type: EdgeType;
  sourceId: string;
  targetId: string;
  timestamp: string;
  isActive: boolean; // Currently happening
  /** Number of interactions represented by this de-duplicated edge. */
  count?: number;
  /** Number of line additions (for write edges) */
  additions?: number;
  /** Number of line deletions (for write edges) */
  deletions?: number;
}

interface DelegationEdge extends BaseEdge {
  type: 'delegation';
  parentAgentId: string;
  childAgentId: string;
}

interface FileInteractionEdge extends BaseEdge {
  type: 'file-read' | 'file-write';
  agentId: string;
  filePath: string;
  count: number;
}

interface NoteInteractionEdge extends BaseEdge {
  type: 'note-read' | 'note-write';
  agentId: string;
  noteId: string;
  count: number;
}

interface TaskInteractionEdge extends BaseEdge {
  type: 'task-create' | 'task-update';
  agentId: string;
  taskId: string;
}

interface TaskAssignmentEdge extends BaseEdge {
  type: 'task-assignment';
  agentId: string;
  taskId: string;
}

interface MessageEdge extends BaseEdge {
  type: 'message';
  senderAgentId: string;
  receiverAgentId: string;
  count: number;
}

interface WaitingOnEdge extends BaseEdge {
  type: 'waiting-on';
  waiterAgentId: string;
  targetAgentId: string;
  count: number;
}

export type GraphEdge =
  | DelegationEdge
  | TaskAssignmentEdge
  | MessageEdge
  | WaitingOnEdge
  | FileInteractionEdge
  | NoteInteractionEdge
  | TaskInteractionEdge;

// ============================================================================
// Graph State
// ============================================================================

export interface GraphState {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    agents: { active: number; total: number };
    tasks: Record<TaskStatus, number>;
    files: number;
    notes: number;
  };
  /** Current time position for scrubbing (ISO string) */
  currentTime: string;
  /** Whether playing live updates */
  isLive: boolean;
  /** Min time in the event log */
  minTime: string;
  /** Max time in the event log */
  maxTime: string;
  /** Full event-log timestamps used to render timeline activity ticks. */
  eventTimes?: string[];
}

// ============================================================================
// Interaction Event (from activity log)
// ============================================================================

export interface InteractionEvent {
  id: string;
  timestamp: string;
  type:
    | 'agent-created'
    | 'agent-idle'
    | 'file-read'
    | 'file-write'
    | 'note-read'
    | 'note-write'
    | 'task-update'
    | 'agent-message'
    | 'agent-waiting'
    | 'delegation';
  agentId: string;
  agentName?: string;
  targetId?: string; // file path or note id
  targetName?: string;
  parentAgentId?: string;
  isActive?: boolean;
}
