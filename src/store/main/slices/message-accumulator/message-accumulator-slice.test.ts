import { describe, expect, it } from "vitest";
import {
  messageAccumulatorReducer,
  initialState,
  startAccumulation,
  addChunk,
  addContentBlock,
  updateContentBlock,
  completeAccumulation,
  clearAccumulator,
  clearAllAccumulators,
  cleanupStaleAccumulators,
} from "./message-accumulator-slice";
import type { MessageAccumulatorState } from "./message-accumulator-types";
import type { ContentBlock } from "../../../../shared/types";

const SID = "session-1";

function applyActions(
  state: MessageAccumulatorState,
  ...actions: { type: string; payload?: unknown }[]
): MessageAccumulatorState {
  return actions.reduce(
    (s, a) => messageAccumulatorReducer(s, a),
    state,
  );
}

describe("message-accumulator-slice", () => {
  describe("startAccumulation", () => {
    it("creates a new accumulator for a session", () => {
      const state = messageAccumulatorReducer(initialState, startAccumulation(SID));
      expect(state.accumulators[SID]).toBeDefined();
      expect(state.accumulators[SID].sessionId).toBe(SID);
      expect(state.accumulators[SID].content).toBe("");
      expect(state.accumulators[SID].isComplete).toBe(false);
      expect(state.stats.activeAccumulators).toBe(1);
    });

    it("stores metadata", () => {
      const meta = { role: "assistant", messageId: "m-1" };
      const state = messageAccumulatorReducer(initialState, startAccumulation(SID, meta));
      expect(state.accumulators[SID].metadata).toEqual(meta);
    });

    it("restarts an existing session (clears old data)", () => {
      let state = applyActions(
        initialState,
        startAccumulation(SID),
        addChunk(SID, "hello", 5),
      );
      expect(state.accumulators[SID].content).toBe("hello");

      state = messageAccumulatorReducer(state, startAccumulation(SID));
      expect(state.accumulators[SID].content).toBe("");
      expect(state.accumulators[SID].chunkCount).toBe(0);
      // activeAccumulators should stay the same (restart, not new)
      expect(state.stats.activeAccumulators).toBe(1);
    });
  });

  describe("addChunk", () => {
    it("appends text content", () => {
      const state = applyActions(
        initialState,
        startAccumulation(SID),
        addChunk(SID, "Hello, ", 7),
        addChunk(SID, "world!", 6),
      );
      expect(state.accumulators[SID].content).toBe("Hello, world!");
      expect(state.accumulators[SID].chunkCount).toBe(2);
      expect(state.accumulators[SID].byteSize).toBe(13);
    });

    it("ignores chunks for non-existent sessions", () => {
      const state = messageAccumulatorReducer(initialState, addChunk("nope", "x", 1));
      expect(state).toBe(initialState);
    });

    it("ignores chunks for completed sessions", () => {
      let state = applyActions(
        initialState,
        startAccumulation(SID),
        addChunk(SID, "done", 4),
        completeAccumulation(SID),
      );
      const before = state.accumulators[SID];
      state = messageAccumulatorReducer(state, addChunk(SID, "late", 4));
      expect(state.accumulators[SID]).toBe(before);
    });

    it("detects duplicate chunks by sequenceNumber and content", () => {
      const state = applyActions(
        initialState,
        startAccumulation(SID),
        addChunk(SID, "a", 1, { sequenceNumber: 1 }),
        addChunk(SID, "a", 1, { sequenceNumber: 1 }), // duplicate
      );
      expect(state.accumulators[SID].content).toBe("a");
      expect(state.accumulators[SID].chunkCount).toBe(1);
    });

    it("consolidates consecutive text items in orderedItems", () => {
      const state = applyActions(
        initialState,
        startAccumulation(SID),
        addChunk(SID, "a", 1),
        addChunk(SID, "b", 1),
      );
      // Should be a single text item "ab", not two items
      expect(state.accumulators[SID].orderedItems).toHaveLength(1);
      expect(state.accumulators[SID].orderedItems[0].content).toBe("ab");
    });

    it("updates global statistics", () => {
      const state = applyActions(
        initialState,
        startAccumulation(SID),
        addChunk(SID, "abc", 3),
      );
      expect(state.stats.totalBytesAccumulated).toBe(3);
      expect(state.stats.totalChunksProcessed).toBe(1);
      expect(state.stats.largestMessage).toBe(3);
    });

    it("keeps at most 20 recent chunks", () => {
      const actions: { type: string; payload?: unknown }[] = [startAccumulation(SID)];
      for (let i = 0; i < 25; i++) {
        actions.push(addChunk(SID, `c${i}`, 2));
      }
      const state = applyActions(initialState, ...actions);
      expect(state.accumulators[SID].chunks.length).toBeLessThanOrEqual(20);
    });
  });

  describe("addContentBlock / updateContentBlock", () => {
    const block: ContentBlock = { type: "tool_use", id: "b-1", name: "read" } as ContentBlock;

    it("adds a content block and creates an ordered item", () => {
      const state = applyActions(
        initialState,
        startAccumulation(SID),
        addContentBlock(SID, block),
      );
      expect(state.accumulators[SID].contentBlocks).toHaveLength(1);
      expect(state.accumulators[SID].orderedItems).toHaveLength(1);
      expect(state.accumulators[SID].orderedItems[0].type).toBe("block");
    });

    it("updates an existing content block by id", () => {
      const updated = { ...block, name: "write" };
      const state = applyActions(
        initialState,
        startAccumulation(SID),
        addContentBlock(SID, block),
        updateContentBlock(SID, updated),
      );
      expect((state.accumulators[SID].contentBlocks[0] as any).name).toBe("write");
    });

    it("returns unchanged state when updating a non-existent block", () => {
      let state = applyActions(initialState, startAccumulation(SID));
      const before = state;
      state = messageAccumulatorReducer(state, updateContentBlock(SID, { type: "text", id: "nope" } as ContentBlock));
      expect(state).toBe(before);
    });
  });

  describe("completeAccumulation", () => {
    it("marks the accumulator as complete", () => {
      const state = applyActions(
        initialState,
        startAccumulation(SID),
        addChunk(SID, "hello", 5),
        completeAccumulation(SID),
      );
      expect(state.accumulators[SID].isComplete).toBe(true);
    });

    it("builds final content from ordered items", () => {
      const block: ContentBlock = { type: "tool_use", id: "b-1", name: "read" } as ContentBlock;
      const state = applyActions(
        initialState,
        startAccumulation(SID),
        addChunk(SID, "before ", 7),
        addContentBlock(SID, block),
        addChunk(SID, "after", 5),
        completeAccumulation(SID),
      );
      // Content blocks should contain text + block + text
      expect(state.accumulators[SID].contentBlocks.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("clearAccumulator", () => {
    it("removes a specific session", () => {
      let state = applyActions(
        initialState,
        startAccumulation(SID),
        startAccumulation("session-2"),
      );
      expect(state.stats.activeAccumulators).toBe(2);

      state = messageAccumulatorReducer(state, clearAccumulator(SID));
      expect(state.accumulators[SID]).toBeUndefined();
      expect(state.accumulators["session-2"]).toBeDefined();
      expect(state.stats.activeAccumulators).toBe(1);
    });

    it("no-ops on non-existent session", () => {
      const state = messageAccumulatorReducer(initialState, clearAccumulator("nope"));
      expect(state).toBe(initialState);
    });
  });

  describe("clearAllAccumulators", () => {
    it("removes all accumulators and resets active count", () => {
      let state = applyActions(
        initialState,
        startAccumulation(SID),
        startAccumulation("session-2"),
      );
      state = messageAccumulatorReducer(state, clearAllAccumulators());
      expect(Object.keys(state.accumulators)).toHaveLength(0);
      expect(state.stats.activeAccumulators).toBe(0);
    });
  });

  describe("cleanupStaleAccumulators", () => {
    it("removes specified stale sessions", () => {
      let state = applyActions(
        initialState,
        startAccumulation(SID),
        startAccumulation("session-2"),
        startAccumulation("session-3"),
      );
      state = messageAccumulatorReducer(state, cleanupStaleAccumulators([SID, "session-3"]));
      expect(state.accumulators[SID]).toBeUndefined();
      expect(state.accumulators["session-2"]).toBeDefined();
      expect(state.accumulators["session-3"]).toBeUndefined();
      expect(state.stats.activeAccumulators).toBe(1);
    });

    it("no-ops on empty list", () => {
      const state = applyActions(initialState, startAccumulation(SID));
      const result = messageAccumulatorReducer(state, cleanupStaleAccumulators([]));
      expect(result).toBe(state);
    });
  });
});
