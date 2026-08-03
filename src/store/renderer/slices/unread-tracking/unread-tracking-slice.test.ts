import {
  describe,
  expect,
  it,
} from "vitest";
import {
  initialState,
  markAgentAsViewed,
  clearCurrentlyViewedAgent,
  unreadTrackingReducer,
} from "./unread-tracking-slice";
import type { UnreadTrackingState } from "./unread-tracking-types";

const reduce = unreadTrackingReducer;

describe("unreadTrackingReducer", () => {
  it("should return initial state", () => {
    const state = reduce(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("markAgentAsViewed", () => {
    it("should set currentlyViewedAgentId", () => {
      const state = reduce(initialState, markAgentAsViewed("a1"));
      expect(state.currentlyViewedAgentId).toBe("a1");
    });

    it("should be no-op for empty agentId", () => {
      expect(reduce(initialState, markAgentAsViewed(""))).toBe(initialState);
    });

    it("should return same ref when already viewing same agent", () => {
      const before: UnreadTrackingState = { ...initialState, currentlyViewedAgentId: "a1" };
      expect(reduce(before, markAgentAsViewed("a1"))).toBe(before);
    });
  });

  describe("clearCurrentlyViewedAgent", () => {
    it("should clear the currently viewed agent", () => {
      const before: UnreadTrackingState = { ...initialState, currentlyViewedAgentId: "a1" };
      const state = reduce(before, clearCurrentlyViewedAgent());
      expect(state.currentlyViewedAgentId).toBeNull();
    });

    it("should be no-op when already null", () => {
      expect(reduce(initialState, clearCurrentlyViewedAgent())).toBe(initialState);
    });

    it("should clear when scoped to the currently viewed agent", () => {
      const before: UnreadTrackingState = { ...initialState, currentlyViewedAgentId: "a1" };
      const state = reduce(before, clearCurrentlyViewedAgent("a1"));
      expect(state.currentlyViewedAgentId).toBeNull();
    });

    it("should be no-op when scoped to a different agent", () => {
      const before: UnreadTrackingState = { ...initialState, currentlyViewedAgentId: "a1" };
      expect(reduce(before, clearCurrentlyViewedAgent("a2"))).toBe(before);
    });
  });
});

