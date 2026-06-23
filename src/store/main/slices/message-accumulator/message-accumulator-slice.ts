/**
 * Message Accumulator Redux Slice (Main Process)
 *
 * Manages serializable state for streaming message accumulation.
 * TextEncoder is kept outside Redux; periodic stale cleanup lives in the saga.
 */

import flatstr from 'flatstr';
import { createAction } from '@augmentcode/ag-redux-toolkit/utils/store/create-action';
import { createReducer } from '@augmentcode/ag-redux-toolkit/utils/store/create-reducer';
import type { ContentBlock } from '../../../../shared/types';
import { buildOrderedContentBlocks } from '../../../../shared/utils/content-block-utils';
import type {
  MessageAccumulatorState,
  SerializedAccumulatedMessage,
  SerializedAccumulationItem,
  SerializedChunk,
} from './message-accumulator-types';
import { EMPTY_ACCUMULATOR_STATE } from './message-accumulator-types';

const RECENT_CHUNK_LIMIT = 20;
const DUPLICATE_CHUNK_WINDOW = 10;

// ============================================================================
// Actions
// ============================================================================

export const startAccumulation = createAction(
  'messageAccumulator/startAccumulation',
  (sessionId: string, metadata?: Record<string, unknown>) => ({
    sessionId,
    metadata,
    now: Date.now(),
  }),
);

export const addChunk = createAction(
  'messageAccumulator/addChunk',
  (
    sessionId: string,
    chunk: string,
    chunkByteSize: number,
    metadata?: Record<string, unknown>,
  ) => ({ sessionId, chunk, chunkByteSize, metadata, now: Date.now() }),
);

export const addContentBlock = createAction(
  'messageAccumulator/addContentBlock',
  (sessionId: string, block: ContentBlock) => ({ sessionId, block, now: Date.now() }),
);

export const updateContentBlock = createAction(
  'messageAccumulator/updateContentBlock',
  (sessionId: string, block: ContentBlock) => ({ sessionId, block, now: Date.now() }),
);

export const completeAccumulation = createAction<[sessionId: string]>(
  'messageAccumulator/completeAccumulation',
);

export const clearAccumulator = createAction<[sessionId: string]>(
  'messageAccumulator/clearAccumulator',
);

export const clearAllAccumulators = createAction('messageAccumulator/clearAllAccumulators');

export const cleanupStaleAccumulators = createAction<[staleSessionIds: string[]]>(
  'messageAccumulator/cleanupStaleAccumulators',
);

// ============================================================================
// Initial State
// ============================================================================

export const initialState: MessageAccumulatorState = { ...EMPTY_ACCUMULATOR_STATE };

// ============================================================================
// Reducer
// ============================================================================

