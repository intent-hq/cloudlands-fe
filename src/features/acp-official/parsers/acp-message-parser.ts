/**
 * ACP Message Parser
 *
 * Parses messages from the Agent Client Protocol (ACP) format
 * into the application's ContentBlock format for proper rendering.
 *
 * The ACP protocol provides structured messages with ContentBlocks that include:
 * - Text content
 * - Tool calls and results
 * - Images and other media
 * - Resource references
 */

import { Logger } from '../../../shared/logger';
import type { ContentBlock as UIContentBlock } from '../../../shared/types';
import { getProposalFromResourceBlock } from '../../../shared/types/proposal-resource';
import type {
  ContentBlock as ACPContentBlock,
  Message as ACPMessage,
  ToolCallStatus,
} from '../types/content';

const logger = new Logger('ACPMessageParser');

/**
 * Parse ACP message content in UI ContentBlocks
 *
 * Converts from ACP's structured format to the UI's expected format
 */
export function parseACPMessage(message: ACPMessage | any): UIContentBlock[] {
  const blocks: UIContentBlock[] = [];

  try {
    // Handle the content array from ACP message
    const content = message?.content || message;

    if (!Array.isArray(content)) {
      // If content is a string, wrap it in a text block
      if (typeof content === 'string') {
        return [
          {
            type: 'text',
            text: content,
          } as UIContentBlock,
        ];
      }

      // If content is an object with a text property
      if (content?.text) {
        return [
          {
            type: 'text',
            text: content.text,
          } as UIContentBlock,
        ];
      }

      logger.warn('ACP message content is not an array', { content });
      return [];
    }

    // Process each content block
    for (const block of content) {
      const uiBlock = parseACPContentBlock(block);
      if (uiBlock) {
        blocks.push(uiBlock);
      }
    }
  } catch (error) {
    logger.error('Failed to parse ACP message', error as Error);
    // Return the raw content as text if parsing fails
    return [
      {
        type: 'text',
        text: JSON.stringify(message),
      } as UIContentBlock,
    ];
  }

  return blocks;
}

/**
 * Parse a single ACP ContentBlock into a UI ContentBlock
 */
function parseACPContentBlock(block: ACPContentBlock | any): UIContentBlock | null {
  if (!block) return null;

  try {
    switch (block.type) {
      case 'text':
        return {
          type: 'text',
          text: block.text || '',
        } as UIContentBlock;

      case 'image':
        // Images aren't directly supported in UI ContentBlocks yet
        // Convert to text with a placeholder
        return {
          type: 'text',
          text: `📷 [Image: ${block.mimeType || 'image'}]`,
        } as UIContentBlock;

      case 'resource':
        const proposal = getProposalFromResourceBlock(block);
        if (proposal) {
          return {
            type: 'proposal',
            kind: proposal.kind,
            payload: proposal.payload,
            preview: proposal.preview,
            applyToolCallId: proposal.applyToolCallId,
            proposal,
          } as UIContentBlock;
        }
        // Convert resource references to text with metadata
        const resource = block.resource;
        if (resource?.text) {
          return {
            type: 'text',
            text: `📄 ${resource.uri}\n\n${resource.text}`,
          } as UIContentBlock;
        }
        return null;

      case 'tool_use':
        return parseToolUseBlock(block);

      case 'tool_result':
        return parseToolResultBlock(block);

      default:
        // Unknown block type - try to extract text
        if (block.text) {
          return {
            type: 'text',
            text: block.text,
          } as UIContentBlock;
        }

        logger.debug('Unknown ACP content block type', { type: block.type, block });
        return null;
    }
  } catch (error) {
    logger.error('Failed to parse ACP content block', error as Error, { block });
    return null;
  }
}

/**
 * Parse a tool use block from ACP format
 */
function parseToolUseBlock(block: any): UIContentBlock {
  return {
    type: 'tool_use',
    id: block.id || `tool-${Date.now()}`,
    name: block.name || block.tool || 'unknown',
    input: block.input || block.params || {},
    status: mapToolStatus(block.status),
    kind: block.kind,
  } as UIContentBlock;
}

/**
 * Parse a tool result block from ACP format
 */
