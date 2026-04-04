/**
 * Unified ContentBlock Type Definition
 *
 * Single source of truth for all content block types across the application.
 * Supports:
 * - Auggie format: text, tool_use, tool_result, thinking
 * - Structured format: text, code, tool_use, tool_result
 * - ACP format: image, audio, resource (via compatibility layer)
 *
 * Maintains backward compatibility with multiple field name aliases:
 * - text/content (both supported)
 * - name/toolName (both supported)
 * - is_error/isError (both supported)
 * - tool_use_id/toolUseId (both supported)
 */

/**
 * Comprehensive ContentBlock interface supporting all content types
 * and maintaining backward compatibility with legacy field names.
 */
export interface ContentBlock {
  /** Type of content block */
  type: 'text' | 'code' | 'tool_use' | 'tool_result' | 'thinking' | 'image' | 'audio' | 'file';

  // Common fields
  /** Unique identifier for this block */
  id?: string;
  /** Arbitrary metadata associated with this block */
  metadata?: Record<string, any>;

  // Text content fields
  /** Text content (primary field) */
  text?: string;
  /** Text content (legacy alias for backward compatibility) */
  content?: string;

  // Code block fields
  /** Programming language for code blocks */
  language?: string;

  // Tool use fields
  /** Tool name (primary field) */
  name?: string;
  /** Tool name (legacy alias for backward compatibility) */
  toolName?: string;
  /** Tool input parameters */
  input?: Record<string, unknown>;
  /** Tool call ID (legacy alias) */
  toolCallId?: string;

  // Tool result fields
  /** ID of the tool_use block this result corresponds to */
  tool_use_id?: string;
  /** Tool result output */
  output?: any;
  /** Whether the tool call resulted in an error (snake_case) */
  is_error?: boolean;
  /** Whether the tool call resulted in an error (camelCase alias) */
  isError?: boolean;

  // Media fields (for image/audio/file types)
  /** Base64-encoded media data */
  data?: string;
  /** MIME type of media */
  mimeType?: string;
  /** Transcript for audio content */
  transcript?: string;
  /** File name (for file type) */
  fileName?: string;
}

/**
 * Type guard to check if a value is a ContentBlock
 */
export function isContentBlock(value: any): value is ContentBlock {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.type === 'string' &&
    ['text', 'code', 'tool_use', 'tool_result', 'thinking', 'image', 'audio', 'file'].includes(
      value.type,
    )
  );
}

/**
 * Normalize a ContentBlock to ensure consistent field names
 * Converts legacy field names to primary names
 */
export function normalizeContentBlock(block: any): ContentBlock {
  if (!isContentBlock(block)) {
    throw new Error(`Invalid ContentBlock: ${JSON.stringify(block)}`);
  }

  const normalized: ContentBlock = { ...block };

  // Normalize text field
  if (block.content && !block.text) {
    normalized.text = block.content;
  }

  // Normalize tool name field
  if (block.toolName && !block.name) {
    normalized.name = block.toolName;
  }

  // Normalize error field
  if (block.isError !== undefined && block.is_error === undefined) {
    normalized.is_error = block.isError;
  }

  // Normalize tool_use_id field
  if (block.toolCallId && !block.tool_use_id) {
    normalized.tool_use_id = block.toolCallId;
  }

  return normalized;
}

/**
 * Normalize an array of ContentBlocks by merging adjacent text blocks.
 *
 * When backend content blocks replace frontend blocks (e.g., on stream completion
 * while the user is on a different workspace), the backend may structure content as
 * many small text blocks (one per text segment between tool calls). The frontend
 * normally accumulates text into fewer, larger blocks during streaming.
 *
 * This function merges adjacent text blocks into single blocks so the renderer
 * doesn't display fragmented text snippets between tool call cards.
 */
export function normalizeContentBlocks(blocks: ContentBlock[]): ContentBlock[] {
  if (!blocks || blocks.length <= 1) return blocks;

  const result: ContentBlock[] = [];
  // Helper to get text from a block, handling both `text` and legacy `content` alias
  const getText = (b: ContentBlock) => b.text || b.content || '';

  for (const block of blocks) {
    const last = result[result.length - 1];
    if (block.type === 'text' && last?.type === 'text') {
      // Merge adjacent text blocks, stripping stale legacy `content` field
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { content: _lastContent, ...lastWithoutContent } = last;
      result[result.length - 1] = {
        ...lastWithoutContent,
        text: getText(last) + getText(block),
      };
    } else {
      result.push({ ...block });
    }
  }
  return result;
}