export const messageAccumulatorReducer = createReducer<MessageAccumulatorState>(initialState)
  .with(startAccumulation, (state, { payload: { sessionId, metadata, now } }) => {
    // If accumulator exists, clear it first (restart)

    const { [sessionId]: _removed, ...restAccumulators } = state.accumulators;

    const { [sessionId]: _removedSeq, ...restCounters } = state.sequenceCounters;
    const previouslyExisted = sessionId in state.accumulators;

    const accumulator: SerializedAccumulatedMessage = {
      sessionId,
      content: '',
      chunks: [],
      contentBlocks: [],
      orderedItems: [],
      startTime: now,
      lastUpdateTime: now,
      byteSize: 0,
      chunkCount: 0,
      isComplete: false,
      metadata,
    };

    const prevActive = state.stats.activeAccumulators;
    return {
      ...state,
      accumulators: { ...restAccumulators, [sessionId]: accumulator },
      sequenceCounters: { ...restCounters, [sessionId]: 0 },
      stats: {
        ...state.stats,
        activeAccumulators: previouslyExisted ? prevActive : prevActive + 1,
      },
    };
  })

  .with(addChunk, (state, { payload: { sessionId, chunk, chunkByteSize, metadata, now } }) => {
    const accumulator = state.accumulators[sessionId];
    if (!accumulator || accumulator.isComplete) return state;

    const seqCounter = state.sequenceCounters[sessionId] ?? 0;
    const sequenceNumber = (metadata as any)?.sequenceNumber ?? seqCounter + 1;

    const contentHash = hashChunkContent(chunk);

    // Duplicate detection on recent chunk metadata only.
    const recentChunks = accumulator.chunks.slice(-DUPLICATE_CHUNK_WINDOW);
    const isDuplicate = recentChunks.some(
      (c) =>
        c.sequenceNumber === sequenceNumber &&
        c.contentHash === contentHash &&
        c.byteSize === chunkByteSize,
    );
    if (isDuplicate) return state;

    const insertOffset = getChunkInsertOffset(accumulator, sequenceNumber);
    const updatedContent = insertStringAt(accumulator.content, insertOffset, chunk);
    const shiftedChunks = shiftChunkOffsets(accumulator.chunks, insertOffset, chunk.length);
    const chunkEndOffset = insertOffset + chunk.length;

    const newChunk: SerializedChunk = {
      contentHash,
      byteSize: chunkByteSize,
      startOffset: insertOffset,
      endOffset: chunkEndOffset,
      timestamp: now,
      sequenceNumber,
    };

    // Keep last 20 chunk metadata records only.
    const updatedChunks = [...shiftedChunks, newChunk];
    if (updatedChunks.length > RECENT_CHUNK_LIMIT) updatedChunks.shift();

    const updatedOrderedItems = updateOrderedTextRanges(
      accumulator.orderedItems,
      insertOffset,
      chunkEndOffset,
      now,
    );

    const newByteSize = accumulator.byteSize + chunkByteSize;
    const newChunkCount = accumulator.chunkCount + 1;

    return {
      ...state,
      accumulators: {
        ...state.accumulators,
        [sessionId]: {
          ...accumulator,
          content: updatedContent,
          chunks: updatedChunks,
          orderedItems: updatedOrderedItems,
          byteSize: newByteSize,
          chunkCount: newChunkCount,
          lastUpdateTime: now,
        },
      },
      sequenceCounters: { ...state.sequenceCounters, [sessionId]: sequenceNumber },
      stats: {
        ...state.stats,
        totalBytesAccumulated: state.stats.totalBytesAccumulated + chunkByteSize,
        totalChunksProcessed: state.stats.totalChunksProcessed + 1,
        largestMessage: Math.max(state.stats.largestMessage, newByteSize),
      },
    };
  })

  .with(addContentBlock, (state, { payload: { sessionId, block, now } }) => {
    const accumulator = state.accumulators[sessionId];
    if (!accumulator) return state;

    const blockItem: SerializedAccumulationItem = {
      sequence: accumulator.orderedItems.length,
      type: 'block',
      content: block,
      timestamp: now,
    };

    return {
      ...state,
      accumulators: {
        ...state.accumulators,
        [sessionId]: {
          ...accumulator,
          contentBlocks: [...accumulator.contentBlocks, block],
          orderedItems: [...accumulator.orderedItems, blockItem],
          lastUpdateTime: now,
        },
      },
    };
  })

  .with(updateContentBlock, (state, { payload: { sessionId, block, now } }) => {
    const accumulator = state.accumulators[sessionId];
    if (!accumulator || !block.id) return state;

    let found = false;

    const updatedOrderedItems = accumulator.orderedItems.map((item) => {
      if (item.type === 'block') {
        const existing = item.content as ContentBlock;
        if (existing.id === block.id) {
          found = true;
          return { ...item, content: block, timestamp: now };
        }
      }
      return item;
    });

    if (!found) return state;

    const updatedContentBlocks = accumulator.contentBlocks.map((b) =>
      b.id === block.id ? block : b,
    );

    return {
      ...state,
      accumulators: {
        ...state.accumulators,
        [sessionId]: {
          ...accumulator,
          contentBlocks: updatedContentBlocks,
          orderedItems: updatedOrderedItems,
          lastUpdateTime: now,
        },
      },
    };
  })

  .with(completeAccumulation, (state, { payload: [sessionId] }) => {
    const accumulator = state.accumulators[sessionId];
    if (!accumulator) return state;

    // Build final content blocks from ordered items
    const finalContentBlocks = buildOrderedContentBlocksFromAccumulator(accumulator);

    // Update average message size estimate
    const totalMessages =
      state.stats.totalChunksProcessed > 0 ? Math.ceil(state.stats.totalChunksProcessed / 10) : 1;
    const averageMessageSize = Math.round(state.stats.totalBytesAccumulated / totalMessages);

    return {
      ...state,
      accumulators: {
        ...state.accumulators,
        [sessionId]: {
          ...accumulator,
          chunks: [],
          contentBlocks: finalContentBlocks,
          isComplete: true,
        },
      },
      stats: {
        ...state.stats,
        averageMessageSize,
      },
    };
  })

  .with(clearAccumulator, (state, { payload: [sessionId] }) => {
    if (!(sessionId in state.accumulators)) return state;

    const { [sessionId]: _removed, ...restAccumulators } = state.accumulators;

    const { [sessionId]: _removedSeq, ...restCounters } = state.sequenceCounters;
    return {
      ...state,
      accumulators: restAccumulators,
      sequenceCounters: restCounters,
      stats: {
        ...state.stats,
        activeAccumulators: Math.max(0, state.stats.activeAccumulators - 1),
      },
    };
  })

  .with(clearAllAccumulators, (state) => {
    return {
      ...state,
      accumulators: {},
      sequenceCounters: {},
      stats: {
        ...state.stats,
        activeAccumulators: 0,
      },
    };
  })

  .with(cleanupStaleAccumulators, (state, { payload: [staleSessionIds] }) => {
    if (staleSessionIds.length === 0) return state;
    const accumulators = { ...state.accumulators };
    const sequenceCounters = { ...state.sequenceCounters };
    let removed = 0;
    for (const id of staleSessionIds) {
      if (id in accumulators) {
        delete accumulators[id];
        delete sequenceCounters[id];
        removed++;
      }
    }
    if (removed === 0) return state;
    return {
      ...state,
      accumulators,
      sequenceCounters,
      stats: {
        ...state.stats,
        activeAccumulators: Math.max(0, state.stats.activeAccumulators - removed),
      },
    };
  });