function parseToolResultBlock(block: any): UIContentBlock {
  // Extract the actual content from the tool result
  let content: UIContentBlock[] | string = '';

  if (block.content) {
    if (Array.isArray(block.content)) {
      // Recursively parse nested content blocks
      content = block.content.map(parseACPContentBlock).filter(Boolean) as UIContentBlock[];
    } else if (typeof block.content === 'string') {
      content = block.content;
    } else if (block.content.type === 'content' && block.content.content) {
      // Handle ToolCallContent format
      const parsed = parseACPContentBlock(block.content.content);
      content = parsed ? [parsed] : [];
    } else if (block.content.type === 'diff') {
      // Handle file diff format
      content = formatDiff(block.content);
    }
  } else if (block.output) {
    content = block.output;
  } else if (block.error) {
    content = `❌ Error: ${block.error}`;
  }

  // Detect error from content text (e.g., "Error:" prefix or "Tool Error:")
  // Note: We no longer check for ❌ emoji as it may be used as a visual indicator in content
  const contentText = typeof content === 'string' ? content : '';
  const hasErrorInContent = contentText.startsWith('Error:') || contentText.includes('Tool Error:');

  return {
    type: 'tool_result',
    tool_use_id: block.tool_use_id || block.id,
    content,
    is_error: block.is_error || block.error !== undefined || hasErrorInContent,
  } as UIContentBlock;
}

/**
 * Map ACP tool status to UI status
 */
function mapToolStatus(status?: ToolCallStatus | string): string {
  if (!status) return 'completed';

  const statusMap: Record<string, string> = {
    pending: 'pending',
    in_progress: 'running',
    completed: 'completed',
    failed: 'error',
  };

  return statusMap[status] || 'completed';
}

/**
 * Format a file diff for display
 */
function formatDiff(diff: any): string {
  const { path, oldText, newText } = diff;

  let result = `📝 File: ${path}\n\n`;

  if (oldText && newText) {
    // Show a simple diff
    result += '```diff\n';
    if (oldText) {
      result += `- ${oldText.split('\n').join('\n- ')}\n`;
    }
    if (newText) {
      result += `+ ${newText.split('\n').join('\n+ ')}\n`;
    }
    result += '```';
  } else if (newText) {
    // New file
    result += `\`\`\`\n${newText}\n\`\`\``;
  }

  return result;
}

/**
 * Parse streaming ACP response chunks
 *
 * Handles partial JSON-RPC messages and accumulates them
 */
export class ACPStreamParser {
  private buffer: string = '';
  private readonly MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB limit
  // Large threshold for buffer cleanup - file content can be very large
  // Messages are often 1-1.1MB, so threshold must be well above that
  private readonly BUFFER_CLEANUP_THRESHOLD = 5 * 1024 * 1024; // 5MB
  // Threshold below which we always try fallback JSON parsing
  // Above this, we only try fallback if NDJSON didn't yield any messages
  private readonly FALLBACK_PARSE_THRESHOLD = 256 * 1024; // 256KB
  // Rate-limit large buffer warnings to avoid log spam
  private readonly LOG_RATE_LIMIT_MS = 5000; // 5 seconds
  private lastLargeBufferWarningTime = 0;
  private lastBufferResetErrorTime = 0;

