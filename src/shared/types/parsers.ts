/**
 * Safe Parsers for Agent Types
 *
 * Functions that safely parse and validate data without throwing errors.
 * Returns null or empty arrays on validation failure.
 */

import type { AgentSession, AgentMessage, ContentBlock, ToolCall } from '../types';
import { isAgentSession, isAgentMessage, isContentBlock, isToolCall } from './guards';

/**
 * Safely parse an object as an AgentSession
 * @returns The parsed session or null if invalid
 */
export function safeParseAgentSession(data: unknown): AgentSession | null {
  try {
    if (isAgentSession(data)) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Safely parse an object as an AgentMessage
 * @returns The parsed message or null if invalid
 */
export function safeParseAgentMessage(data: unknown): AgentMessage | null {
  try {
    if (isAgentMessage(data)) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Safely parse an object as a ContentBlock
 * @returns The parsed block or null if invalid
 */
export function safeParseContentBlock(data: unknown): ContentBlock | null {
  try {
    if (isContentBlock(data)) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Safely parse an object as a ToolCall
 * @returns The parsed tool call or null if invalid
 */
export function safeParseToolCall(data: unknown): ToolCall | null {
  try {
    if (isToolCall(data)) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Safely parse an array of ContentBlocks
 * @returns Array of valid blocks, filtering out invalid ones
 */
export function safeParseContentBlocks(data: unknown): ContentBlock[] {
  if (!Array.isArray(data)) return [];
  return data.filter((item) => {
    try {
      return isContentBlock(item);
    } catch {
      return false;
    }
  });
}

/**
 * Safely parse an array of AgentMessages
 * @returns Array of valid messages, filtering out invalid ones
 */
export function safeParseAgentMessages(data: unknown): AgentMessage[] {
  if (!Array.isArray(data)) return [];
  return data.filter((item) => {
    try {
      return isAgentMessage(item);
    } catch {
      return false;
    }
  });
}

/**
 * Safely parse an array of ToolCalls
 * @returns Array of valid tool calls, filtering out invalid ones
 */
export function safeParseToolCalls(data: unknown): ToolCall[] {
  if (!Array.isArray(data)) return [];
  return data.filter((item) => {
    try {
      return isToolCall(item);
    } catch {
      return false;
    }
  });
}

/**
 * Safely parse a session with all its messages
 * @returns The parsed session with validated messages, or null if invalid
 */
export function safeParseSessionWithMessages(data: unknown): AgentSession | null {
  const session = safeParseAgentSession(data);
  if (!session) return null;

  // Validate and filter messages
  const validMessages = safeParseAgentMessages(session.messages);
  return {
    ...session,
    messages: validMessages,
  };
}

/**
 * Safely parse a message with all its content blocks
 * @returns The parsed message with validated blocks, or null if invalid
 */
export function safeParseMessageWithBlocks(data: unknown): AgentMessage | null {
  const message = safeParseAgentMessage(data);
  if (!message) return null;

  // Validate and filter content blocks
  const validBlocks = safeParseContentBlocks(message.contentBlocks);
  return {
    ...message,
    contentBlocks: validBlocks.length > 0 ? validBlocks : undefined,
  };
}
