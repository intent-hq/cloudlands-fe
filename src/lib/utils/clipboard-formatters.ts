/**
 * Clipboard Formatting Utilities
 *
 * Shared utilities for formatting agent conversations and tool calls
 * for clipboard operations.
 */
import { formatDateTime } from '$lib/i18n/format';

/**
 * Safely stringify a value, handling circular references and errors
 */
export function safeStringify(value: unknown, indent: number = 2): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, indent);
  } catch {
    return String(value);
  }
}

/**
 * Format a tool call for text output
 */
export function formatToolCallForClipboard(toolCall: {
  name?: string;
  toolName?: string;
  arguments?: unknown;
  input?: unknown;
  parameters?: unknown;
  result?: unknown;
  error?: unknown;
}): string {
  const name = toolCall.name || toolCall.toolName || 'unknown';
  const args = toolCall.arguments || toolCall.input || toolCall.parameters || {};
  const argsStr = safeStringify(args);
  const result = toolCall.result;
  const error = toolCall.error;

  let output = `🔧 Tool: ${name}\nInput:\n${argsStr}`;
  if (error) {
    output += `\n❌ Error: ${typeof error === 'string' ? error : safeStringify(error)}`;
  } else if (result !== undefined) {
    output += `\n✅ Result:\n${safeStringify(result)}`;
  }
  return output;
}

/**
 * Format a tool_use content block for text output
 */
export function formatToolUseBlockForClipboard(block: {
  name?: string;
  toolName?: string;
  input?: unknown;
}): string {
  const name = block.name || block.toolName || 'unknown';
  const input = block.input || {};
  return `🔧 Tool: ${name}\nInput:\n${safeStringify(input)}`;
}

/**
 * Format a tool_result content block for text output
 */
export function formatToolResultBlockForClipboard(block: {
  is_error?: boolean;
  isError?: boolean;
  content?: unknown;
  output?: unknown;
  text?: string;
}): string {
  const isError = block.is_error || block.isError || false;
  const content = block.content || block.output || block.text || '';
  const prefix = isError ? '❌ Tool Error' : '✅ Tool Result'; // i18n-ignore (clipboard export markup)
  return `${prefix}:\n${safeStringify(content)}`;
}

/**
 * Format agent messages for clipboard
 */
export function formatAgentMessagesForClipboard(
  messages: Array<{
    role: string;
    timestamp?: number | string | Date;
    contentBlocks?: Array<{
      type: string;
      text?: string;
      content?: string;
      id?: string;
      toolCallId?: string;
      tool_use_id?: string;
      name?: string;
      toolName?: string;
      input?: unknown;
      is_error?: boolean;
      isError?: boolean;
      output?: unknown;
    }>;
    toolCalls?: Array<{
      id?: string;
      name?: string;
      toolName?: string;
      arguments?: unknown;
      input?: unknown;
      parameters?: unknown;
      result?: unknown;
      error?: unknown;
    }>;
    toolResults?: Array<{
      toolCallId?: string;
      isError?: boolean;
      content?: unknown;
    }>;
  }>,
): string {
  const parts: string[] = [];
  let prevRole: string | null = null;

  for (const msg of messages) {
    const messageParts: string[] = [];
    const processedToolIds = new Set<string>();

    // Extract text from content blocks
    if (msg.contentBlocks && Array.isArray(msg.contentBlocks)) {
      for (const block of msg.contentBlocks) {
        if (block.type === 'text') {
          const text = block.text || block.content || '';
          if (text.trim()) {
            messageParts.push(text);
          }
        } else if (block.type === 'tool_use') {
          messageParts.push(formatToolUseBlockForClipboard(block));
          const toolId = block.id || block.toolCallId;
          if (toolId) processedToolIds.add(toolId);
        } else if (block.type === 'tool_result') {
          messageParts.push(formatToolResultBlockForClipboard(block));
          const toolUseId = block.tool_use_id || block.toolCallId;
          if (toolUseId) processedToolIds.add(toolUseId);
        } else if (block.type === 'thinking' && block.text) {
          messageParts.push(`💭 Thinking:\n${block.text}`);
        }
      }
    }

    // Include tool calls from the toolCalls array (skip if already in contentBlocks)
    if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
      for (const toolCall of msg.toolCalls) {
        if (toolCall.id && processedToolIds.has(toolCall.id)) continue;
        messageParts.push(formatToolCallForClipboard(toolCall));
      }
    }

    // Include tool results from the toolResults array (skip if already in contentBlocks)
    if (msg.toolResults && Array.isArray(msg.toolResults)) {
      for (const result of msg.toolResults) {
        if (result.toolCallId && processedToolIds.has(result.toolCallId)) continue;
        const isError = result.isError || false;
        const content = result.content || '';
        const prefix = isError ? '❌ Tool Error' : '✅ Tool Result'; // i18n-ignore (clipboard export markup)
        messageParts.push(`${prefix}:\n${safeStringify(content)}`);
      }
    }

    if (messageParts.length === 0) continue;

    // Add separator based on role transition
    if (prevRole !== null) {
      if (prevRole === 'assistant' && msg.role === 'user') {
        parts.push('\n' + '='.repeat(80) + '\n');
      } else {
        parts.push('\n---\n');
      }
    }

    // Format with role prefix
    // i18n-ignore (clipboard export markup)
    const role = msg.role === 'user' ? 'User' : msg.role === 'system' ? 'System' : 'Assistant';
    const timestamp = msg.timestamp ? formatDateTime(msg.timestamp) : '';

    parts.push(`${role}${timestamp ? ` (${timestamp})` : ''}:\n${messageParts.join('\n\n')}`);
    prevRole = msg.role;
  }

  return parts.join('\n');
}
