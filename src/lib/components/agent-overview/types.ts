/**
 * Agent Overview Visualization Types
 *
 * Types for the force-directed graph visualization showing agents,
 * their delegations, and interactions with files/notes.
 */

// ============================================================================
// Node Types
// ============================================================================

export type NodeType = 'agent' | 'file' | 'note' | 'task';

export interface BaseNode {
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
  createdAt: string;
  /** IDs of agents this agent is waiting for (subscriptions) */
  waitingForAgentIds?: string[];
  /** Current streaming text preview (truncated) */
  streamingText?: string;
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
  name: string;
  description?: string;
  state: 'not_started' | 'in_progress' | 'complete' | 'cancelled';
  lastAction: 'create' | 'update' | 'read';
  lastActionTimestamp: string;
}

export type GraphNode = AgentNode | FileNode | NoteNode | TaskNode;

// ============================================================================
// Edge Types
// ============================================================================

export type EdgeType = 'delegation' | 'file-read' | 'file-write' | 'note-read' | 'note-write' | 'task-create' | 'task-update';

export interface BaseEdge {
  id: string;
  type: EdgeType;
  sourceId: string;
  targetId: string;
  timestamp: string;
  isActive: boolean; // Currently happening
  /** Number of line additions (for write edges) */
  additions?: number;
  /** Number of line deletions (for write edges) */
  deletions?: number;
}

export interface DelegationEdge extends BaseEdge {
  type: 'delegation';
  parentAgentId: string;
  childAgentId: string;
}

export interface FileInteractionEdge extends BaseEdge {
  type: 'file-read' | 'file-write';
  agentId: string;
  filePath: string;
}

export interface NoteInteractionEdge extends BaseEdge {
  type: 'note-read' | 'note-write';
  agentId: string;
  noteId: string;
}

export interface TaskInteractionEdge extends BaseEdge {
  type: 'task-create' | 'task-update';
  agentId: string;
  taskId: string;
}

export type GraphEdge = DelegationEdge | FileInteractionEdge | NoteInteractionEdge | TaskInteractionEdge;

// ============================================================================
// Graph State
// ============================================================================

export interface GraphState {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Current time position for scrubbing (ISO string) */
  currentTime: string;
  /** Whether playing live updates */
  isLive: boolean;
  /** Min time in the event log */
  minTime: string;
  /** Max time in the event log */
  maxTime: string;
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
    | 'delegation';
  agentId: string;
  agentName?: string;
  targetId?: string; // file path or note id
  targetName?: string;
  parentAgentId?: string;
  isActive?: boolean;
}

// ============================================================================
// Type Guards
// ============================================================================

export function isAgentNode(node: GraphNode): node is AgentNode {
  return node.type === 'agent';
}

export function isFileNode(node: GraphNode): node is FileNode {
  return node.type === 'file';
}

export function isNoteNode(node: GraphNode): node is NoteNode {
  return node.type === 'note';
}

export function isTaskNode(node: GraphNode): node is TaskNode {
  return node.type === 'task';
}

export function isDelegationEdge(edge: GraphEdge): edge is DelegationEdge {
  return edge.type === 'delegation';
}

export function isFileInteractionEdge(edge: GraphEdge): edge is FileInteractionEdge {
  return edge.type === 'file-read' || edge.type === 'file-write';
}

export function isNoteInteractionEdge(edge: GraphEdge): edge is NoteInteractionEdge {
  return edge.type === 'note-read' || edge.type === 'note-write';
}

export function isTaskInteractionEdge(edge: GraphEdge): edge is TaskInteractionEdge {
  return edge.type === 'task-create' || edge.type === 'task-update';
}
