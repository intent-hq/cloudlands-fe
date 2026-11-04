/**
 * Lazy full-block hydration helpers (PROTOCOL §5.5 slim projection →
 * `agent.getMessageBlock`).
 *
 * Slim conversation reads replace oversized `tool_use.input` /
 * `tool_result.output` bodies with bounded previews (`inputTruncated` /
 * `outputTruncated`) and oversized `image.data` with a write-time thumbnail
 * or nothing (`dataTruncated`, `dataIsThumbnail`). A message that alone is
 * over the page budget also has its long text/thinking bodies cut to
 * previews (`textTruncated`) and, if still too big, its newest blocks
 * replaced by `{ id, type, bodyOmitted }` stubs. These pure helpers let the
 * renderer components substitute the cached full blocks (fetched on demand
 * into the chat-state `hydratedBlocks` map) back into a message's content
 * before rendering, and answer per-block truncation/pending questions.
 * Dependency-light by design: no store imports — components own dispatching.
 */

import type { ContentBlock } from '$shared/types';
import type {
  HydratedBlockEntry,
  HydratedBlockTruncation,
} from '$store/renderer/slices/chat-state/chat-state-types';
import { hydratedBlockKey } from '$store/renderer/slices/chat-state/chat-state-types';

/** True when the daemon served this block slim-truncated (any body kind). */
function isSlimTruncatedBlock(block: ContentBlock | null | undefined): boolean {
  if (!block) return false;
  return (
    block.inputTruncated === true ||
    block.outputTruncated === true ||
    block.dataTruncated === true ||
    isCutMessageBlock(block)
  );
}

/**
 * True for a block the single-message bound cut (§5.5): a `text` / `thinking`
 * preview (`textTruncated`) or a `{ id, type, bodyOmitted }` stub. These are
 * loaded through the message-level "Show full message" action.
 */
function isCutMessageBlock(block: ContentBlock): boolean {
  return block.textTruncated === true || block.bodyOmitted === true;
}

/**
 * Ids of the blocks the single-message bound cut (§5.5) that are not yet
 * loaded: text/thinking previews and omitted-block stubs. Empty for every
 * message at or under the page budget.
 */
export function cutMessageBlockIds(
  content: ContentBlock[],
  messageId: string | undefined,
  hydrated: Record<string, HydratedBlockEntry> | undefined,
): string[] {
  if (!messageId) return [];
  const ids: string[] = [];
  for (const block of content) {
    if (!block || typeof block.id !== 'string' || !isCutMessageBlock(block)) continue;
    if (hydrated?.[hydratedBlockKey(messageId, block.id)]?.status === 'loaded') continue;
    ids.push(block.id);
  }
  return ids;
}

/**
 * Drop omitted-block stubs (`bodyOmitted`) that are still unloaded, so the
 * renderer never draws an empty tool row or text block for them; the
 * message's "Show full message" action brings them back. Returns the
 * ORIGINAL array when there is no stub (referential identity preserved).
 */
export function withoutOmittedStubs(content: ContentBlock[]): ContentBlock[] {
  if (!content.some((block) => block?.bodyOmitted === true)) return content;
  return content.filter((block) => block?.bodyOmitted !== true);
}

/**
 * A capped read served the block cut (§5.5 "Capped and paged block reads").
 * A string body cut on a character boundary (`encoding: "text"`) replaces the
 * slim preview: it keeps its type and is far longer. Any other cut — a
 * structured body served as a JSON text slice, an image without its bytes,
 * or a block reduced to `{ id, type }` — keeps the slim block, whose
 * structured preview or thumbnail still renders correctly. Either way the
 * block is marked with `servedTruncation` so the view shows a notice.
 */
function mergeTruncatedBlock(
  slim: ContentBlock,
  served: ContentBlock,
  truncation: HydratedBlockTruncation,
): ContentBlock {
  const body = truncation.field
    ? (served as unknown as Record<string, unknown>)[truncation.field]
    : undefined;
  if (truncation.encoding === 'text' && typeof body === 'string') {
    return {
      ...served,
      servedTruncation: { shownBytes: truncation.shownBytes, totalBytes: truncation.totalBytes },
    };
  }
  // An omitted-block stub has no preview to fall back to: show what the
  // capped read served (its structural fields plus any body slice).
  if (slim.bodyOmitted === true) {
    return { ...served, servedTruncation: { shownBytes: null, totalBytes: truncation.totalBytes } };
  }
  return { ...slim, servedTruncation: { shownBytes: null, totalBytes: truncation.totalBytes } };
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
      return entry.truncation
        ? mergeTruncatedBlock(block, entry.block, entry.truncation)
        : entry.block;
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
