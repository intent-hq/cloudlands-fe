/**
 * Branded ID Types
 *
 * Provides compile-time type safety for different ID types without runtime overhead.
 * Uses TypeScript's brand pattern to prevent accidental ID type mixing.
 *
 * Example:
 *   const agentId: AgentId = AgentId(uuidv4());
 *   const sessionId: AgentId = SessionId(`sess_${uuidv4()}`);
 *
 *   // Type error: Cannot assign SessionId to AgentId
 *   const wrongId: AgentId = sessionId;
 */

// Brand utility type - creates a unique type identity
export declare const brand: unique symbol;
export type Brand<B> = { [brand]: B };

/**
 * Branded type that combines a base type with a brand
 * Zero runtime cost - the brand is only for TypeScript
 */
export type Branded<T, B> = T & Brand<B>;

// ============================================================================
// Branded ID Types
// ============================================================================

export type AgentId = Branded<string, 'AgentId'>;
export type SessionId = Branded<string, 'SessionId'>;
export type MessageId = Branded<string, 'MessageId'>;
export type WorkspaceId = Branded<string, 'WorkspaceId'>;
export type StreamId = Branded<string, 'StreamId'>;
export type ToolCallId = Branded<string, 'ToolCallId'>;
export type UserId = Branded<string, 'UserId'>;
export type ThreadId = Branded<string, 'ThreadId'>;
export type NoteId = Branded<string, 'NoteId'>;

// ============================================================================
// ID Creation Functions (zero runtime cost)
// ============================================================================

/**
 * Create an AgentId from a string
 * @param id - The string to brand as AgentId
 * @returns The branded AgentId
 */
export const AgentId = (id: string): AgentId => id as AgentId;

export const SessionId = (id: string): SessionId => id as SessionId;
export const MessageId = (id: string): MessageId => id as MessageId;
export const WorkspaceId = (id: string): WorkspaceId => id as WorkspaceId;
export const StreamId = (id: string): StreamId => id as StreamId;
export const ToolCallId = (id: string): ToolCallId => id as ToolCallId;
export const UserId = (id: string): UserId => id as UserId;
export const ThreadId = (id: string): ThreadId => id as ThreadId;
export const NoteId = (id: string): NoteId => id as NoteId;

// ============================================================================
// ID Validation Functions
// ============================================================================

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
// Workspace slug pattern: word-word (e.g., "amber-forest") or word-word-N (e.g., "amber-forest-2")
const WORKSPACE_SLUG_PATTERN = /^[a-z]{2,15}-[a-z]{2,15}(-[0-9]+)?$/;
// Legacy workspace slug pattern: word-word-xxxx (e.g., "amber-forest-a7x2") for backward compatibility
const LEGACY_WORKSPACE_SLUG_PATTERN = /^[a-z]{2,15}-[a-z]{2,15}-[a-z0-9]{4}$/;
export const ROOT_WORKSPACE_ID = '__root__' as WorkspaceId;

export function isValidAgentId(id: string): id is AgentId {
  return UUID_PATTERN.test(id) || /^agent-/.test(id) || /^terminal-/.test(id);
}

export function isValidSessionId(id: string): id is SessionId {
  return id.startsWith('sess_') || UUID_PATTERN.test(id);
}

export function isValidMessageId(id: string): id is MessageId {
  return id.startsWith('msg_') || UUID_PATTERN.test(id);
}

export function isValidWorkspaceId(id: string): id is WorkspaceId {
  // Accept new slug format, legacy slug format, UUID format, and the
  // special root terminal context used outside real workspaces.
  return (
    id === ROOT_WORKSPACE_ID ||
    WORKSPACE_SLUG_PATTERN.test(id) ||
    LEGACY_WORKSPACE_SLUG_PATTERN.test(id) ||
    UUID_PATTERN.test(id)
  );
}

export function isValidStreamId(id: string): id is StreamId {
  return id.startsWith('stream_') || UUID_PATTERN.test(id);
}

export function isValidToolCallId(id: string): id is ToolCallId {
  return id.startsWith('tool_') || UUID_PATTERN.test(id);
}

