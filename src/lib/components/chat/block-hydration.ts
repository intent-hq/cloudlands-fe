/**
 * Lazy full-block hydration helpers (PROTOCOL §5.5 slim projection → v7.2
 * `agent.getMessageBlock`).
 *
 * Slim conversation reads replace oversized `tool_use.input` /
 * `tool_result.output` bodies with bounded previews (`inputTruncated` /
 * `outputTruncated`) and oversized `image.data` with a write-time thumbnail
 * or nothing (`dataTruncated`, `dataIsThumbnail`). These pure helpers let the
 * renderer components substitute the cached full blocks (fetched on demand
 * into the chat-state `hydratedBlocks` map) back into a message's content
 * before rendering, and answer per-block truncation/pending questions.
 * Dependency-light by design: no store imports — components own dispatching.
 */

import type { ContentBlock } from '$shared/types';
import type { HydratedBlockEntry } from '$store/renderer/slices/chat-state/chat-state-types';
import { hydratedBlockKey } from '$store/renderer/slices/chat-state/chat-state-types';

/** True when the daemon served this block slim-truncated (any body kind). */
export function isSlimTruncatedBlock(block: ContentBlock | null | undefined): boolean {
  if (!block) return false;
  return (
    block.inputTruncated === true ||
    block.outputTruncated === true ||
    block.dataTruncated === true
  );
}

/**
 * Substitute loaded full blocks into a message's content, by block id.
 * Under-budget blocks (no truncation flags) always pass through untouched,
 * and with no `messageId` or an empty cache the ORIGINAL array is returned
 * (referential identity preserved — no downstream re-render).
 */
export function mergeHydratedContent(
  content: ContentBlock[],
  messageId: string | undefined,
  hydrated: Record<string, HydratedBlockEntry> | undefined,
): ContentBlock[] {
  if (!messageId || !hydrated || content.length === 0) return content;
  let changed = false;
  const merged = content.map((block) => {
    if (!block?.id || !isSlimTruncatedBlock(block)) return block;
    const entry = hydrated[hydratedBlockKey(messageId, block.id)];
    if (entry?.status === 'loaded') {
      changed = true;
      return entry.block;
    }
    return block;
  });
  return changed ? merged : content;
}

/**
 * Block ids a tool row's expand must hydrate: the tool_use's own id when its
 * input is truncated, plus the paired tool_result's id when its output is.
 * Empty for fully under-budget rows — expanding those fetches nothing.
 */
export function truncatedToolBlockIds(
  toolUse: ContentBlock | null | undefined,
  toolResult: ContentBlock | null | undefined,
): string[] {
  const ids: string[] = [];
  if (toolUse?.inputTruncated === true && typeof toolUse.id === 'string') ids.push(toolUse.id);
  if (toolResult?.outputTruncated === true && typeof toolResult.id === 'string') {
    ids.push(toolResult.id);
  }
  return ids;
}

/** True while any of the named blocks' hydration fetches is in flight. */
export function isHydrationPending(
  hydrated: Record<string, HydratedBlockEntry> | undefined,
  messageId: string | undefined,
  blockIds: string[],
): boolean {
  if (!messageId || !hydrated || blockIds.length === 0) return false;
  return blockIds.some(
    (blockId) => hydrated[hydratedBlockKey(messageId, blockId)]?.status === 'loading',
  );
}
