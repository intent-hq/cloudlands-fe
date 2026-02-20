/**
 * ContentBlock Migration Utilities
 *
 * Provides utilities for converting between different ContentBlock formats:
 * - Legacy internal format (with field aliases)
 * - ACP format (official Agent Client Protocol)
 * - Normalized format (canonical representation)
 */

import type { ContentBlock } from './content-block';
import { normalizeContentBlock } from './content-block';

/**
 * Convert legacy ContentBlock format to normalized format
 * Handles various field name aliases and formats
 */
export function migrateFromLegacy(block: any): ContentBlock {
  if (!block || typeof block !== 'object') {
    throw new Error('Invalid block: must be an object');
  }

  const normalized: ContentBlock = {
    type: block.type || 'text',
  };

  // Handle text content
  if (block.text) normalized.text = block.text;
  else if (block.content) normalized.text = block.content;

  // Handle code blocks
  if (block.language) normalized.language = block.language;

  // Handle tool use
  if (block.name) normalized.name = block.name;
  else if (block.toolName) normalized.name = block.toolName;

  if (block.input) normalized.input = block.input;

  // Handle tool result
  if (block.tool_use_id) normalized.tool_use_id = block.tool_use_id;
  else if (block.toolCallId) normalized.tool_use_id = block.toolCallId;

  if (block.output) normalized.output = block.output;

  // Handle error flag
  if (block.is_error !== undefined) normalized.is_error = block.is_error;
  else if (block.isError !== undefined) normalized.is_error = block.isError;

  // Handle media
  if (block.data) normalized.data = block.data;
  if (block.mimeType) normalized.mimeType = block.mimeType;
  if (block.transcript) normalized.transcript = block.transcript;

  // Handle metadata
  if (block.id) normalized.id = block.id;
  if (block.metadata) normalized.metadata = block.metadata;

  return normalized;
}

/**
 * Convert ACP ContentBlock to internal format
 * ACP format: { type: "text" | "image" | "audio" | "resource", ... }
 */
export function convertFromACP(acpBlock: any): ContentBlock {
  if (!acpBlock || typeof acpBlock !== 'object') {
    throw new Error('Invalid ACP block: must be an object');
  }

  const block: ContentBlock = {
    type: acpBlock.type || 'text',
  };

  // Text content
  if (acpBlock.text) {
    block.text = acpBlock.text;
  }

  // Image/Audio media
  if (acpBlock.data) {
    block.data = acpBlock.data;
  }
  if (acpBlock.mimeType) {
    block.mimeType = acpBlock.mimeType;
  }

  // Audio transcript
  if (acpBlock.transcript) {
    block.transcript = acpBlock.transcript;
  }

  // Resource handling
  if (acpBlock.resource) {
    block.metadata = {
      resource: acpBlock.resource,
    };
  }

  return block;
}

/**
 * Convert internal ContentBlock to ACP format
 * Returns ACP-compatible representation
 */
export function convertToACP(block: ContentBlock): any {
  const normalized = normalizeContentBlock(block);

  const acpBlock: any = {
    type: normalized.type,
  };

  // Text content
  if (normalized.text) {
    acpBlock.text = normalized.text;
  }

  // Media
  if (normalized.data) {
    acpBlock.data = normalized.data;
  }
  if (normalized.mimeType) {
    acpBlock.mimeType = normalized.mimeType;
  }

  // Audio transcript
  if (normalized.transcript) {
    acpBlock.transcript = normalized.transcript;
  }

  // Resource from metadata
  if (normalized.metadata?.resource) {
    acpBlock.resource = normalized.metadata.resource;
  }

  return acpBlock;
}

/**
 * Batch migrate an array of ContentBlocks
 */
export function migrateContentBlocks(blocks: any[]): ContentBlock[] {
  if (!Array.isArray(blocks)) {
    return [];
  }

  return blocks
    .map((block) => {
      try {
        return migrateFromLegacy(block);
      } catch (error) {
        // Failed to migrate block, return null
        return null;
      }
    })
    .filter((block): block is ContentBlock => block !== null);
}
