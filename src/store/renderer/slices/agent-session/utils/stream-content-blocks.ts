import type { ContentBlock } from '$shared/types';

type StreamEventType = 'started' | 'chunk' | 'content-blocks' | 'complete' | 'error' | 'timeout';

/**
 * Stable identity of a block across the two transcript writers (the standing
 * `chat.subscribe` stream and the `agent:*` firehose accumulator): tool_use
 * pairs by `toolCallId`, tool_result by `tool_use_id` (PROTOCOL §7), and every
 * other block by the daemon's `{messageId}:{index}` block id. Legacy id-less
 * blocks (e.g. chunk-accumulated text) have no strong identity and fall back
 * to same-type ordinal matching in `mergeStreamContentBlocks`.
 */
function blockIdentity(block: ContentBlock): string | undefined {
  if (block.type === 'tool_use' && typeof block.toolCallId === 'string' && block.toolCallId) {
    return `use:${block.toolCallId}`;
  }
  if (block.type === 'tool_result' && typeof block.tool_use_id === 'string' && block.tool_use_id) {
    return `result:${block.tool_use_id}`;
  }
  return typeof block.id === 'string' && block.id ? `id:${block.id}` : undefined;
}

/**
 * Merge a stream update's blocks into the message's current blocks WITHOUT
 * deleting blocks the update does not carry (monorepo#2814).
 *
 * Post-intentd#775 the firehose carries no assistant text, so its per-turn
 * accumulator is text-starved (tool blocks only). The standing `chat.subscribe`
 * stream is the transcript's sole canonical content writer (PROTOCOL §7.1);
 * when it owns the in-flight message, a wholesale replace by an
 * `agent:tool:call` dispatch deletes the leading group-tag text block and the
 * transcript flips grouped ↔ ungrouped once per tool call. Merging by block
 * identity updates the blocks the firehose does know about (tool status ticks)
 * while preserving everything it does not.
 *
 * When NO subscription owns the message (background agents / list previews),
 * the existing blocks were built by the same firehose accumulator, so every
 * existing block matches an incoming one and the merge degenerates to the old
 * replace — behavior there is unchanged.
 *
 * Matching: strong identity first (`blockIdentity`), then id-less blocks pair
 * with id-less incoming blocks of the same type in order. Matched blocks take
 * the incoming copy (position follows incoming order); unmatched existing
 * blocks keep their relative position; unmatched incoming blocks append in
 * incoming order. Blocks are never removed — the subscription's next
 * `replaceMessages` emit stays the canonical arbiter.
 */
export function mergeStreamContentBlocks(
  existing: ContentBlock[],
  incoming: ContentBlock[],
): ContentBlock[] {
  const matchByExistingIndex = new Array<number>(existing.length).fill(-1);
  const incomingMatched = new Array<boolean>(incoming.length).fill(false);

  const incomingByIdentity = new Map<string, number>();
  incoming.forEach((block, index) => {
    const identity = blockIdentity(block);
    if (identity !== undefined && !incomingByIdentity.has(identity)) {
      incomingByIdentity.set(identity, index);
    }
  });
  existing.forEach((block, index) => {
    const identity = blockIdentity(block);
    if (identity === undefined) return;
    const match = incomingByIdentity.get(identity);
    if (match !== undefined && !incomingMatched[match]) {
      matchByExistingIndex[index] = match;
      incomingMatched[match] = true;
    }
  });

  // Ordinal fallback: same-type blocks pair positionally when at least one
  // side lacks a strong identity (e.g. the id-less placeholder from
  // agent:stream:start paired with the id-stamped first chunk, or a legacy
  // id-less chunk paired with its subscription-written block). Two blocks that
  // BOTH carry (necessarily differing — strong matches ran first) identities
  // are distinct blocks and must both survive.
  //
  // KNOWN CONSTRAINT: an id-less incoming block pairs with the FIRST unmatched
  // same-type existing block, with no way to tell which daemon block it
  // belongs to — so a legacy content-bearing `agent:stream:chunk` without
  // `blockId` could overwrite the wrong text block when several exist. Only
  // that dead wire hits this (post-intentd#775 no daemon emits content-bearing
  // chunks; id-stamped blocks always strong-match first); characterized in
  // stream-content-blocks.test.ts should the chunk wire ever return.
  const unmatchedIncomingByType = new Map<string, number[]>();
  incoming.forEach((block, index) => {
    if (incomingMatched[index]) return;
    const queue = unmatchedIncomingByType.get(block.type);
    if (queue) queue.push(index);
    else unmatchedIncomingByType.set(block.type, [index]);
  });
  existing.forEach((block, index) => {
    if (matchByExistingIndex[index] >= 0) return;
    const existingIdless = blockIdentity(block) === undefined;
    const queue = unmatchedIncomingByType.get(block.type);
    if (!queue) return;
    const queuePos = existingIdless
      ? 0
      : queue.findIndex((i) => blockIdentity(incoming[i]) === undefined);
    if (queuePos < 0 || queuePos >= queue.length) return;
    const match = queue[queuePos];
    queue.splice(queuePos, 1);
    matchByExistingIndex[index] = match;
    incomingMatched[match] = true;
  });

  const result: ContentBlock[] = [];
  let cursor = 0;
  existing.forEach((block, index) => {
    const match = matchByExistingIndex[index];
    if (match < 0) {
      result.push(block);
      return;
    }
    while (cursor <= match && cursor < incoming.length) {
      result.push(incoming[cursor]);
      cursor += 1;
    }
  });
  while (cursor < incoming.length) {
    result.push(incoming[cursor]);
    cursor += 1;
  }
  return result;
}

export function resolveStreamContentBlocks(
  existing: ContentBlock[] | undefined,
  incoming: ContentBlock[] | undefined,
  eventType: StreamEventType,
): ContentBlock[] | undefined {
  if (incoming) {
    return existing && existing.length > 0
      ? mergeStreamContentBlocks(existing, incoming)
      : incoming;
  }
  return eventType === 'complete' || eventType === 'error' || eventType === 'timeout'
    ? existing
    : undefined;
}