export function isValidUserId(id: string): id is UserId {
  return UUID_PATTERN.test(id);
}

export function isValidThreadId(id: string): id is ThreadId {
  return id.startsWith('thread_') || UUID_PATTERN.test(id);
}

export function isValidNoteId(id: string): id is NoteId {
  return UUID_PATTERN.test(id);
}

// ============================================================================
// Safe ID Creation with Validation
// ============================================================================

export function createAgentId(id: string): AgentId {
  if (!isValidAgentId(id)) {
    throw new Error(`Invalid agent ID format: ${id}`);
  }
  return AgentId(id);
}

/**
 * @deprecated Use createAgentId instead.
 * In this architecture, sessionId === agentId (one session per agent).
 */
export function createSessionId(id: string): AgentId {
  return createAgentId(id);
}

export function createMessageId(id: string): MessageId {
  if (!isValidMessageId(id)) {
    throw new Error(`Invalid message ID format: ${id}`);
  }
  return MessageId(id);
}

export function createWorkspaceId(id: string): WorkspaceId {
  if (!isValidWorkspaceId(id)) {
    throw new Error(`Invalid space ID format: ${id}`);
  }
  return WorkspaceId(id);
}

/**
 * @deprecated Use createAgentId instead.
 * In this architecture, streamId === agentId (one stream per agent).
 * The agentId is the canonical key for stream sessions in StreamManager.
 */
export function createStreamId(id: string): AgentId {
  return createAgentId(id);
}

export function createToolCallId(id: string): ToolCallId {
  if (!isValidToolCallId(id)) {
    throw new Error(`Invalid tool call ID format: ${id}`);
  }
  return ToolCallId(id);
}

export function createUserId(id: string): UserId {
  if (!isValidUserId(id)) {
    throw new Error(`Invalid user ID format: ${id}`);
  }
  return UserId(id);
}

export function createThreadId(id: string): ThreadId {
  if (!isValidThreadId(id)) {
    throw new Error(`Invalid thread ID format: ${id}`);
  }
  return ThreadId(id);
}

export function createNoteId(id: string): NoteId {
  if (!isValidNoteId(id)) {
    throw new Error(`Invalid note ID format: ${id}`);
  }
  return NoteId(id);
}

// ============================================================================
// Type Guards
// ============================================================================

export function assertAgentId(id: string): asserts id is AgentId {
  if (!isValidAgentId(id)) {
    throw new Error(`Expected valid AgentId, got: ${id}`);
  }
}

export function assertSessionId(id: string): asserts id is SessionId {
  if (!isValidSessionId(id)) {
    throw new Error(`Expected valid SessionId, got: ${id}`);
  }
}

export function assertMessageId(id: string): asserts id is MessageId {
  if (!isValidMessageId(id)) {
    throw new Error(`Expected valid MessageId, got: ${id}`);
  }
}

export function assertWorkspaceId(id: string): asserts id is WorkspaceId {
  if (!isValidWorkspaceId(id)) {
    throw new Error(`Expected valid space ID, got: ${id}`);
  }
}

export function assertStreamId(id: string): asserts id is StreamId {
  if (!isValidStreamId(id)) {
    throw new Error(`Expected valid StreamId, got: ${id}`);
  }
}

export function assertToolCallId(id: string): asserts id is ToolCallId {
  if (!isValidToolCallId(id)) {
    throw new Error(`Expected valid ToolCallId, got: ${id}`);
  }
}

export function assertUserId(id: string): asserts id is UserId {
  if (!isValidUserId(id)) {
    throw new Error(`Expected valid UserId, got: ${id}`);
  }
}

export function assertThreadId(id: string): asserts id is ThreadId {
  if (!isValidThreadId(id)) {
    throw new Error(`Expected valid ThreadId, got: ${id}`);
  }
}

export function assertNoteId(id: string): asserts id is NoteId {
  if (!isValidNoteId(id)) {
    throw new Error(`Expected valid NoteId, got: ${id}`);
  }
}
