/**
 * Type Guards for ContentBlock
 *
 * Provides runtime type checking functions for different ContentBlock types.
 * These guards narrow the type and provide type safety for specific block types.
 */

import type { ContentBlock } from './content-block';

/**
 * Check if a ContentBlock is a text block
 */
export function isTextBlock(block: ContentBlock): block is ContentBlock & { text: string } {
  return block.type === 'text' && typeof block.text === 'string';
}

/**
 * Check if a ContentBlock is a code block
 */
export function isCodeBlock(block: ContentBlock): block is ContentBlock & { language?: string } {
  return block.type === 'code';
}

/**
 * Check if a ContentBlock is a tool_use block
 */
export function isToolUseBlock(
  block: ContentBlock,
): block is ContentBlock & { name: string; input: any } {
  return block.type === 'tool_use' && typeof block.name === 'string';
}

/**
 * Check if a ContentBlock is a tool_result block
 */
export function isToolResultBlock(
  block: ContentBlock,
): block is ContentBlock & { tool_use_id: string } {
  return block.type === 'tool_result' && typeof block.tool_use_id === 'string';
}

/**
 * Check if a ContentBlock is a thinking block
 */
export function isThinkingBlock(block: ContentBlock): block is ContentBlock {
  return block.type === 'thinking';
}

/**
 * Check if a ContentBlock is an image block
 */
export function isImageBlock(
  block: ContentBlock,
): block is ContentBlock & { data: string; mimeType: string } {
  return (
    block.type === 'image' && typeof block.data === 'string' && typeof block.mimeType === 'string'
  );
}

/**
 * Check if a ContentBlock is an audio block
 */
export function isAudioBlock(
  block: ContentBlock,
): block is ContentBlock & { data: string; mimeType: string } {
  return (
    block.type === 'audio' && typeof block.data === 'string' && typeof block.mimeType === 'string'
  );
}

/**
 * Check if a ContentBlock is a file block
 */
export function isFileBlock(
  block: ContentBlock,
): block is ContentBlock & { data: string; mimeType: string; fileName: string } {
  return (
    block.type === 'file' &&
    typeof block.data === 'string' &&
    typeof block.mimeType === 'string' &&
    typeof block.fileName === 'string'
  );
}

/**
 * Check if a ContentBlock has text content (either text or content field)
 */
export function hasTextContent(block: ContentBlock): boolean {
  return typeof block.text === 'string' || typeof block.content === 'string';
}

/**
 * Get text content from a block (handles both text and content fields)
 */
export function getTextContent(block: ContentBlock): string | undefined {
  return block.text || block.content;
}

/**
 * Check if a ContentBlock represents an error
 */
export function isErrorBlock(block: ContentBlock): boolean {
  return block.is_error === true || block.isError === true;
}

/**
 * Check if a ContentBlock is a tool-related block (tool_use or tool_result)
 */
export function isToolBlock(
  block: ContentBlock,
): block is ContentBlock & { type: 'tool_use' | 'tool_result' } {
  return block.type === 'tool_use' || block.type === 'tool_result';
}

/**
 * Check if a ContentBlock is a media block (image, audio, or file)
 */
export function isMediaBlock(
  block: ContentBlock,
): block is ContentBlock & { type: 'image' | 'audio' | 'file'; data: string } {
  return (block.type === 'image' || block.type === 'audio' || block.type === 'file') && !!block.data;
}
