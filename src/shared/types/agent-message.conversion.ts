/**
 * AgentMessage Conversion Utilities
 *
 * Provides conversion functions between core AgentMessage and provider message types.
 * Handles transformation between different message formats while preserving data.
 */

import type { AgentMessage, ProviderMessage } from './agent-message';
import type { ContentBlock } from './content-block';
import type { AgentId } from './branded-ids';
import { v4 as uuidv4 } from 'uuid';

/**
 * Convert a core AgentMessage to a provider message
 * Extracts only the fields needed for provider communication
 */
export function toProviderMessage(msg: AgentMessage): ProviderMessage {
  return {
    role: msg.role,
    contentBlocks: msg.contentBlocks,
    toolCalls: msg.toolCalls,
    metadata: msg.metadata ? { ...msg.metadata } : undefined,
  };
}

/**
 * Convert a provider message to a core AgentMessage
 * Adds required fields like id and timestamp
 */
export function fromProviderMessage(
  msg: ProviderMessage,
  agentId?: AgentId,
  messageId?: string,
): AgentMessage {
  return {
    id: messageId || `msg_${uuidv4()}`,
    agentId,
    role: msg.role,
    contentBlocks: msg.contentBlocks,
    toolCalls: msg.toolCalls,
    timestamp: new Date(),
    metadata: msg.metadata,
  };
}

/**
 * Extract plain text content from content blocks
 * Concatenates all text blocks into a single string
 */
export function extractContentFromBlocks(blocks: ContentBlock[]): string {
  return blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text || b.content || '')
    .join('');
}

/**
 * Extract all text content from a message
 * Extracts text from content blocks
 */
export function extractAllContent(msg: AgentMessage): string {
  if (msg.contentBlocks) {
    return extractContentFromBlocks(msg.contentBlocks);
  }
  return '';
}

/**
 * Normalize a message to ensure consistent field values
 * Handles backward compatibility with legacy field names
 */
export function normalizeAgentMessage(msg: any): AgentMessage {
  const normalized: AgentMessage = {
    id: msg.id || `msg_${uuidv4()}`,
    role: msg.role || 'assistant',
    timestamp: msg.timestamp || new Date(),
  };

  if (msg.appMessageId) normalized.appMessageId = msg.appMessageId;
  if (msg.agentId) normalized.agentId = msg.agentId;
  // Handle legacy content field by converting to contentBlocks
  if (msg.content && !msg.contentBlocks) {
    normalized.contentBlocks = [{ type: 'text' as const, text: msg.content }];
  } else if (msg.contentBlocks) {
    normalized.contentBlocks = msg.contentBlocks;
  }
  if (msg.turnNumber !== undefined) normalized.turnNumber = msg.turnNumber;
  if (msg.toolCalls) normalized.toolCalls = msg.toolCalls;
  if (msg.toolResults) normalized.toolResults = msg.toolResults;
  if (msg.error) normalized.error = msg.error;
  if (msg.errorCode) normalized.errorCode = msg.errorCode;
  if (msg.isStreaming !== undefined) normalized.isStreaming = msg.isStreaming;
  if (msg.streamingComplete !== undefined) normalized.streamingComplete = msg.streamingComplete;
  if (msg.metadata) normalized.metadata = msg.metadata;

  return normalized;
}

/**
 * Merge multiple messages into a single message
 * Useful for combining streamed message chunks
 */
export function mergeMessages(messages: AgentMessage[]): AgentMessage {
  if (messages.length === 0) {
    throw new Error('Cannot merge empty message array');
  }

  if (messages.length === 1) {
    return messages[0];
  }

  const first = messages[0];
  const merged: AgentMessage = {
    id: first.id,
    appMessageId: first.appMessageId,
    agentId: first.agentId,
    role: first.role,
    timestamp: first.timestamp,
    turnNumber: first.turnNumber,
    isStreaming: false,
    streamingComplete: true,
    metadata: {
      ...first.metadata,
      merged: true,
      mergedCount: messages.length,
    },
  };

  // Merge content blocks
  const allBlocks = messages.flatMap((m) => m.contentBlocks || []);
  if (allBlocks.length > 0) {
    merged.contentBlocks = allBlocks;
  }

  // Merge tool calls
  const allToolCalls = messages.flatMap((m) => m.toolCalls || []);
  if (allToolCalls.length > 0) {
    merged.toolCalls = allToolCalls;
  }

  // Merge tool results
  const allToolResults = messages.flatMap((m) => m.toolResults || []);
  if (allToolResults.length > 0) {
    merged.toolResults = allToolResults;
  }

  return merged;
}
