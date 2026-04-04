import { describe, expect, it } from "vitest";
import {
  initialState,
  hydrateUnreadTracking,
  markAgentAsViewed,
  clearCurrentlyViewedAgent,
  newAssistantMessage,
  clearAgentUnread,
  clearWorkspaceUnread,
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
        agentWorkspaceMap: { a1: "ws-1", a2: "ws-2" },
      };
      const state = reduce(initialState, hydrateUnreadTracking(data));
      expect(state.unreadAgentIds).toEqual(["a1", "a2"]);
      expect(state.agentWorkspaceMap).toEqual({ a1: "ws-1", a2: "ws-2" });
      expect(state.currentlyViewedAgentId).toBeNull();
    });
  });

  describe("markAgentAsViewed", () => {
    it("should set currentlyViewedAgentId and remove from unread", () => {
      const before: UnreadTrackingState = {
        unreadAgentIds: ["a1", "a2"],
        agentWorkspaceMap: { a1: "ws-1", a2: "ws-2" },
        currentlyViewedAgentId: null,
      };
      const state = reduce(before, markAgentAsViewed("a1"));
      expect(state.currentlyViewedAgentId).toBe("a1");
      expect(state.unreadAgentIds).toEqual(["a2"]);
      expect(state.agentWorkspaceMap).toEqual({ a2: "ws-2" });
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
      expect(state.agentWorkspaceMap).toEqual({ a1: "ws-1" });
    });

    it("should not mark as unread when agent is currently viewed", () => {
      const before: UnreadTrackingState = { ...initialState, currentlyViewedAgentId: "a1" };
      const state = reduce(before, newAssistantMessage("a1", "ws-1"));
      expect(state.unreadAgentIds).toEqual([]);
      expect(state.agentWorkspaceMap).toEqual({ a1: "ws-1" });
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

    it("should update workspace map when agent already unread with different workspace", () => {
      let state = reduce(initialState, newAssistantMessage("a1", "ws-1"));
      state = reduce(state, newAssistantMessage("a1", "ws-2"));
      expect(state.agentWorkspaceMap.a1).toBe("ws-2");
    });

    it("should evict oldest when exceeding max unread agents", () => {
      let state = initialState;
      for (let i = 0; i < 100; i++) {
        state = reduce(state, newAssistantMessage(`agent-${i}`, `ws-${i}`));
      }
      expect(state.unreadAgentIds).toHaveLength(100);
      state = reduce(state, newAssistantMessage("agent-new", "ws-new"));
      expect(state.unreadAgentIds).toHaveLength(100);
      expect(state.unreadAgentIds).not.toContain("agent-0");
      expect(state.unreadAgentIds).toContain("agent-new");
      expect(state.agentWorkspaceMap["agent-0"]).toBeUndefined();
    });

    it("should handle message without workspaceId", () => {
      const state = reduce(initialState, newAssistantMessage("a1"));
      expect(state.unreadAgentIds).toEqual(["a1"]);
      expect(state.agentWorkspaceMap).toEqual({});
    });
  });

  describe("clearAgentUnread", () => {
    it("should remove agent from unread list and workspace map", () => {
      const before: UnreadTrackingState = {
        unreadAgentIds: ["a1", "a2"],
        agentWorkspaceMap: { a1: "ws-1", a2: "ws-2" },
        currentlyViewedAgentId: null,
      };
      const state = reduce(before, clearAgentUnread("a1"));
      expect(state.unreadAgentIds).toEqual(["a2"]);
      expect(state.agentWorkspaceMap).toEqual({ a2: "ws-2" });
    });

    it("should also clear currentlyViewedAgentId if it matches", () => {
      const before: UnreadTrackingState = {
        unreadAgentIds: ["a1"],
        agentWorkspaceMap: { a1: "ws-1" },
        currentlyViewedAgentId: "a1",
      };
      const state = reduce(before, clearAgentUnread("a1"));
      expect(state.currentlyViewedAgentId).toBeNull();
    });

    it("should be no-op for unknown agent", () => {
      expect(reduce(initialState, clearAgentUnread("unknown"))).toBe(initialState);
    });
  });

  describe("clearWorkspaceUnread", () => {
    it("should clear all agents in the given workspace", () => {
      const before: UnreadTrackingState = {
        unreadAgentIds: ["a1", "a2", "a3"],
        agentWorkspaceMap: { a1: "ws-1", a2: "ws-1", a3: "ws-2" },
        currentlyViewedAgentId: null,
      };
      const state = reduce(before, clearWorkspaceUnread("ws-1"));
      expect(state.unreadAgentIds).toEqual(["a3"]);
      expect(state.agentWorkspaceMap).toEqual({ a3: "ws-2" });
    });

    it("should be no-op when no agents belong to workspace", () => {
      const before: UnreadTrackingState = {
        unreadAgentIds: ["a1"],
        agentWorkspaceMap: { a1: "ws-1" },
        currentlyViewedAgentId: null,
      };
      expect(reduce(before, clearWorkspaceUnread("ws-other"))).toBe(before);
    });
  });

  describe("clearAllUnread", () => {
    it("should reset to initial state", () => {
      const before: UnreadTrackingState = {
        unreadAgentIds: ["a1", "a2"],
        agentWorkspaceMap: { a1: "ws-1", a2: "ws-2" },
        currentlyViewedAgentId: "a1",
      };
      const state = reduce(before, clearAllUnread());
      expect(state).toEqual(initialState);
    });
  });
});

