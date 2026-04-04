/**
 * Notes Primitives Serializer
 *
 * Handles parsing and serialization of note primitives between:
 * - Markdown with ws-block fenced code blocks
 * - Internal NotePrimitive objects
 * - TipTap document nodes
 */

import type { JSONContent } from '@tiptap/core';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../shared/logger';
import { type NotePrimitive, NotePrimitiveSchema } from '../../shared/types/notes-primitives';

const logger = new Logger('NotesPrimitivesSerializer');

// ============================================================================
// Types
// ============================================================================

export interface ParsedPrimitive {
  primitive: NotePrimitive;
  startLine: number;
  endLine: number;
  rawContent: string;
}

export interface SerializationOptions {
  prettyPrint?: boolean;
  preserveIds?: boolean;
  validateSchema?: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a string is a valid UUID
 */
function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

// ============================================================================
// Main Serializer Class
// ============================================================================

export class NotesPrimitivesSerializer {
  private logger = new Logger('NotesPrimitivesSerializer');

  /**
   * Parse markdown content to extract ws-block primitives
   */
  parseMarkdown(markdown: string, options: SerializationOptions = {}): ParsedPrimitive[] {
    return parseMarkdownToPrimitives(markdown, options);
  }

  /**
   * Serialize primitives to markdown
   */
  serializeToMarkdown(
    primitives: NotePrimitive[],
    existingMarkdown?: string,
    options: SerializationOptions = {},
  ): string {
    return serializePrimitivesToMarkdown(primitives, existingMarkdown, options);
  }

  /**
   * Convert TipTap node to primitive
   */
  tiptapNodeToPrimitive(node: JSONContent): NotePrimitive | null {
    return tiptapNodeToPrimitive(node);
  }

  /**
   * Convert primitive to TipTap node
   */
  primitiveToTiptapNode(primitive: NotePrimitive): JSONContent {
    return primitiveToTiptapNode(primitive);
  }

  /**
   * Generate a new primitive ID
   */
  generateId(): string {
    return generatePrimitiveId();
  }