// ============================================================================
// Helper: Build ordered content blocks from accumulated items
// ============================================================================

function buildOrderedContentBlocksFromAccumulator(
  accumulator: SerializedAccumulatedMessage,
): ContentBlock[] {
  const blocks = buildOrderedContentBlocks(
    accumulator.orderedItems.map((item) => {
      if (item.type === 'block') return item;
      return {
        sequence: item.sequence,
        type: 'text' as const,
        content: accumulator.content.slice(item.contentRange.start, item.contentRange.end),
      };
    }),
    '',
  );

  // Backward compatibility fallback
  if (accumulator.orderedItems.length === 0 && blocks.length === 0) {
    const fallback: ContentBlock[] = [];
    if (accumulator.content) {
      fallback.push({ type: 'text', text: accumulator.content } as ContentBlock);
    }
    fallback.push(...accumulator.contentBlocks);
    return fallback;
  }

  return blocks;
}

function hashChunkContent(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function getChunkInsertOffset(
  accumulator: SerializedAccumulatedMessage,
  sequenceNumber: number,
): number {
  const nextChunk = [...accumulator.chunks]
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
    .find((chunk) => chunk.sequenceNumber > sequenceNumber);
  return nextChunk?.startOffset ?? accumulator.content.length;
}

function insertStringAt(value: string, offset: number, inserted: string): string {
  // Hot path: in-order append builds a cheap V8 cons-string (rope) that is
  // flattened lazily on first read, instead of forcing an O(n) flatten per chunk.
  if (offset >= value.length) return value + inserted;
  if (offset <= 0) return inserted + value;
  // Out-of-order mid-insertion (rare): materialize the spliced result once.
  return flatstr(value.slice(0, offset) + inserted + value.slice(offset));
}

function shiftChunkOffsets(
  chunks: SerializedChunk[],
  insertOffset: number,
  insertedLength: number,
): SerializedChunk[] {
  return chunks.map((chunk) => {
    if (chunk.startOffset < insertOffset) return chunk;
    return {
      ...chunk,
      startOffset: chunk.startOffset + insertedLength,
      endOffset: chunk.endOffset + insertedLength,
    };
  });
}

function updateOrderedTextRanges(
  items: SerializedAccumulationItem[],
  startOffset: number,
  endOffset: number,
  timestamp: number,
): SerializedAccumulationItem[] {
  const insertedLength = endOffset - startOffset;
  const lastItem = items[items.length - 1];

  if (lastItem?.type === 'text' && lastItem.contentRange.end === startOffset) {
    return [
      ...items.slice(0, -1),
      {
        ...lastItem,
        contentRange: { ...lastItem.contentRange, end: endOffset },
        timestamp,
      },
    ];
  }

  const containingTextIndex = items.findIndex(
    (item) =>
      item.type === 'text' &&
      startOffset >= item.contentRange.start &&
      startOffset < item.contentRange.end,
  );

  if (containingTextIndex >= 0) {
    return items.map((item, index) => {
      if (item.type === 'block') return item;
      if (index === containingTextIndex) {
        return {
          ...item,
          contentRange: {
            start: item.contentRange.start,
            end: item.contentRange.end + insertedLength,
          },
          timestamp,
        };
      }
      if (index > containingTextIndex) {
        return {
          ...item,
          contentRange: {
            start: item.contentRange.start + insertedLength,
            end: item.contentRange.end + insertedLength,
          },
        };
      }
      return item;
    });
  }

  return [
    ...items.map((item) => {
      if (item.type === 'block' || item.contentRange.start < startOffset) {
        return item;
      }
      return {
        ...item,
        contentRange: {
          start: item.contentRange.start + insertedLength,
          end: item.contentRange.end + insertedLength,
        },
      };
    }),
    {
      sequence: items.length,
      type: 'text',
      contentRange: { start: startOffset, end: endOffset },
      timestamp,
    },
  ];
}
