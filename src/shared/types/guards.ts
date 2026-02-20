/**
 * Type Guards for Agent System
 *
 * Runtime type checking functions for all agent types.
 * These guards enable type narrowing in TypeScript and runtime validation.
 */

import type {
  AgentSession,
  AgentMessage,
  ContentBlock,
  ToolCall,
  ToolUseBlock,
  ToolResultBlock,
  MessageRole,
} from '../types';
import { isContentBlock as isContentBlockImpl } from './content-block';

// ============================================================================
// Session Guards
// ============================================================================

/**
 * Check if an object is a valid AgentSession
 */
export function isAgentSession(obj: unknown): obj is AgentSession {
  if (!obj || typeof obj !== 'object') return false;
  const session = obj as any;
  return (
    typeof session.id === 'string' &&
    typeof session.workspaceId === 'string' &&
    Array.isArray(session.messages) &&
    typeof session.status === 'string'
  );
}

/**
 * Check if a session has an active backend session
 */
export function hasActiveBackendSession(session: AgentSession): boolean {
  const backendSessionId = (session as any).backendSessionId ?? (session as any).sessionId;
  return backendSessionId !== null && backendSessionId !== undefined && session.status === 'active';
}

// ============================================================================
// Message Guards
// ============================================================================

/**
 * Check if an object is a valid AgentMessage
 */
export function isAgentMessage(obj: unknown): obj is AgentMessage {
  if (!obj || typeof obj !== 'object') return false;
  const msg = obj as any;
  return (
    typeof msg.id === 'string' &&
    typeof msg.role === 'string' &&
    ['user', 'assistant', 'system', 'error'].includes(msg.role) &&
    (typeof msg.timestamp === 'string' || msg.timestamp instanceof Date)
  );
}

/**
 * Check if a message is currently streaming
 */
export function isStreamingMessage(msg: AgentMessage): boolean {
  return msg.isStreaming === true;
}

/**
 * Check if a message has tool calls
 */
export function hasToolCalls(msg: AgentMessage): boolean {
  return Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0;
}

// ============================================================================
// Content Block Guards
// ============================================================================

// Re-export isContentBlock from content-block.ts
export { isContentBlock } from './content-block';

// Re-export specific type guards from content-block.guards.ts
export {
  isTextBlock,
  isCodeBlock,
  isToolUseBlock,
  isToolResultBlock,
  isThinkingBlock,
  isImageBlock,
  isAudioBlock,
  hasTextContent,
  getTextContent,
  isErrorBlock,
  isToolBlock,
  isMediaBlock,
} from './content-block.guards';

// ============================================================================
// Array Guards
// ============================================================================

/**
 * Check if an array contains only ContentBlocks
 */
export function isContentBlockArray(arr: unknown): arr is ContentBlock[] {
  return Array.isArray(arr) && arr.every(isContentBlockImpl);
}

/**
 * Check if an array contains only AgentMessages
 */
export function isMessageArray(arr: unknown): arr is AgentMessage[] {
  return Array.isArray(arr) && arr.every(isAgentMessage);
}

// ============================================================================
// Tool Call Guards
// ============================================================================

/**
 * Check if an object is a valid ToolCall
 */
export function isToolCall(obj: unknown): obj is ToolCall {
  if (!obj || typeof obj !== 'object') return false;
  const call = obj as any;
  return (
    typeof call.id === 'string' &&
    typeof call.name === 'string' &&
    typeof call.timestamp === 'string'
  );
}

/**
 * Check if an array contains only ToolCalls
 */
export function isToolCallArray(arr: unknown): arr is ToolCall[] {
  return Array.isArray(arr) && arr.every(isToolCall);
}