  /**
   * Create a base primitive with common fields
   */
  createBasePrimitive(
    type: NotePrimitive['type'],
    createdBy: NotePrimitive['createdBy'] = 'user',
  ): Omit<NotePrimitive, 'type'> & { type: NotePrimitive['type'] } {
    return createBasePrimitive(type, createdBy);
  }
}

// ============================================================================
// Markdown Parsing
// ============================================================================

/**
 * Parse markdown content to extract ws-block primitives
 */
function parseMarkdownToPrimitives(
  markdown: string,
  options: SerializationOptions = {},
): ParsedPrimitive[] {
  const { validateSchema = true } = options;
  const primitives: ParsedPrimitive[] = [];
  const lines = markdown.split('\n');

  let inWsBlock = false;
  let blockStartLine = -1;
  let blockContent: string[] = [];

  let blockTypeSuffix = ''; // Track the type suffix from the fence

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for ws-block start (with or without type suffix)
    if (line.trim().startsWith('```ws-block')) {
      inWsBlock = true;
      blockStartLine = i;
      blockContent = [];
      // Extract type suffix (e.g., "reference" from "```ws-block:reference")
      const match = line.trim().match(/^```ws-block:(\w+)/);
      blockTypeSuffix = match ? match[1] : '';
      continue;
    }

    // Check for diagram block start
    if (line.trim().startsWith('```diagram')) {
      logger.info('[parseMarkdownToPrimitives] Found diagram block start', { line: i });
      inWsBlock = true; // Treat diagram blocks the same as ws-blocks
      blockStartLine = i;
      blockContent = [];
      blockTypeSuffix = 'diagram';
      continue;
    }

    // Check for block end
    if (inWsBlock && line.trim() === '```') {
      inWsBlock = false;

      try {
        const jsonContent = blockContent.join('\n');
        const parsed = JSON.parse(jsonContent);

        // Infer type from fence suffix if not present in JSON
        if (!parsed.type && blockTypeSuffix) {
          parsed.type = blockTypeSuffix;
          logger.debug('[parseMarkdownToPrimitives] Inferred type from fence suffix', {
            type: blockTypeSuffix,
          });
        }

        // Normalize all primitives - ensure required base fields exist
        // Ensure id is a valid UUID (use uuidv4 for cross-environment compatibility)
        if (!parsed.id || !isValidUUID(parsed.id)) {
          parsed.id = uuidv4();
        }
        if (!parsed.version) {
          parsed.version = 1;
        }
        if (!parsed.createdAt) {
          parsed.createdAt = new Date().toISOString();
        }
        if (!parsed.createdBy) {
          parsed.createdBy = 'agent';
        }

        // Normalize reference primitives
        if (parsed.type === 'reference') {
          // Ensure target exists with required fields
          if (!parsed.target) {
            parsed.target = { kind: 'symbol', semanticId: '' };
          }

          // Normalize simplified target format:
          // Convert {path, startLine, endLine} to {filePath, range: {startLine, endLine}}
          if (parsed.target.path && !parsed.target.filePath) {
            parsed.target.filePath = parsed.target.path;
            delete parsed.target.path;
          }
          if (
            (parsed.target.startLine !== undefined || parsed.target.endLine !== undefined) &&
            !parsed.target.range
          ) {
            parsed.target.range = {
              startLine: parsed.target.startLine ?? 1,
              endLine: parsed.target.endLine ?? parsed.target.startLine ?? 1,
            };
            delete parsed.target.startLine;
            delete parsed.target.endLine;
          }

          // Normalize kind: convert "line-range" to "file_range"
          if (parsed.target.kind === 'line-range') {
            parsed.target.kind = 'file_range';
          }

          // Ensure target.kind exists - infer from context
          if (!parsed.target.kind) {
            // If has range or semanticId contains line range markers (e.g., #L7-40), it's a file_range
            const hasRange = !!parsed.target.range;
            const hasLineRange = parsed.target.semanticId?.includes('#L');
            parsed.target.kind = hasRange || hasLineRange ? 'file_range' : 'symbol';
          }
        }

        // Normalize CLI primitives
        if (parsed.type === 'cli') {
          // Ensure command exists
          if (!parsed.command) {
            parsed.command = '';
          }
        }

        // Normalize diagram primitives
        if (parsed.type === 'diagram') {
          logger.info('[parseMarkdownToPrimitives] Normalizing diagram primitive', {
            id: parsed.id,
            hasModel: !!parsed.model,
            hasBaseView: !!parsed.baseView,
          });

          // Ensure model exists with nodes and edges
          if (!parsed.model) {
            parsed.model = { nodes: [], edges: [] };
          }
          if (!parsed.model.nodes) {
            parsed.model.nodes = [];
          }
          if (!parsed.model.edges) {
            parsed.model.edges = [];
          }

          // Normalize groups - ensure each group has nodeIds array
          if (Array.isArray(parsed.model.groups)) {
            parsed.model.groups = parsed.model.groups
              .filter(
                (group: unknown): group is Record<string, unknown> =>
                  group !== null && typeof group === 'object',
              )
              .map((group: Record<string, unknown>) => ({
                ...group,
                nodeIds: Array.isArray(group.nodeIds) ? group.nodeIds : [],
              }));
          }

          // Ensure baseView exists with layout
          if (!parsed.baseView) {
            parsed.baseView = { layout: { type: 'layered', direction: 'TB' } };
          }
          if (!parsed.baseView.layout) {
            parsed.baseView.layout = { type: 'layered', direction: 'TB' };
          }

          // Set default grammar if missing
          if (!parsed.grammar) {
            parsed.grammar = 'architecture';
          }
        }

        // Validate schema if requested
        if (validateSchema) {
          const result = NotePrimitiveSchema.safeParse(parsed);
          if (!result.success) {
            logger.error('Invalid primitive schema', {
              errors: result.error.errors,
              primitiveType: parsed.type,
              primitiveId: parsed.id,
              content: jsonContent,
            });
            continue;
          }
        }

        primitives.push({
          primitive: parsed as NotePrimitive,
          startLine: blockStartLine,
          endLine: i,
          rawContent: lines.slice(blockStartLine, i + 1).join('\n'),
        });
      } catch (error) {
        logger.error('Failed to parse ws-block JSON', {
          error,
          content: blockContent.join('\n'),
          line: blockStartLine,
        });
      }

      blockStartLine = -1;
      blockContent = [];
      blockTypeSuffix = '';
      continue;
    }

    // Collect block content
    if (inWsBlock) {
      blockContent.push(line);
    }
  }

  // Warn if unclosed block
  if (inWsBlock) {
    logger.warn('Unclosed ws-block found', { startLine: blockStartLine });
  }

  return primitives;
}

/**
 * Extract all primitives from markdown, preserving surrounding text
 */
export function extractPrimitivesWithContext(markdown: string): {
  primitives: ParsedPrimitive[];
  segments: Array<{ type: 'text' | 'primitive'; content: string; primitive?: NotePrimitive }>;
} {
  const primitives = parseMarkdownToPrimitives(markdown);
  const segments: Array<{
    type: 'text' | 'primitive';
    content: string;
    primitive?: NotePrimitive;
  }> = [];
  const lines = markdown.split('\n');

  let lastEndLine = -1;

  for (const parsed of primitives) {
    // Add text before this primitive
    if (parsed.startLine > lastEndLine + 1) {
      const textLines = lines.slice(lastEndLine + 1, parsed.startLine);
      segments.push({
        type: 'text',
        content: textLines.join('\n'),
      });
    }

    // Add the primitive
    segments.push({
      type: 'primitive',
      content: parsed.rawContent,
      primitive: parsed.primitive,
    });

    lastEndLine = parsed.endLine;
  }

  // Add any remaining text
  if (lastEndLine < lines.length - 1) {
    const textLines = lines.slice(lastEndLine + 1);
    segments.push({
      type: 'text',
      content: textLines.join('\n'),
    });
  }

  return { primitives, segments };
}

// ============================================================================
// Markdown Serialization
// ============================================================================

/**
 * Serialize a primitive to ws-block markdown format
 */
export function serializePrimitiveToMarkdown(
  primitive: NotePrimitive,
  options: SerializationOptions = {},
): string {
  const { prettyPrint = true, preserveIds = true } = options;

  // Clone primitive to avoid mutation
  const toSerialize = { ...primitive };

  // Generate new ID if not preserving
  if (!preserveIds && !toSerialize.id) {
    toSerialize.id = uuidv4();
  }

  // Ensure timestamps
  if (!toSerialize.createdAt) {
    toSerialize.createdAt = new Date().toISOString();
  }

  const jsonContent = prettyPrint
    ? JSON.stringify(toSerialize, null, 2)
    : JSON.stringify(toSerialize);

  return `\`\`\`ws-block\n${jsonContent}\n\`\`\``;
}

/**
 * Serialize primitives to markdown, optionally replacing existing ws-blocks
 */
function serializePrimitivesToMarkdown(
  primitives: NotePrimitive[],
  existingMarkdown?: string,
  options: SerializationOptions = {},
): string {
  if (!existingMarkdown) {
    // No existing markdown, just serialize the primitives
    return primitives.map((p) => serializePrimitiveToMarkdown(p, options)).join('\n\n');
  }

  // Extract existing content and replace ws-blocks
  const { segments } = extractPrimitivesWithContext(existingMarkdown);
  const newSegments = segments.map((segment) => {
    if (segment.type === 'primitive') {
      // Replace with new primitives (if any)
      const primitive = primitives.shift();
      if (primitive) {
        return {
          type: 'primitive' as const,
          content: '',
          primitive,
        };
      }
    }
    return segment;
  });

  // Append any remaining primitives
  for (const primitive of primitives) {
    newSegments.push({
      type: 'primitive',
      content: '',
      primitive,
    });
  }

  return serializePrimitivesWithText(newSegments, options);
}

/**
 * Serialize multiple primitives with text segments
 */
export function serializePrimitivesWithText(
  segments: Array<{ type: 'text' | 'primitive'; content: string; primitive?: NotePrimitive }>,
  options: SerializationOptions = {},
): string {
  const parts: string[] = [];

  for (const segment of segments) {
    if (segment.type === 'text') {
      parts.push(segment.content);
    } else if (segment.primitive) {
      parts.push(serializePrimitiveToMarkdown(segment.primitive, options));
    }
  }

  return parts.join('\n');
}

// ============================================================================
// TipTap Integration
// ============================================================================

/**
 * Convert TipTap node to primitive
 */
function tiptapNodeToPrimitive(node: JSONContent): NotePrimitive | null {
  if (!node.type || !node.type.endsWith('_block')) {
    return null;
  }

  const data = node.attrs?.data;
  if (!data) {
    return null;
  }

  return validatePrimitive(data);
}

/**
 * Convert a NotePrimitive to TipTap node JSON
 */
function primitiveToTiptapNode(primitive: NotePrimitive): JSONContent {
  return {
    type: `${primitive.type}_block`,
    attrs: {
      id: primitive.id,
      data: primitive,
    },
  };
}

/**
 * Convert TipTap document to markdown with primitives
 */
export function tipTapToMarkdown(doc: JSONContent): string {
  const parts: string[] = [];

  function processNode(node: JSONContent) {
    // Handle primitive blocks
    if (node.type && node.type.endsWith('_block')) {
      const primitive = node.attrs?.data as NotePrimitive;
      if (primitive) {
        parts.push(serializePrimitiveToMarkdown(primitive));
        return;
      }
    }

    // Handle text nodes
    if (node.type === 'text') {
      parts.push(node.text || '');
      return;
    }

    // Handle paragraph nodes
    if (node.type === 'paragraph') {
      if (node.content) {
        for (const child of node.content) {
          processNode(child);
        }
      }
      parts.push(''); // Add blank line after paragraph
      return;
    }

    // Handle heading nodes
    if (node.type === 'heading') {
      const level = node.attrs?.level || 1;
      const prefix = '#'.repeat(level);
      parts.push(`${prefix} `);
      if (node.content) {
        for (const child of node.content) {
          processNode(child);
        }
      }
      parts.push('');
      return;
    }

    // Handle list nodes
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      if (node.content) {
        for (let i = 0; i < node.content.length; i++) {
          const item = node.content[i];
          const prefix = node.type === 'bulletList' ? '- ' : `${i + 1}. `;
          parts.push(prefix);
          if (item.content) {
            for (const child of item.content) {
              processNode(child);
            }
          }
        }
      }
      parts.push('');
      return;
    }

    // Handle code blocks
    if (node.type === 'codeBlock') {
      const lang = node.attrs?.language || '';
      parts.push(`\`\`\`${lang}`);
      if (node.content) {
        for (const child of node.content) {
          processNode(child);
        }
      }
      parts.push('```');
      parts.push('');
      return;
    }

    // Recursively process other nodes
    if (node.content) {
      for (const child of node.content) {
        processNode(child);
      }
    }
  }

