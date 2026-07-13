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
 * Extract plain text content from content blocks. Reads the canonical PROTOCOL §7
 * `text` field only — the legacy `content` alias is no longer accepted (AUDIT-P1-5).
 */
export function extractContentFromBlocks(blocks: ContentBlock[]): string {
  return blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
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
 * Strictly validate a PROTOCOL §5.5 AgentMessage payload. The daemon always emits
 * `id`/`role`/`timestamp` on every message and uses `contentBlocks` (never a flat
 * `content` string) — this no longer fills defaults or aliases. A divergent envelope
 * surfaces as a thrown error so the BE (or PROTOCOL.md) is corrected at the source
 * rather than silently patched on the client (AUDIT-P1-5).
 */
export function normalizeAgentMessage(msg: any): AgentMessage {
  if (!msg || typeof msg !== 'object') {
    throw new Error('Invalid AgentMessage: must be an object');
  }
  if (typeof msg.id !== 'string') {
    throw new Error(
      `Invalid AgentMessage: required 'id' field missing (PROTOCOL §5.5). Received: ${JSON.stringify(msg)}`,
    );
  }
  if (typeof msg.role !== 'string') {
    throw new Error(
      `Invalid AgentMessage: required 'role' field missing (PROTOCOL §5.5). Received: ${JSON.stringify(msg)}`,
    );
  }
  if (msg.timestamp === undefined || msg.timestamp === null) {
    throw new Error(
      `Invalid AgentMessage: required 'timestamp' field missing (PROTOCOL §5.5). Received: ${JSON.stringify(msg)}`,
    );
  }
  if (msg.content !== undefined && msg.contentBlocks === undefined) {
    throw new Error(
      `Invalid AgentMessage: legacy 'content' field is not part of PROTOCOL §5.5 (use 'contentBlocks'). Received: ${JSON.stringify(msg)}`,
    );
  }

  const normalized: AgentMessage = {
    id: msg.id,
    role: msg.role,
    timestamp: msg.timestamp,
  };

  if (msg.appMessageId) normalized.appMessageId = msg.appMessageId;
  if (msg.agentId) normalized.agentId = msg.agentId;
  if (msg.contentBlocks) normalized.contentBlocks = msg.contentBlocks;
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
