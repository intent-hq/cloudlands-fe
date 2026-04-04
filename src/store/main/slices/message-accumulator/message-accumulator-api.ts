/**
 * Message Accumulator API (Main Process)
 *
 * Thin facade over the Redux slice that provides the same call-site API
 * as the old MessageAccumulatorService singleton. Consumers import
 * these functions instead of the singleton.
 *
 * Write operations dispatch to the main-process Redux store.
 * Read operations use getMainState() for synchronous access.
 */

import { Logger } from "../../../../shared/logger";
import type { ContentBlock } from "../../../../shared/types";
import { mainDispatch, getMainState } from "../../redux-store-bridge";
import {
  startAccumulation as startAccumulationAction,
  addChunk as addChunkAction,
  addContentBlock as addContentBlockAction,
  updateContentBlock as updateContentBlockAction,
  completeAccumulation as completeAccumulationAction,
  clearAccumulator as clearAccumulatorAction,
  clearAllAccumulators as clearAllAccumulatorsAction,
  cleanupStaleAccumulators as cleanupStaleAccumulatorsAction,
} from "./message-accumulator-slice";
import {
  selectAccumulator,
  selectPartialContent,
  selectActiveSessionIds,
  selectAccumulatorStats,
} from "./message-accumulator-selectors";
import type {
  AccumulatorStats,
  SerializedAccumulatedMessage,
} from "./message-accumulator-types";
import { DEFAULT_ACCUMULATOR_CONFIG } from "./message-accumulator-types";

const logger = new Logger("MessageAccumulatorAPI");

// Reusable TextEncoder (non-serializable, kept outside Redux)
const textEncoder = new TextEncoder();

const config = DEFAULT_ACCUMULATOR_CONFIG;

// ============================================================================
// Write Operations
// ============================================================================

export function startAccumulation(sessionId: string, metadata?: Record<string, unknown>): void {
  mainDispatch(startAccumulationAction(sessionId, metadata));
}

export function addChunk(
  sessionId: string,
  chunk: string,
  metadata?: Record<string, unknown>,
): void {
  const state = getMainState();
  const acc = selectAccumulator.select(state, sessionId);

  if (!acc) {
    logger.error("[MessageAccumulatorAPI] No accumulator found for session", { sessionId });
    return;
  }
  if (acc.isComplete) {
    logger.warn("[MessageAccumulatorAPI] Attempting to add chunk to completed accumulator", { sessionId });
    return;
  }

  // Check size limit
  const chunkByteSize = textEncoder.encode(chunk).length;
  if (acc.byteSize + chunkByteSize > config.maxMessageSize) {
    logger.error("[MessageAccumulatorAPI] Message size limit exceeded", {
      sessionId,
      currentSize: acc.byteSize,
      chunkSize: chunkByteSize,
      maxSize: config.maxMessageSize,
    });
    return;
  }

  mainDispatch(addChunkAction(sessionId, chunk, chunkByteSize, metadata));
}

export function addContentBlock(sessionId: string, block: ContentBlock): void {
  mainDispatch(addContentBlockAction(sessionId, block));
}

export function updateContentBlock(sessionId: string, block: ContentBlock): boolean {
  const state = getMainState();
  const acc = selectAccumulator.select(state, sessionId);
  if (!acc || !block.id) return false;

  // Check if block exists before dispatching
  const exists = acc.orderedItems.some(
    (item) => item.type === "block" && (item.content as ContentBlock).id === block.id,
  );
  if (!exists) return false;

  mainDispatch(updateContentBlockAction(sessionId, block));
  return true;
}

export function complete(sessionId: string): SerializedAccumulatedMessage | undefined {
  mainDispatch(completeAccumulationAction(sessionId));
  const state = getMainState();
  return selectAccumulator.select(state, sessionId);
}

export function clear(sessionId: string): void {
  mainDispatch(clearAccumulatorAction(sessionId));
}

export function clearAll(): void {
  mainDispatch(clearAllAccumulatorsAction());
}

// ============================================================================
// Read Operations
// ============================================================================

export function getAccumulated(
  sessionId: string,
): SerializedAccumulatedMessage | undefined {
  return selectAccumulator.select(getMainState(), sessionId);
}

export function getPartialContent(
  sessionId: string,
): { content: string; contentBlocks: ContentBlock[] } {
  return selectPartialContent.select(getMainState(), sessionId);
}

export function getActiveSessionIds(): string[] {
  return selectActiveSessionIds.select(getMainState());
}

export function getStats(): AccumulatorStats {
  return selectAccumulatorStats.select(getMainState());
}

/** Trigger stale cleanup manually (e.g., from memory pressure handler) */
export function cleanupStale(): void {
  // Implemented via saga — dispatch a trigger if needed.
  // For immediate cleanup, read state and dispatch cleanup action directly.
  const state = getMainState();
  const sessionIds = selectActiveSessionIds.select(state);
  const now = Date.now();
  const STALE_TIMEOUT_MS = 5 * 60 * 1000;
  const staleIds = sessionIds.filter((sid) => {
    const acc = selectAccumulator.select(state, sid);
    return acc && now - acc.lastUpdateTime > STALE_TIMEOUT_MS;
  });
  if (staleIds.length > 0) {
    mainDispatch(cleanupStaleAccumulatorsAction(staleIds));
  }
}

