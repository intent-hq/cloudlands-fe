/**
 * Tool Call Extractor
 *
 * Extracts tool calls from agent responses in various formats
 */

import { Logger } from '$shared/logger';

const logger = new Logger('ToolCallExtractor');

export interface ExtractedToolCall {
  name: string;
  arguments: Record<string, any>;
}

/**
 * Extract tool calls from agent response text
 *
 * Supports multiple formats:
 * - XML format: <tool_call>{"name": "...", "arguments": {...}}</tool_call>
 * - JSON format: {"name": "...", "arguments": {...}}
 * - Markdown code blocks: ```json {"name": "...", "arguments": {...}} ```
 */
export function extractToolCalls(response: string): ExtractedToolCall[] {
  const toolCalls: ExtractedToolCall[] = [];

  if (!response || typeof response !== 'string') {
    return toolCalls;
  }

  // Try XML format first: <tool_call>...</tool_call>
  const xmlRegex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
  let match;

  while ((match = xmlRegex.exec(response)) !== null) {
    try {
      const toolCall = JSON.parse(match[1]);
      if (toolCall.name && toolCall.arguments) {
        toolCalls.push(toolCall);
      }
    } catch (e) {
      logger.warn('Failed to parse XML tool call', { toolCall: match[1] });
    }
  }

  // Try markdown code block format: ```json {...} ```
  const markdownRegex = /```(?:json)?\s*([\s\S]*?)```/g;
  while ((match = markdownRegex.exec(response)) !== null) {
    try {
      const content = match[1].trim();
      const toolCall = JSON.parse(content);
      if (
        toolCall.name &&
        toolCall.arguments &&
        !toolCalls.some((tc) => tc.name === toolCall.name)
      ) {
        toolCalls.push(toolCall);
      }
    } catch (e) {
      // Not a tool call, skip
    }
  }

  // Try inline JSON format: {"name": "...", "arguments": {...}}
  // Look for JSON objects that have 'name' and 'arguments' fields
  const jsonRegex = /\{[^{}]*"name"\s*:\s*"[^"]*"[^{}]*"arguments"\s*:\s*\{[^{}]*\}[^{}]*\}/g;
  while ((match = jsonRegex.exec(response)) !== null) {
    try {
      const toolCall = JSON.parse(match[0]);
      if (
        toolCall.name &&
        toolCall.arguments &&
        !toolCalls.some((tc) => tc.name === toolCall.name)
      ) {
        toolCalls.push(toolCall);
      }
    } catch (e) {
      // Not a valid tool call, skip
    }
  }

  return toolCalls;
}

/**
 * Check if a response contains tool calls
 */
export function hasToolCalls(response: string): boolean {
  return extractToolCalls(response).length > 0;
}

/**
 * Remove tool calls from response text
 * Useful for displaying the response without the tool call syntax
 */
export function removeToolCalls(response: string): string {
  let cleaned = response;

  // Remove XML format
  cleaned = cleaned.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');

  // Remove markdown code blocks with tool calls
  cleaned = cleaned.replace(/```(?:json)?\s*\{[^{}]*"name"\s*:[^{}]*\}[^{}]*```/g, '');

  return cleaned.trim();
}

/**
 * Format tool calls for display
 */
export function formatToolCalls(toolCalls: ExtractedToolCall[]): string {
  return toolCalls.map((tc) => `${tc.name}(${JSON.stringify(tc.arguments)})`).join(', ');
}

/**
 * Validate tool call against available tools
 */
export function validateToolCall(
  toolCall: ExtractedToolCall,
  availableTools: Array<{ name: string }>,
): boolean {
  return availableTools.some((tool) => tool.name === toolCall.name);
}

/**
 * Validate all tool calls against available tools
 */
export function validateToolCalls(
  toolCalls: ExtractedToolCall[],
  availableTools: Array<{ name: string }>,
): { valid: ExtractedToolCall[]; invalid: ExtractedToolCall[] } {
  const valid: ExtractedToolCall[] = [];
  const invalid: ExtractedToolCall[] = [];

  for (const toolCall of toolCalls) {
    if (validateToolCall(toolCall, availableTools)) {
      valid.push(toolCall);
    } else {
      invalid.push(toolCall);
    }
  }

  return { valid, invalid };
}
