/**
 * Shared message completeness comparator.
 *
 * Used across multiple store/restore paths to prevent same-count but
 * shorter/truncated disk data from overwriting richer in-memory data.
 *
 * The comparison logic mirrors what `sessionUpdatedHandler` and
 * `initializeChat` already do inline — extracted here so every
 * store/restore path applies the same rules.
 */

import type { ContentBlock } from '$shared/types/content-block';

/** Minimal message shape needed for comparison. */
export interface ComparableMessage {
  id?: string;
  contentBlocks?: ContentBlock[];
}

/**
 * Sum the text length of all text-type content blocks in a message.
 * Non-text blocks (tool_use, tool_result, etc.) are ignored because
 * their presence is already captured by block count.
 */
function getTextLength(blocks: ContentBlock[]): number {
  let total = 0;
  for (const b of blocks) {
    if (b.type === 'text') {
      total += (b.text?.length || 0) + (b.content?.length || 0);
    }
  }
  return total;
}

/**
 * Compare two message arrays to determine which is "richer" (more complete).
 *
 * Decision order:
 *   1. More messages wins.
 *   2. Same message count → more content blocks in the final message wins.
 *   3. Same block count → more total text length in the final message wins.
 *   4. Otherwise they are equivalent.
 *
 * @returns
 *    1  if `a` is richer
 *   -1  if `b` is richer
 *    0  if they are equivalent
 */
export function compareMessageCompleteness(
  a: { messages: ComparableMessage[] },
  b: { messages: ComparableMessage[] },
): 1 | -1 | 0 {
  const aLen = a.messages?.length || 0;
  const bLen = b.messages?.length || 0;

  // 1. More messages wins
  if (aLen > bLen) return 1;
  if (bLen > aLen) return -1;

  // Both empty or both have same count — compare final message richness
  if (aLen === 0) return 0;

  const aLast = a.messages[aLen - 1];
  const bLast = b.messages[bLen - 1];

  const aBlockCount = aLast?.contentBlocks?.length || 0;
  const bBlockCount = bLast?.contentBlocks?.length || 0;

  // 2. More content blocks wins
  if (aBlockCount > bBlockCount) return 1;
  if (bBlockCount > aBlockCount) return -1;

  // 3. Same block count → compare text length
  const aTextLen = getTextLength(aLast?.contentBlocks || []);
  const bTextLen = getTextLength(bLast?.contentBlocks || []);

  if (aTextLen > bTextLen) return 1;
  if (bTextLen > aTextLen) return -1;

  // 4. Equivalent
  return 0;
}