  if (doc.content) {
    for (const node of doc.content) {
      processNode(node);
    }
  }

  return parts.join('\n').trim();
}

/**
 * Parse markdown to TipTap document with primitives
 */
export function markdownToTipTap(markdown: string): JSONContent {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { primitives, segments } = extractPrimitivesWithContext(markdown);
  const nodes: JSONContent[] = [];

  for (const segment of segments) {
    if (segment.type === 'text') {
      // Parse regular markdown text
      const textNodes = parseMarkdownText(segment.content);
      nodes.push(...textNodes);
    } else if (segment.primitive) {
      // Add primitive node
      nodes.push(primitiveToTiptapNode(segment.primitive));
    }
  }

  return {
    type: 'doc',
    content: nodes,
  };
}

/**
 * Parse regular markdown text to TipTap nodes
 * This is a simplified parser - in production, use the existing TipTap markdown parser
 */
function parseMarkdownText(text: string): JSONContent[] {
  const nodes: JSONContent[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    if (line.trim() === '') {
      continue;
    }

    // Handle headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      nodes.push({
        type: 'heading',
        attrs: { level: headingMatch[1].length },
        content: [{ type: 'text', text: headingMatch[2] }],
      });
      continue;
    }

    // Handle list items
    if (line.match(/^[-*+]\s+/)) {
      const text = line.replace(/^[-*+]\s+/, '');
      nodes.push({
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text }],
              },
            ],
          },
        ],
      });
      continue;
    }

    // Handle ordered list items
    const orderedMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (orderedMatch) {
      nodes.push({
        type: 'orderedList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: orderedMatch[2] }],
              },
            ],
          },
        ],
      });
      continue;
    }

    // Default to paragraph
    nodes.push({
      type: 'paragraph',
      content: [{ type: 'text', text: line }],
    });
  }

  return nodes;
}

// ============================================================================
// Validation & Helpers
// ============================================================================

/**
 * Validate a primitive against its schema
 */
export function validatePrimitive(primitive: unknown): NotePrimitive | null {
  const result = NotePrimitiveSchema.safeParse(primitive);
  if (result.success) {
    return result.data;
  }

  logger.warn('Invalid primitive', {
    errors: result.error.errors,
    primitive,
  });
  return null;
}

/**
 * Generate a new primitive ID
 */
export function generatePrimitiveId(): string {
  return uuidv4();
}

/**
 * Create a base primitive with common fields
 */
export function createBasePrimitive(
  type: NotePrimitive['type'],
  createdBy: NotePrimitive['createdBy'] = 'user',
): Omit<NotePrimitive, 'type'> & { type: NotePrimitive['type'] } {
  return {
    id: generatePrimitiveId(),
    type,
    version: 1,
    createdAt: new Date().toISOString(),
    createdBy,
  };
}
