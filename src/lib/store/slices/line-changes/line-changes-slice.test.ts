import { describe, expect, it } from "vitest";
import {
  initialState,
  updateWorkspaceStats,
  updateAgentStats,
  trackFileChanges,
  clearWorkspaceStats,
  clearAgentStats,
  hydrateAllWorkspaceStats,
  lineChangesReducer,
} from "./line-changes-slice";
import type { LineChangeStats, FileLineChange } from "./line-changes-types";

const reduce = lineChangesReducer;

describe("lineChangesReducer", () => {
  it("should return initial state", () => {
    const state = reduce(undefined, { type: "@@INIT" });
    expect(state).toEqual(initialState);
  });

  describe("updateWorkspaceStats", () => {
    it("should set workspace stats", () => {
      const stats: LineChangeStats = { additions: 10, deletions: 5, timestamp: "2025-01-01T00:00:00Z" };
      const state = reduce(initialState, updateWorkspaceStats("ws-1", stats));
      expect(state.workspaceStats["ws-1"]).toEqual(stats);
    });

    it("should overwrite existing workspace stats", () => {
      const stats1: LineChangeStats = { additions: 10, deletions: 5, timestamp: "2025-01-01T00:00:00Z" };
      const stats2: LineChangeStats = { additions: 20, deletions: 10, timestamp: "2025-01-02T00:00:00Z" };
      let state = reduce(initialState, updateWorkspaceStats("ws-1", stats1));
      state = reduce(state, updateWorkspaceStats("ws-1", stats2));
      expect(state.workspaceStats["ws-1"]).toEqual(stats2);
    });
  });

  describe("updateAgentStats", () => {
    it("should set agent stats", () => {
      const stats: LineChangeStats = { additions: 3, deletions: 1, timestamp: "2025-01-01T00:00:00Z" };
      const state = reduce(initialState, updateAgentStats("agent-1", stats));
      expect(state.agentStats["agent-1"]).toEqual(stats);
    });
  });

  describe("trackFileChanges", () => {
    const changes: FileLineChange[] = [
      { path: "a.ts", additions: 5, deletions: 2, action: "modify" },
      { path: "b.ts", additions: 3, deletions: 0, action: "create" },
    ];

    it("should store file changes and compute workspace stats for non-agent IDs", () => {
      const state = reduce(initialState, trackFileChanges("ws-1", changes));
      expect(state.fileChanges["ws-1"]).toEqual(changes);
      expect(state.workspaceStats["ws-1"]?.additions).toBe(8);
      expect(state.workspaceStats["ws-1"]?.deletions).toBe(2);
    });

    it("should store file changes and compute agent stats for agent- prefixed IDs", () => {
      const state = reduce(initialState, trackFileChanges("agent-abc", changes));
      expect(state.fileChanges["agent-abc"]).toEqual(changes);
      expect(state.agentStats["agent-abc"]?.additions).toBe(8);
      expect(state.agentStats["agent-abc"]?.deletions).toBe(2);
      expect(state.workspaceStats["agent-abc"]).toBeUndefined();
    });

    it("should compute zero stats for empty changes array", () => {
      const state = reduce(initialState, trackFileChanges("ws-1", []));
      expect(state.workspaceStats["ws-1"]?.additions).toBe(0);
      expect(state.workspaceStats["ws-1"]?.deletions).toBe(0);
    });
  });

  describe("clearWorkspaceStats", () => {
    it("should remove workspace stats and file changes", () => {
      let state = reduce(initialState, updateWorkspaceStats("ws-1", { additions: 1, deletions: 0, timestamp: "" }));
      state = reduce(state, trackFileChanges("ws-1", [{ path: "a.ts", additions: 1, deletions: 0, action: "create" }]));
      state = reduce(state, clearWorkspaceStats("ws-1"));
      expect(state.workspaceStats["ws-1"]).toBeUndefined();
      expect(state.fileChanges["ws-1"]).toBeUndefined();
    });

    it("should not affect other workspaces", () => {
      let state = reduce(initialState, updateWorkspaceStats("ws-1", { additions: 1, deletions: 0, timestamp: "" }));
      state = reduce(state, updateWorkspaceStats("ws-2", { additions: 2, deletions: 0, timestamp: "" }));
      state = reduce(state, clearWorkspaceStats("ws-1"));
      expect(state.workspaceStats["ws-2"]).toBeDefined();
    });
  });

  describe("clearAgentStats", () => {
    it("should remove agent stats and file changes", () => {
      let state = reduce(initialState, updateAgentStats("agent-1", { additions: 1, deletions: 0, timestamp: "" }));
      state = reduce(state, trackFileChanges("agent-1", [{ path: "a.ts", additions: 1, deletions: 0, action: "create" }]));
      state = reduce(state, clearAgentStats("agent-1"));
      expect(state.agentStats["agent-1"]).toBeUndefined();
      expect(state.fileChanges["agent-1"]).toBeUndefined();
    });
  });

  describe("hydrate actions", () => {
    it("hydrateAllWorkspaceStats merges bulk stats", () => {
      const existing = reduce(initialState, updateWorkspaceStats("ws-0", { additions: 1, deletions: 0, timestamp: "" }));
      const bulk: Record<string, LineChangeStats> = {
        "ws-1": { additions: 10, deletions: 5, timestamp: "t1" },
        "ws-2": { additions: 20, deletions: 10, timestamp: "t2" },
      };
      const state = reduce(existing, hydrateAllWorkspaceStats(bulk));
      expect(state.workspaceStats["ws-0"]).toBeDefined();
      expect(state.workspaceStats["ws-1"]).toEqual(bulk["ws-1"]);
      expect(state.workspaceStats["ws-2"]).toEqual(bulk["ws-2"]);
    });

  });
});

