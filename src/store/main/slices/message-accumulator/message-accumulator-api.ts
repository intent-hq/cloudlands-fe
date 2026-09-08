/**
 * Message Accumulator API (Main Process)
 *
 * Thin facade over the Redux slice that provides the same call-site API
 * as the old MessageAccumulatorService singleton. Consumers import
 * these functions instead of the singleton.
 *
 * This module owns its transient process-local state and exposes synchronous access.
 */

import { Logger } from '../../../../shared/logger';
import type { MainStoreState } from '../../types';
import {
  startAccumulation as startAccumulationAction,
  addChunk as addChunkAction,
  completeAccumulation as completeAccumulationAction,
  clearAccumulator as clearAccumulatorAction,
  clearAllAccumulators as clearAllAccumulatorsAction,
  messageAccumulatorReducer,
} from './message-accumulator-slice';
import { selectAccumulator, selectAccumulatorStats } from './message-accumulator-selectors';
import type { AccumulatorStats, SerializedAccumulatedMessage } from './message-accumulator-types';
import { DEFAULT_ACCUMULATOR_CONFIG } from './message-accumulator-types';

const logger = new Logger('MessageAccumulatorAPI');

// Reusable TextEncoder (non-serializable, kept outside Redux)
const textEncoder = new TextEncoder();

const config = DEFAULT_ACCUMULATOR_CONFIG;
let accumulatorState = messageAccumulatorReducer(undefined, { type: '@@init' } as any);

/** @internal Test-only reset for the process-local service. */
export function resetMessageAccumulatorState(): void {
  accumulatorState = messageAccumulatorReducer(undefined, { type: '@@init' } as any);
}

function dispatch(action: any): void {
  accumulatorState = messageAccumulatorReducer(accumulatorState, action);
}

function getState(): MainStoreState {
  return { messageAccumulator: accumulatorState } as MainStoreState;
}

// ============================================================================
// Write Operations
// ============================================================================

export function startAccumulation(sessionId: string, metadata?: Record<string, unknown>): void {
  dispatch(startAccumulationAction(sessionId, metadata));
}

export function addChunk(
  sessionId: string,
  chunk: string,
  metadata?: Record<string, unknown>,
): void {
  const state = getState();
  const acc = selectAccumulator.select(state, sessionId);

  if (!acc) {
    logger.error('[MessageAccumulatorAPI] No accumulator found for session', { sessionId });
    return;
  }
  if (acc.isComplete) {
    logger.warn('[MessageAccumulatorAPI] Attempting to add chunk to completed accumulator', {
      sessionId,
    });
    return;
  }

  // Check size limit
  const chunkByteSize = textEncoder.encode(chunk).length;
  if (acc.byteSize + chunkByteSize > config.maxMessageSize) {
    logger.error('[MessageAccumulatorAPI] Message size limit exceeded', {
      sessionId,
      currentSize: acc.byteSize,
      chunkSize: chunkByteSize,
      maxSize: config.maxMessageSize,
    });
    return;
  }

  dispatch(addChunkAction(sessionId, chunk, chunkByteSize, metadata));
}

export function complete(sessionId: string): SerializedAccumulatedMessage | undefined {
  dispatch(completeAccumulationAction(sessionId));
  const state = getState();
  return selectAccumulator.select(state, sessionId);
}

export function clear(sessionId: string): void {
  dispatch(clearAccumulatorAction(sessionId));
}

export function clearAll(): void {
  dispatch(clearAllAccumulatorsAction());
}

// ============================================================================
// Read Operations
// ============================================================================

export function getAccumulated(sessionId: string): SerializedAccumulatedMessage | undefined {
  return selectAccumulator.select(getState(), sessionId);
}

export function getStats(): AccumulatorStats {
  return selectAccumulatorStats.select(getState());
}
