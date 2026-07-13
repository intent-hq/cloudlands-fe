/**
 * Shared utility for building ordered content blocks from stream items.
 *
 * Used by both renderer (agent-stream-lifecycle) and main process
 * (message-accumulator) code to convert interleaved text/block items
 * into a flat ContentBlock array.
 */

import flatstr from 'flatstr';
import type { ContentBlock } from '../types/content-block';

/**
 * Represents an ordered item in a content stream — either accumulated
 * text or a structured content block (tool_use, tool_result, etc.).
 */
export interface StreamOrderedItem {
  type: 'text' | 'block';
  content: string | ContentBlock;
  sequence?: number;
}

/**
 * Build an ordered array of ContentBlocks from interleaved stream items,
 * merging adjacent text runs and optionally appending an un-flushed text
 * buffer at the end.
 *
 * @param items  Ordered stream items (text chunks and structured blocks).
 * @param buffer Remaining text that has not yet been flushed into `items`.
 * @returns      A flat ContentBlock array ready for storage / rendering.
 */
export function buildOrderedContentBlocks(
  items: ReadonlyArray<StreamOrderedItem>,
  buffer: string,
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let textParts: string[] = [];

  for (const item of items) {
    if (item.type === 'text') {
      textParts.push(item.content as string);
    } else if (item.type === 'block') {
      const accumulatedText = textParts.join('');
      if (accumulatedText) {
        blocks.push({ type: 'text' as const, text: flatstr(accumulatedText) });
      }
      textParts = [];
      blocks.push(item.content as ContentBlock);
    }
  }

  const trailingText = textParts.join('');
  if (trailingText) {
    blocks.push({ type: 'text' as const, text: flatstr(trailingText) });
  }

  if (buffer) {
    const lastBlock = blocks[blocks.length - 1];
    if (lastBlock && lastBlock.type === 'text') {
      lastBlock.text = flatstr(lastBlock.text + buffer);
    } else {
      blocks.push({ type: 'text' as const, text: buffer });
    }
  }

  return blocks;
}

