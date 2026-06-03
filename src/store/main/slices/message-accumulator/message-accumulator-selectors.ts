/**
 * Message Accumulator Selectors (Main Process)
 */

import { store } from "../../configured-store";
import type { ContentBlock } from "../../../../shared/types";
import type {
  AccumulatorStats,
  SerializedAccumulatedMessage,
} from "./message-accumulator-types";
import { EMPTY_STATS } from "./message-accumulator-types";

// ---------------------------------------------------------------------------
// Individual accumulator
// ---------------------------------------------------------------------------

export const selectAccumulator = store.createSelector<[sessionId: string], SerializedAccumulatedMessage | undefined>(
  (state, sessionId) => state.messageAccumulator.accumulators[sessionId],
);

export const selectPartialContent = store.createSelector<[sessionId: string], { content: string; contentBlocks: ContentBlock[] }>(
  (state, sessionId) => {
    const acc = state.messageAccumulator.accumulators[sessionId];
    if (!acc) return { content: "", contentBlocks: [] };

    // Build ordered content blocks from ordered items
    const blocks: ContentBlock[] = [];
    let currentText = "";

    for (const item of acc.orderedItems) {
      if (item.type === "text") {
        currentText += item.content as string;
      } else {
        if (currentText) {
          blocks.push({ type: "text", text: currentText } as ContentBlock);
          currentText = "";
        }
        blocks.push(item.content as ContentBlock);
      }
    }
    if (currentText) {
      blocks.push({ type: "text", text: currentText } as ContentBlock);
    }

    // Backward compatibility fallback
    if (acc.orderedItems.length === 0 && blocks.length === 0) {
      if (acc.content) {
        blocks.push({ type: "text", text: acc.content } as ContentBlock);
      }
      blocks.push(...acc.contentBlocks);
    }

    return { content: acc.content || "", contentBlocks: blocks };
  },
);

// ---------------------------------------------------------------------------
// Collection queries
// ---------------------------------------------------------------------------

export const selectActiveSessionIds = store.createSelector<[], string[]>(
  (state) => Object.keys(state.messageAccumulator.accumulators),
);

export const selectAccumulatorStats = store.createSelector<[], AccumulatorStats>(
  (state) => state.messageAccumulator.stats ?? EMPTY_STATS,
);

export const selectHasAccumulator = store.createSelector<[sessionId: string], boolean>(
  (state, sessionId) => sessionId in state.messageAccumulator.accumulators,
);

