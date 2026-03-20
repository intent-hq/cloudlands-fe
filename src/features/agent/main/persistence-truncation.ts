/**
 * Persistence Truncation Utility
 *
 * Truncates large tool call results and tool result content
 * before persisting messages to disk. This prevents JSON files from
 * growing unboundedly due to large tool outputs (e.g., codebase-retrieval,
 * view, read_note).
 *
 * Truncated fields preserve a prefix (first 2KB) plus a marker indicating
 * the original size, so the data is clearly marked as truncated.
 */

import type { AgentMessage, ToolCall, ToolResult } from '$shared/types/agent-message';
import type { ContentBlock } from '$shared/types/content-block';

/** Maximum size in bytes for a single field before truncation (50KB) */
const MAX_FIELD_SIZE_BYTES = 50 * 1024;

/** Size of the preserved prefix in bytes (2KB) */
const PREFIX_SIZE_BYTES = 2 * 1024;

/**
 * Create a truncation marker with the original size.
 */
function truncationMarker(originalBytes: number): string {
  const kb = (originalBytes / 1024).toFixed(1);
  return `\n\n[truncated: ${kb}KB original]`;
}

/**
 * Truncate a value if its serialized size exceeds the threshold.
 * For strings: preserves a prefix of the string.
 * For objects/arrays: serializes to JSON once, then truncates the JSON string.
 * Returns the original value if under threshold.
 */
function truncateField(value: any, maxBytes: number = MAX_FIELD_SIZE_BYTES): any {
  if (value === undefined || value === null) return value;

  // For strings, check size and truncate directly
  if (typeof value === 'string') {
    const size = Buffer.byteLength(value, 'utf-8');
    if (size <= maxBytes) return value;
    const prefix = value.slice(0, PREFIX_SIZE_BYTES);
    return prefix + truncationMarker(size);
  }

  // For objects/arrays, serialize once and reuse
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return value;
  }
  const size = Buffer.byteLength(json, 'utf-8');
  if (size <= maxBytes) return value;
  const prefix = json.slice(0, PREFIX_SIZE_BYTES);
  return prefix + truncationMarker(size);
}

/**
 * Truncate large fields in a single ToolCall.
 * Returns a new ToolCall with truncated fields (does not mutate input).
 */
function truncateToolCall(tc: ToolCall): ToolCall {
  return {
    ...tc,
    result: truncateField(tc.result),
  };
}

/**
 * Truncate large fields in a single ToolResult.
 * Returns a new ToolResult with truncated content (does not mutate input).
 */
function truncateToolResult(tr: ToolResult): ToolResult {
  return {
    ...tr,
    content: truncateField(tr.content),
  };
}

/**
 * Truncate large fields in a ContentBlock if it's a tool_result type.
 * Returns a new ContentBlock with truncated fields (does not mutate input).
 */
function truncateContentBlock(block: ContentBlock): ContentBlock {
  if (block.type === 'tool_result') {
    return {
      ...block,
      content: block.content !== undefined ? truncateField(block.content) : block.content,
      output: block.output !== undefined ? truncateField(block.output) : block.output,
    };
  }
  return block;
}

/**
 * Walk an array of AgentMessages and truncate any tool call results,
 * tool result content, and tool_result content blocks that exceed the
 * size threshold.
 *
 * Returns a new array of messages (does not mutate the input).
 */
export function truncateLargeFields(messages: AgentMessage[]): AgentMessage[] {
  if (!messages || messages.length === 0) return messages;
  return messages.map((msg) => {
    const hasToolCalls = msg.toolCalls && msg.toolCalls.length > 0;
    const hasToolResults = msg.toolResults && msg.toolResults.length > 0;
    const hasToolResultBlocks =
      msg.contentBlocks && msg.contentBlocks.some((b) => b.type === 'tool_result');

    // Skip messages that have nothing to truncate
    if (!hasToolCalls && !hasToolResults && !hasToolResultBlocks) return msg;

    return {
      ...msg,
      ...(hasToolCalls && { toolCalls: msg.toolCalls!.map(truncateToolCall) }),
      ...(hasToolResults && { toolResults: msg.toolResults!.map(truncateToolResult) }),
      ...(hasToolResultBlocks && { contentBlocks: msg.contentBlocks!.map(truncateContentBlock) }),
    };
  });
}

