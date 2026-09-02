/**
 * Tool-call pairing helpers (PROTOCOL.md §7.1).
 *
 * The daemon synthesizes `tool_use` blocks
 * (`{ type, id, name, input, toolCallId, metadata }`) and `tool_result` blocks
 * (`{ type, id, tool_use_id, output, is_error }`), pairing them by
 * `toolCallId ↔ tool_use_id`. `tool_use.id` is the addressable block id
 * (`{messageId}:{blockIndex}`), so results are indexed under every identifier
 * they carry and looked up by both tool_use identifiers.
 */

import type { ContentBlock } from '$shared/types';

export interface ToolResultClassification {
  resultsMap: Map<string, ContentBlock>;
  standaloneResults: ReadonlySet<ContentBlock>;
}

export interface StandaloneToolResultPresentation {
  payload: string | unknown[] | null;
  searchableText: string;
}

export type ToolResultClassificationBlock =
  | ContentBlock
  | {
      type: 'content_group';
      children: readonly ToolResultClassificationBlock[];
    };

function* contentBlocks(blocks: readonly ToolResultClassificationBlock[]): Generator<ContentBlock> {
  for (const block of blocks) {
    if (block.type === 'content_group') {
      yield* contentBlocks(block.children);
    } else {
      yield block;
    }
  }
}

function toolUseReferences(block: ContentBlock): string[] {
  return [block.id, block.toolCallId].filter((ref): ref is string => Boolean(ref));
}

function toolResultReferences(block: ContentBlock): string[] {
  return [block.tool_use_id, block.toolCallId].filter((ref): ref is string => Boolean(ref));
}

/**
 * Classify every result in one rendered transcript message. A result is paired
 * when any of its protocol identifiers references a visible sibling tool_use;
 * every other result is standalone.
 */
export function classifyToolResults(
  blocks: readonly ToolResultClassificationBlock[],
): ToolResultClassification {
  const visibleToolUseReferences = new Set<string>();
  const resultsMap = new Map<string, ContentBlock>();
  const standaloneResults = new Set<ContentBlock>();
  const flattenedBlocks = [...contentBlocks(blocks)];

  for (const block of flattenedBlocks) {
    if (block.type !== 'tool_use') continue;
    for (const ref of toolUseReferences(block)) visibleToolUseReferences.add(ref);
  }

  for (const block of flattenedBlocks) {
    if (block.type !== 'tool_result') continue;
    const references = toolResultReferences(block);
    for (const ref of references) resultsMap.set(ref, block);
    if (!references.some((ref) => visibleToolUseReferences.has(ref))) {
      standaloneResults.add(block);
    }
  }

  return { resultsMap, standaloneResults };
}

export function isStandaloneToolResult(
  classification: ToolResultClassification,
  block: ContentBlock,
): boolean {
  return block.type === 'tool_result' && classification.standaloneResults.has(block);
}

/**
 * Build a lookup map from tool_use identifiers to their tool_result blocks.
 *
 * Indexes each tool_result under every reference it carries — the canonical
 * `tool_use_id` plus any legacy `toolCallId` — so a lookup by either
 * `tool_use.id` or `tool_use.toolCallId` resolves. Results without an id
 * reference stay unpaired; there is no position-based attribution.
 */
export function buildToolResultsMap(blocks: readonly ContentBlock[]): Map<string, ContentBlock> {
  return classifyToolResults(blocks).resultsMap;
}

/**
 * Resolve the tool_result for a tool_use block, matching by its addressable
 * block `id` and then by its provider `toolCallId` (PROTOCOL.md §7.1).
 */
export function findToolResult(
  resultsMap: Map<string, ContentBlock>,
  toolUse: { id?: string; toolCallId?: string },
): ContentBlock | undefined {
  return (
    (toolUse.id ? resultsMap.get(toolUse.id) : undefined) ??
    (toolUse.toolCallId ? resultsMap.get(toolUse.toolCallId) : undefined)
  );
}

/**
 * Extract the result payload from a tool_result block. The daemon persists it
 * as `output` (PROTOCOL.md §7.1); legacy blocks may carry `content` instead.
 */
export function getToolResultPayload(result: ContentBlock | null | undefined): unknown {
  if (!result) return null;
  return result.output ?? result.content ?? null;
}

/**
 * Extract display text from a tool-result payload (§7.1 shapes): a plain
 * string, an MCP content-item array (`[{ type: 'text', text }]`, text items
 * joined with newlines), or the fallback object carrying an `output` string.
 * Returns `null` when no text can be extracted.
 */
export function extractPayloadText(payload: unknown): string | null {
  if (payload === null || payload === undefined) return null;
  if (typeof payload === 'string') return payload;
  if (Array.isArray(payload)) {
    const texts = payload
      .filter(
        (item): item is { type: 'text'; text: string } =>
          !!item &&
          typeof item === 'object' &&
          (item as { type?: unknown }).type === 'text' &&
          typeof (item as { text?: unknown }).text === 'string',
      )
      .map((item) => item.text);
    return texts.length > 0 ? texts.join('\n') : null;
  }
  if (typeof payload === 'object') {
    const output = (payload as { output?: unknown }).output;
    if (typeof output === 'string') return output;
  }
  return null;
}

/**
 * Select the payload representation shared by standalone result rendering and
 * search. Strings and content arrays retain their existing representation;
 * an object envelope exposes only its explicit string `output` field.
 */
export function getStandaloneToolResultPresentation(
  result: ContentBlock | null | undefined,
): StandaloneToolResultPresentation {
  const payload = getToolResultPayload(result);
  if (typeof payload === 'string') return { payload, searchableText: payload };
  if (Array.isArray(payload)) {
    return { payload, searchableText: extractPayloadText(payload) ?? '' };
  }
  const searchableText = extractPayloadText(payload);
  return searchableText === null
    ? { payload: null, searchableText: '' }
    : { payload: searchableText, searchableText };
}

/**
 * String form of the result payload for error-text sniffing. Returns `''`
 * when no text can be extracted from the payload.
 */
export function getToolResultText(result: ContentBlock | null | undefined): string {
  return extractPayloadText(getToolResultPayload(result)) ?? '';
}
