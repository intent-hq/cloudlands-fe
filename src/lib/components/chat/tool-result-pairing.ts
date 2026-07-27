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

/**
 * Build a lookup map from tool_use identifiers to their tool_result blocks.
 *
 * First pass indexes each tool_result under every reference it carries — the
 * canonical `tool_use_id` plus any legacy `toolCallId` — so a lookup by either
 * `tool_use.id` or `tool_use.toolCallId` resolves. Second pass matches error
 * results with an empty `tool_use_id` to the nearest preceding tool_use that
 * has no result, stopping at the first tool_use found to avoid misattribution.
 */
export function buildToolResultsMap(blocks: ContentBlock[]): Map<string, ContentBlock> {
  const map = new Map<string, ContentBlock>();

  for (const block of blocks) {
    if (block.type !== 'tool_result') continue;
    for (const ref of [block.tool_use_id, block.toolCallId]) {
      if (ref) map.set(ref, block);
    }
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.type !== 'tool_result') continue;
    const isError = block.is_error || block.isError;
    if (!isError || block.tool_use_id) continue;
    // Find the immediately preceding tool_use that doesn't have a result.
    // Always break on the first tool_use found - either we matched it or it
    // already has a result, in which case we can't safely attribute this error.
    for (let j = i - 1; j >= 0; j--) {
      const prevBlock = blocks[j];
      if (prevBlock.type === 'tool_use') {
        const key = prevBlock.id ?? prevBlock.toolCallId;
        if (key && !findToolResult(map, prevBlock)) {
          map.set(key, block);
        }
        break;
      }
    }
  }

  return map;
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
 * String form of the result payload for error-text sniffing. Returns `''`
 * when no text can be extracted from the payload.
 */
export function getToolResultText(result: ContentBlock | null | undefined): string {
  return extractPayloadText(getToolResultPayload(result)) ?? '';
}
