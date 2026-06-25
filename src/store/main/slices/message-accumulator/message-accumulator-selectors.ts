/**
 * Message Accumulator Selectors (Main Process)
 */

import { createMainSelector } from '../../create-main-selector';
import type { ContentBlock } from '../../../../shared/types';
import { buildOrderedContentBlocks } from '../../../../shared/utils/content-block-utils';
import type { AccumulatorStats, SerializedAccumulatedMessage } from './message-accumulator-types';
import { EMPTY_STATS } from './message-accumulator-types';

// ---------------------------------------------------------------------------
// Individual accumulator
// ---------------------------------------------------------------------------

export const selectAccumulator = createMainSelector<
  [sessionId: string],
  SerializedAccumulatedMessage | undefined
>((state, sessionId) => state.messageAccumulator.accumulators[sessionId]);

export const selectPartialContent = createMainSelector<
  [sessionId: string],
  { content: string; contentBlocks: ContentBlock[] }
>((state, sessionId) => {
  const acc = state.messageAccumulator.accumulators[sessionId];
  if (!acc) return { content: '', contentBlocks: [] };

  const blocks = buildContentBlocksFromRanges(acc);

  // Backward compatibility fallback
  if (acc.orderedItems.length === 0 && blocks.length === 0) {
    if (acc.content) {
      blocks.push({ type: 'text', text: acc.content } as ContentBlock);
    }
    blocks.push(...acc.contentBlocks);
  }

  return { content: acc.content || '', contentBlocks: blocks };
});

// ---------------------------------------------------------------------------
// Collection queries
// ---------------------------------------------------------------------------

export const selectActiveSessionIds = createMainSelector<[], string[]>((state) =>
  Object.keys(state.messageAccumulator.accumulators),
);

export const selectAccumulatorStats = createMainSelector<[], AccumulatorStats>(
  (state) => state.messageAccumulator.stats ?? EMPTY_STATS,
);

export const selectHasAccumulator = createMainSelector<[sessionId: string], boolean>(
  (state, sessionId) => sessionId in state.messageAccumulator.accumulators,
);

function buildContentBlocksFromRanges(acc: SerializedAccumulatedMessage): ContentBlock[] {
  return buildOrderedContentBlocks(
    acc.orderedItems.map((item) => {
      if (item.type === 'block') return item;
      return {
        sequence: item.sequence,
        type: 'text' as const,
        content: acc.content.slice(item.contentRange.start, item.contentRange.end),
      };
    }),
    '',
  );
}
