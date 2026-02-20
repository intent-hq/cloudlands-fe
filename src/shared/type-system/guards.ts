/**
 * Type Guards System
 *
 * Provides runtime type checking functions that narrow types and ensure
 * type safety at runtime boundaries.
 */

import {
  WorkspaceSchema,
  AgentSchema,
  NoteSchema,
  MessageSchema,
  type Workspace,
  type Agent,
  type Note,
  type Message,
} from './contracts';

// ============================================================================
// Entity Type Guards
// ============================================================================

/**
 * Check if a value is a valid Workspace
 */
export function isWorkspace(value: unknown): value is Workspace {
  return WorkspaceSchema.safeParse(value).success;
}

/**
 * Assert that a value is a valid Workspace
 */
export function assertWorkspace(value: unknown): asserts value is Workspace {
  const result = WorkspaceSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid Space: ${result.error.message}`);
  }
}

/**
 * Check if a value is a valid Agent
 */
export function isAgent(value: unknown): value is Agent {
  return AgentSchema.safeParse(value).success;
}

/**
 * Assert that a value is a valid Agent
 */
export function assertAgent(value: unknown): asserts value is Agent {
  const result = AgentSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid Agent: ${result.error.message}`);
  }
}

/**
 * Check if a value is a valid Note
 */
export function isNote(value: unknown): value is Note {
  return NoteSchema.safeParse(value).success;
}

/**
 * Assert that a value is a valid Note
 */
export function assertNote(value: unknown): asserts value is Note {
  const result = NoteSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid Note: ${result.error.message}`);
  }
}

/**
 * Check if a value is a valid Message
 */
export function isMessage(value: unknown): value is Message {
  return MessageSchema.safeParse(value).success;
}

/**
 * Assert that a value is a valid Message
 */
export function assertMessage(value: unknown): asserts value is Message {
  const result = MessageSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid Message: ${result.error.message}`);
  }
}

// ============================================================================
// Array Type Guards
// ============================================================================

/**
 * Check if a value is an array of Workspaces
 */
export function isWorkspaceArray(value: unknown): value is Workspace[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => isWorkspace(item));
}

/**
 * Check if a value is an array of Agents
 */
export function isAgentArray(value: unknown): value is Agent[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => isAgent(item));
}

/**
 * Check if a value is an array of Notes
 */
export function isNoteArray(value: unknown): value is Note[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => isNote(item));
}

/**
 * Check if a value is an array of Messages
 */
export function isMessageArray(value: unknown): value is Message[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => isMessage(item));
}

// ============================================================================
// Partial Type Guards
// ============================================================================

/**
 * Check if a value has required Workspace fields
 */
export function hasWorkspaceFields(value: any): value is Partial<Workspace> {
  return typeof value === 'object' && value !== null && typeof value.id === 'string';
}

/**
 * Check if a value has required Agent fields
 */
export function hasAgentFields(value: any): value is Partial<Agent> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.id === 'string' &&
    typeof value.workspaceId === 'string'
  );
}

/**
 * Check if a value has required Note fields
 */
export function hasNoteFields(value: any): value is Partial<Note> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.id === 'string' &&
    typeof value.workspaceId === 'string'
  );
}

/**
 * Check if a value has required Message fields
 */
export function hasMessageFields(value: any): value is Partial<Message> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.id === 'string' &&
    typeof value.sessionId === 'string'
  );
}
