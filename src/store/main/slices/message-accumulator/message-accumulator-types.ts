/**
 * Message Accumulator Types
 *
 * Serializable types for the message-accumulator Redux slice.
 * All types are JSON-safe — no Map, Set, Date, RegExp, or functions.
 * Timestamps are stored as epoch milliseconds (number).
 */

import type { ContentBlock } from '../../../../shared/types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface AccumulatorConfig {
  maxMessageSize: number; // Maximum size of accumulated message (bytes)
  flushInterval: number; // Interval to flush partial messages (ms)
  enableCheckpoints: boolean; // Save checkpoints for recovery
  checkpointInterval: number; // Checkpoint save interval (ms)
}

export const DEFAULT_ACCUMULATOR_CONFIG: AccumulatorConfig = {
  maxMessageSize: 20 * 1024 * 1024, // 20MB
  flushInterval: 5000, // 5 seconds
  enableCheckpoints: true,
  checkpointInterval: 1000, // 1 second
};

// ---------------------------------------------------------------------------
// Per-session state (serializable)
// ---------------------------------------------------------------------------

/** A single chunk metadata record (kept for duplicate detection, last 20 only) */
export interface SerializedChunk {
  contentHash: string;
  byteSize: number;
  startOffset: number;
  endOffset: number;
  timestamp: number; // epoch ms
  sequenceNumber: number;
}

export interface SerializedTextRange {
  start: number;
  end: number;
}

export interface SerializedTextAccumulationItem {
  sequence: number;
  type: 'text';
  contentRange: SerializedTextRange;
  timestamp: number; // epoch ms
}

export interface SerializedBlockAccumulationItem {
  sequence: number;
  type: 'block';
  content: ContentBlock;
  timestamp: number; // epoch ms
}

/** An ordered item in the accumulation (text range or content block) */
export type SerializedAccumulationItem =
  | SerializedTextAccumulationItem
  | SerializedBlockAccumulationItem;

/** The complete accumulated message state (serializable) */
export interface SerializedAccumulatedMessage {
  sessionId: string;
  content: string;
  chunks: SerializedChunk[];
  contentBlocks: ContentBlock[];
  orderedItems: SerializedAccumulationItem[];
  startTime: number; // epoch ms
  lastUpdateTime: number; // epoch ms
  byteSize: number;
  chunkCount: number;
  isComplete: boolean;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Global statistics (serializable)
// ---------------------------------------------------------------------------

export interface AccumulatorStats {
  activeAccumulators: number;
  totalBytesAccumulated: number;
  totalChunksProcessed: number;
  averageMessageSize: number;
  largestMessage: number;
}

export const EMPTY_STATS: AccumulatorStats = {
  activeAccumulators: 0,
  totalBytesAccumulated: 0,
  totalChunksProcessed: 0,
  averageMessageSize: 0,
  largestMessage: 0,
};

// ---------------------------------------------------------------------------
// Slice state shape
// ---------------------------------------------------------------------------

export interface MessageAccumulatorState {
  /** Per-session accumulator state: sessionId → message */
  accumulators: Record<string, SerializedAccumulatedMessage>;
  /** Per-session sequence counters */
  sequenceCounters: Record<string, number>;
  /** Global statistics */
  stats: AccumulatorStats;
}

export const EMPTY_ACCUMULATOR_STATE: MessageAccumulatorState = {
  accumulators: {},
  sequenceCounters: {},
  stats: { ...EMPTY_STATS },
};
