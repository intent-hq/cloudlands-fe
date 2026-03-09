import { describe, it, expect } from "vitest";
import {
  tabScrollReducer,
  saveScrollPosition,
  removeScrollPosition,
  clearForWorkspace,
  loadScrollPositions,
  type TabScrollState,
} from "./tab-scroll-slice";

describe("tabScrollReducer", () => {
  const initialState: TabScrollState = {
    positions: {},
  };

  it("should return initial state", () => {
    const state = tabScrollReducer(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("saveScrollPosition", () => {
    it("should save a scroll position for a tab", () => {
      const state = tabScrollReducer(initialState, saveScrollPosition("tab-1", 150));
      expect(state.positions["tab-1"]).toBe(150);
    });

    it("should not save scroll position when scrollTop is 0", () => {
      const state = tabScrollReducer(initialState, saveScrollPosition("tab-1", 0));
      expect(state).toBe(initialState);
    });

    it("should not save scroll position when scrollTop is negative", () => {
      const state = tabScrollReducer(initialState, saveScrollPosition("tab-1", -10));
      expect(state).toBe(initialState);
    });

    it("should overwrite existing scroll position", () => {
      const stateWithPosition: TabScrollState = {
        positions: { "tab-1": 100 },
      };
      const state = tabScrollReducer(stateWithPosition, saveScrollPosition("tab-1", 200));
      expect(state.positions["tab-1"]).toBe(200);
    });
  });

  describe("removeScrollPosition", () => {
    it("should remove a scroll position for a tab", () => {
      const stateWithPosition: TabScrollState = {
        positions: { "tab-1": 100, "tab-2": 200 },
      };
      const state = tabScrollReducer(stateWithPosition, removeScrollPosition("tab-1"));
      expect(state.positions["tab-1"]).toBeUndefined();
      expect(state.positions["tab-2"]).toBe(200);
    });

    it("should return same state if tab does not exist", () => {
      const state = tabScrollReducer(initialState, removeScrollPosition("nonexistent"));
      expect(state).toBe(initialState);
    });
  });

  describe("clearForWorkspace", () => {
    it("should remove all positions containing the workspace ID", () => {
      const stateWithPositions: TabScrollState = {
        positions: {
          "ws-123-tab-1": 100,
          "ws-123-tab-2": 200,
          "ws-456-tab-1": 300,
        },
      };
      const state = tabScrollReducer(stateWithPositions, clearForWorkspace("ws-123"));
      expect(state.positions).toEqual({ "ws-456-tab-1": 300 });
    });

    it("should return same state if no positions match", () => {
      const stateWithPositions: TabScrollState = {
        positions: { "ws-456-tab-1": 300 },
      };
      const state = tabScrollReducer(stateWithPositions, clearForWorkspace("ws-999"));
      expect(state).toBe(stateWithPositions);
    });
  });

  describe("loadScrollPositions", () => {
    it("should replace all positions with loaded data", () => {
      const stateWithPositions: TabScrollState = {
        positions: { "tab-1": 100 },
      };
      const loaded = { "tab-2": 200, "tab-3": 300 };
      const state = tabScrollReducer(stateWithPositions, loadScrollPositions(loaded));
      expect(state.positions).toEqual(loaded);
    });

    it("should handle empty loaded positions", () => {
      const state = tabScrollReducer(initialState, loadScrollPositions({}));
      expect(state.positions).toEqual({});
    });
  });
});

