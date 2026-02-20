/**
 * MCP Event Types
 *
 * Defines the event types emitted by MCP operations
 * for real-time UI synchronization.
 */

export enum McpEventType {
  // Workspace events
  WORKSPACE_UPDATED = 'mcp:workspace:updated',
  WORKSPACE_HEALTH = 'mcp:workspace:health',

  // Server lifecycle events
  SERVER_STARTED = 'mcp:server:started',
  SERVER_STOPPED = 'mcp:server:stopped',
  SERVER_ERROR = 'mcp:server:error',
  SERVER_RESTARTING = 'mcp:server:restarting',

  // Tool execution events
  TOOL_CALLED = 'mcp:tool:called',
  TOOL_COMPLETED = 'mcp:tool:completed',
  TOOL_FAILED = 'mcp:tool:failed',
}

export interface McpActor {
  type: 'agent' | 'user';
  id: string;
  name: string;
  sessionId?: string;
}

export interface WorkspaceUpdatedEvent {
  type: McpEventType.WORKSPACE_UPDATED;
  workspaceId: string;
  resource: 'workspace' | 'note' | 'file' | 'git';
  resourceId?: string;
  operation: 'create' | 'update' | 'delete';
  version: string;
  patch?: any; // Optional delta for optimization
  actor: McpActor;
  timestamp: string;
}

export interface WorkspaceHealthEvent {
  type: McpEventType.WORKSPACE_HEALTH;
  workspaceId: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  details?: any;
  timestamp: string;
}

export interface ServerLifecycleEvent {
  type:
    | McpEventType.SERVER_STARTED
    | McpEventType.SERVER_STOPPED
    | McpEventType.SERVER_ERROR
    | McpEventType.SERVER_RESTARTING;
  serverId: string;
  serverName: string;
  workspaceId?: string;
  error?: string;
  timestamp: string;
}

export interface ToolExecutionEvent {
  type: McpEventType.TOOL_CALLED | McpEventType.TOOL_COMPLETED | McpEventType.TOOL_FAILED;
  toolName: string;
  workspaceId: string;
  requestId?: string;
  duration?: number;
  error?: string;
  actor: McpActor;
  timestamp: string;
}

export type McpEvent =
  | WorkspaceUpdatedEvent
  | WorkspaceHealthEvent
  | ServerLifecycleEvent
  | ToolExecutionEvent;

// Helper functions for creating events

export function createWorkspaceUpdatedEvent(
  workspaceId: string,
  resource: WorkspaceUpdatedEvent['resource'],
  operation: WorkspaceUpdatedEvent['operation'],
  version: string,
  actor: McpActor,
  resourceId?: string,
  patch?: any,
): WorkspaceUpdatedEvent {
  return {
    type: McpEventType.WORKSPACE_UPDATED,
    workspaceId,
    resource,
    resourceId,
    operation,
    version,
    patch,
    actor,
    timestamp: new Date().toISOString(),
  };
}

export function createWorkspaceHealthEvent(
  workspaceId: string,
  level: WorkspaceHealthEvent['level'],
  message: string,
  details?: any,
): WorkspaceHealthEvent {
  return {
    type: McpEventType.WORKSPACE_HEALTH,
    workspaceId,
    level,
    message,
    details,
    timestamp: new Date().toISOString(),
  };
}

export function createServerLifecycleEvent(
  type: ServerLifecycleEvent['type'],
  serverId: string,
  serverName: string,
  workspaceId?: string,
  error?: string,
): ServerLifecycleEvent {
  return {
    type,
    serverId,
    serverName,
    workspaceId,
    error,
    timestamp: new Date().toISOString(),
  };
}

export function createToolExecutionEvent(
  type: ToolExecutionEvent['type'],
  toolName: string,
  workspaceId: string,
  actor: McpActor,
  requestId?: string,
  duration?: number,
  error?: string,
): ToolExecutionEvent {
  return {
    type,
    toolName,
    workspaceId,
    requestId,
    duration,
    error,
    actor,
    timestamp: new Date().toISOString(),
  };
}
