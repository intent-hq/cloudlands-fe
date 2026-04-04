/**
 * Message Accumulator slice (Main Process)
 *
 * Re-exports public API for convenience.
 */

export { messageAccumulatorReducer } from "./message-accumulator-slice";
export {
  startAccumulation,
  addChunk,
  addContentBlock,
  updateContentBlock,
  completeAccumulation,
  clearAccumulator,
  clearAllAccumulators,
  cleanupStaleAccumulators,
} from "./message-accumulator-slice";
export type {
  MessageAccumulatorState,
  SerializedAccumulatedMessage,
  SerializedChunk,
  SerializedAccumulationItem,
  AccumulatorStats,
  AccumulatorConfig,
} from "./message-accumulator-types";
export {
  selectAccumulator,
  selectPartialContent,
  selectActiveSessionIds,
  selectAccumulatorStats,
  selectHasAccumulator,
} from "./message-accumulator-selectors";