  /**
   * Parse a chunk of streaming data
   * Returns an array of complete messages
   *
   * Auggie sends newline-delimited JSON (NDJSON), where each complete JSON message
   * is on its own line. This parser handles both NDJSON and regular JSON formats.
   */
  parseChunk(chunk: string): any[] {
    const messages: any[] = [];

    // Check buffer size before adding chunk
    if (this.buffer.length + chunk.length > this.MAX_BUFFER_SIZE) {
      this.logRateLimited(
        'error',
        'lastBufferResetErrorTime',
        'ACPStreamParser buffer overflow - resetting',
        {
          bufferSize: this.buffer.length,
          chunkSize: chunk.length,
        },
      );
      this.reset();

      // If a single chunk exceeds MAX_BUFFER_SIZE, skip it entirely
      if (chunk.length > this.MAX_BUFFER_SIZE) {
        this.logRateLimited(
          'error',
          'lastBufferResetErrorTime',
          'ACPStreamParser: single chunk exceeds MAX_BUFFER_SIZE, dropping',
          {
            chunkSize: chunk.length,
          },
        );
        return [];
      }
      // Otherwise try to recover by processing just this chunk
    }

    this.buffer += chunk;

    // Split by newlines to handle NDJSON format
    const lines = this.buffer.split('\n');

    // Process all complete lines (keep the last incomplete line in buffer)
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();

      if (line.length === 0) {
        continue; // Skip empty lines
      }

      try {
        const message = JSON.parse(line);
        messages.push(message);
      } catch (error) {
        // Line might not be complete JSON, log at debug level
        logger.debug('Failed to parse ACP message line', {
          line: line.substring(0, 100),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Keep the last (potentially incomplete) line in the buffer
    this.buffer = lines[lines.length - 1];

    // Try fallback JSON parsing when the buffer might contain complete JSON objects
    // without trailing newlines. For small buffers (< 256KB), always try to avoid
    // dropping trailing messages. For large buffers, only try if NDJSON didn't yield
    // any messages (to avoid expensive O(n) scanning on large unparseable buffers).
    const shouldTryFallback =
      this.buffer.length > 0 &&
      (this.buffer.length <= this.FALLBACK_PARSE_THRESHOLD || messages.length === 0);
    if (shouldTryFallback) {
      const parsed = this.tryParseCompleteJson();
      if (parsed.length > 0) {
        messages.push(...parsed);
      }
    }

    // Only reset buffer if it's extremely large and still unparseable
    // This prevents data loss for large but valid messages
    if (this.buffer.length > this.BUFFER_CLEANUP_THRESHOLD) {
      const now = Date.now();
      const shouldLogWarning = now - this.lastLargeBufferWarningTime >= this.LOG_RATE_LIMIT_MS;

      if (shouldLogWarning) {
        this.lastLargeBufferWarningTime = now;
        logger.warn('ACPStreamParser: Very large buffer, attempting final parse', {
          bufferSize: this.buffer.length,
          preview: this.buffer.substring(0, 100),
        });
      }

      // Try one more time to parse
      try {
        const message = JSON.parse(this.buffer);
        messages.push(message);
        this.buffer = '';
      } catch {
        // Buffer is truly stuck - reset it
        this.logRateLimited(
          'error',
          'lastBufferResetErrorTime',
          'ACPStreamParser: Buffer reset due to unparseable content',
          {
            bufferSize: this.buffer.length,
          },
        );
        this.buffer = '';
      }
    }

    return messages;
  }

  /**
   * Log a message at most once per LOG_RATE_LIMIT_MS
   */
  private logRateLimited(
    level: 'warn' | 'error',
    timestampField: 'lastLargeBufferWarningTime' | 'lastBufferResetErrorTime',
    message: string,
    data: Record<string, any>,
  ): void {
    const now = Date.now();
    if (now - this[timestampField] >= this.LOG_RATE_LIMIT_MS) {
      this[timestampField] = now;
      logger[level](message, data);
    }
  }

  /**
   * Try to parse complete JSON objects from the buffer
   * Handles cases where multiple JSON objects are concatenated without newlines
   */
  private tryParseCompleteJson(): any[] {
    const messages: any[] = [];
    let startIndex = 0;

    while (startIndex < this.buffer.length) {
      // Find the start of a JSON object
      const jsonStart = this.buffer.indexOf('{', startIndex);
      if (jsonStart === -1) break;

      // Try to find a complete JSON object by tracking brace depth
      let depth = 0;
      let inString = false;
      let escaped = false;
      let jsonEnd = -1;

      for (let i = jsonStart; i < this.buffer.length; i++) {
        const char = this.buffer[i];

        if (escaped) {
          escaped = false;
          continue;
        }

        if (char === '\\' && inString) {
          escaped = true;
          continue;
        }

        if (char === '"') {
          inString = !inString;
          continue;
        }

        if (inString) continue;

        if (char === '{') {
          depth++;
        } else if (char === '}') {
          depth--;
          if (depth === 0) {
            jsonEnd = i;
            break;
          }
        }
      }

      if (jsonEnd === -1) {
        // Incomplete JSON - stop here
        break;
      }

      // Try to parse the complete JSON
      const jsonStr = this.buffer.substring(jsonStart, jsonEnd + 1);
      try {
        const message = JSON.parse(jsonStr);
        messages.push(message);
        startIndex = jsonEnd + 1;
      } catch {
        // Not valid JSON despite balanced braces - skip this start position
        startIndex = jsonStart + 1;
      }
    }

    // Update buffer to remove parsed content
    if (messages.length > 0 && startIndex > 0) {
      this.buffer = this.buffer.substring(startIndex).trim();
    }

    return messages;
  }

  /**
   * Reset the parser state
   */
  reset() {
    this.buffer = '';
  }

  /**
   * Dispose parser state and release any retained partial input.
   */
  dispose(): void {
    this.reset();
  }
}

/**
 * Extract tool calls from ACP message content
 */
export function extractACPToolCalls(content: ACPContentBlock[] | any[]): Array<{
  id: string;
  name: string;
  input?: any;
  output?: string;
  error?: string;
  status: string;
}> {
  const toolCalls: any[] = [];

  if (!Array.isArray(content)) {
    return toolCalls;
  }

  for (const block of content) {
    // Check if this is a tool_use block (may not be a standard ACPContentBlock)
    if ((block as any)?.type === 'tool_use') {
      const toolBlock = block as any;
      toolCalls.push({
        id: toolBlock.id || `tool-${Date.now()}`,
        name: toolBlock.name || toolBlock.tool,
        input: toolBlock.input || toolBlock.params,
        status: mapToolStatus(toolBlock.status),
      });
    }
  }

  return toolCalls;
}
