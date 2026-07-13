import {
  describe,
  expect,
  it,
} from "vitest";
import {
  initialState,
  hydrateUnreadTracking,
  markAgentAsViewed,
  clearCurrentlyViewedAgent,
  newAssistantMessage,
  clearAgentUnread,
  clearAgentsUnread,
  clearAllUnread,
  unreadTrackingReducer,
} from "./unread-tracking-slice";
import type { UnreadTrackingState } from "./unread-tracking-types";

const reduce = unreadTrackingReducer;

describe("unreadTrackingReducer", () => {
  it("should return initial state", () => {
    const state = reduce(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("hydrateUnreadTracking", () => {
    it("should load persisted data", () => {
      const data = {
        unreadAgentIds: ["a1", "a2"],
      };
      const state = reduce(initialState, hydrateUnreadTracking(data));
      expect(state.unreadAgentIds).toEqual(["a1", "a2"]);
      expect(state.currentlyViewedAgentId).toBeNull();
    });
  });

  describe("markAgentAsViewed", () => {
    it("should set currentlyViewedAgentId and remove from unread", () => {
      const before: UnreadTrackingState = {
        unreadAgentIds: ["a1", "a2"],
        currentlyViewedAgentId: null,
      };
      const state = reduce(before, markAgentAsViewed("a1"));
      expect(state.currentlyViewedAgentId).toBe("a1");
      expect(state.unreadAgentIds).toEqual(["a2"]);
    });

    it("should be no-op for empty agentId", () => {
      expect(reduce(initialState, markAgentAsViewed(""))).toBe(initialState);
    });

    it("should set viewed agent even if not in unread list", () => {
      const state = reduce(initialState, markAgentAsViewed("a1"));
      expect(state.currentlyViewedAgentId).toBe("a1");
    });

    it("should return same ref when already viewing same agent with no unread entry", () => {
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
  });

  describe("newAssistantMessage", () => {
    it("should mark agent as unread when not currently viewed", () => {
      const state = reduce(initialState, newAssistantMessage("a1", "ws-1"));
      expect(state.unreadAgentIds).toEqual(["a1"]);
    });

    it("should keep workspaceId on the transient action payload", () => {
      expect(newAssistantMessage("a1", "ws-1").payload).toEqual({
        agentId: "a1",
        workspaceId: "ws-1",
        isBackground: undefined,
      });
    });

    it("should not mark as unread when agent is currently viewed", () => {
      const before: UnreadTrackingState = { ...initialState, currentlyViewedAgentId: "a1" };
      const state = reduce(before, newAssistantMessage("a1", "ws-1"));
      expect(state.unreadAgentIds).toEqual([]);
    });

    it("should not mark as unread for background agents", () => {
      const state = reduce(initialState, newAssistantMessage("a1", "ws-1", true));
      expect(state).toBe(initialState);
    });

    it("should be no-op for empty agentId", () => {
      expect(reduce(initialState, newAssistantMessage("", "ws-1"))).toBe(initialState);
    });

    it("should not duplicate agent in unread list", () => {
      let state = reduce(initialState, newAssistantMessage("a1", "ws-1"));
      state = reduce(state, newAssistantMessage("a1", "ws-1"));
      expect(state.unreadAgentIds).toEqual(["a1"]);
    });

    it("should evict oldest when exceeding max unread agents", () => {
      let state = initialState;
      for (let i = 0; i < 100; i++) {
        state = reduce(state, newAssistantMessage(`agent-${i}`, "ws-1"));
      }
      expect(state.unreadAgentIds).toHaveLength(100);
      state = reduce(state, newAssistantMessage("agent-new", "ws-1"));
      expect(state.unreadAgentIds).toHaveLength(100);
      expect(state.unreadAgentIds).not.toContain("agent-0");
      expect(state.unreadAgentIds).toContain("agent-new");
    });
  });

  describe("clearAgentUnread", () => {
    it("should remove agent from unread list", () => {
      const before: UnreadTrackingState = {
        unreadAgentIds: ["a1", "a2"],
        currentlyViewedAgentId: null,
      };
      const state = reduce(before, clearAgentUnread("a1"));
      expect(state.unreadAgentIds).toEqual(["a2"]);
    });

    it("should also clear currentlyViewedAgentId if it matches", () => {
      const before: UnreadTrackingState = {
        unreadAgentIds: ["a1"],
        currentlyViewedAgentId: "a1",
      };
      const state = reduce(before, clearAgentUnread("a1"));
      expect(state.currentlyViewedAgentId).toBeNull();
    });

    it("should be no-op for unknown agent", () => {
      expect(reduce(initialState, clearAgentUnread("unknown"))).toBe(initialState);
    });
  });

  describe("clearAgentsUnread", () => {
    it("should clear all derived agent IDs", () => {
      const before: UnreadTrackingState = {
        unreadAgentIds: ["a1", "a2", "a3"],
        currentlyViewedAgentId: null,
      };
      const state = reduce(before, clearAgentsUnread(["a1", "a2"]));
      expect(state.unreadAgentIds).toEqual(["a3"]);
    });

    it("should be no-op when no agents are unread", () => {
      const before: UnreadTrackingState = {
        unreadAgentIds: ["a1"],
        currentlyViewedAgentId: null,
      };
      expect(reduce(before, clearAgentsUnread(["other"]))).toBe(before);
    });
  });

  describe("clearAllUnread", () => {
    it("should reset to initial state", () => {
      const before: UnreadTrackingState = {
        unreadAgentIds: ["a1", "a2"],
        currentlyViewedAgentId: "a1",
      };
      const state = reduce(before, clearAllUnread());
      expect(state).toEqual(initialState);
    });
  });
});

