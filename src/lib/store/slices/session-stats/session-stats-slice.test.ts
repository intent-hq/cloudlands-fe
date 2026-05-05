import { describe, expect, it } from "vitest";
import {
  agentStatsFailed,
  agentStatsReceived,
  clearAgentStatsLoading,
  clearSessionStats,
  fetchAgentStats,
  fetchWorkspaceStats,
  initialState,
  sessionStatsReducer,
  workspaceStatsFailed,
  workspaceStatsReceived,
} from "./session-stats-slice";
import { removeAgent } from "../workspace-agents/workspace-agents-slice";
import type {
  AgentSessionStats,
  WorkspaceAggregateStats,
} from "./session-stats-types";

const WS = "ws-1";
const AGENT = "agent-1";

const mockWorkspaceStats = (): WorkspaceAggregateStats => ({
  totalCreditsUsed: 1.23,
  totalMessageCount: 4,
  totalToolCount: 5,
  agentCount: 2,
  hasPendingCredits: false,
  isPartial: false,
  failedCount: 0,
  lastFetchedAt: "2026-04-16T00:00:00.000Z",
});

const mockAgentStats = (): AgentSessionStats => ({
  sessionId: "sess-1",
  messageCount: 3,
  toolCount: 2,
  creditsUsed: 0.5,
  parentCreditsUsed: 0.4,
  subAgentCreditsUsed: 0.1,
  lastFetchedAt: "2026-04-16T00:00:00.000Z",
});

describe("sessionStatsReducer", () => {
  it("returns initial state shape", () => {
    expect(sessionStatsReducer(undefined, { type: "@@INIT" })).toEqual(initialState);
  });

  it("fetchWorkspaceStats sets per-wsId loading and clears its error", () => {
    const prev = { ...initialState, workspaceStatsErrors: { [WS]: "boom" } };
    const next = sessionStatsReducer(prev, fetchWorkspaceStats(WS, ["s1"]));
    expect(next.loadingWorkspaceStats[WS]).toBe(true);
    expect(next.workspaceStatsErrors[WS]).toBeUndefined();
  });

  it("workspaceStatsReceived stores stats and clears per-wsId loading/error", () => {
    const stats = mockWorkspaceStats();
    const prev = {
      ...initialState,
      loadingWorkspaceStats: { [WS]: true },
      workspaceStatsErrors: { [WS]: "x" },
    };
    const next = sessionStatsReducer(prev, workspaceStatsReceived(WS, stats));
    expect(next.workspaceStats[WS]).toEqual(stats);
    expect(next.loadingWorkspaceStats[WS]).toBeUndefined();
    expect(next.workspaceStatsErrors[WS]).toBeUndefined();
  });

  it("workspaceStatsFailed sets per-wsId error and clears its loading", () => {
    const prev = { ...initialState, loadingWorkspaceStats: { [WS]: true } };
    const next = sessionStatsReducer(prev, workspaceStatsFailed(WS, "nope"));
    expect(next.workspaceStatsErrors[WS]).toBe("nope");
    expect(next.loadingWorkspaceStats[WS]).toBeUndefined();
  });

  it("fetchAgentStats marks agent loading and clears its error", () => {
    const prev = { ...initialState, agentStatsErrors: { [AGENT]: "old" } };
    const next = sessionStatsReducer(prev, fetchAgentStats(AGENT, "sess-1"));
    expect(next.loadingAgentStats[AGENT]).toBe(true);
    expect(next.agentStatsErrors[AGENT]).toBeUndefined();
  });

  it("agentStatsReceived stores stats and clears loading", () => {
    const stats = mockAgentStats();
    const prev = { ...initialState, loadingAgentStats: { [AGENT]: true } };
    const next = sessionStatsReducer(prev, agentStatsReceived(AGENT, stats));
    expect(next.agentStats[AGENT]).toEqual(stats);
    expect(next.loadingAgentStats[AGENT]).toBeUndefined();
  });

  it("agentStatsFailed sets error and clears loading", () => {
    const prev = { ...initialState, loadingAgentStats: { [AGENT]: true } };
    const next = sessionStatsReducer(prev, agentStatsFailed(AGENT, "ipc err"));
    expect(next.agentStatsErrors[AGENT]).toBe("ipc err");
    expect(next.loadingAgentStats[AGENT]).toBeUndefined();
  });

  it("clearSessionStats removes only the specified workspace", () => {
    const a = mockWorkspaceStats();
    const b = mockWorkspaceStats();
    const agentStats = { [AGENT]: mockAgentStats() };
    const prev = {
      ...initialState,
      workspaceStats: { [WS]: a, "ws-2": b },
      agentStats,
    };
    const next = sessionStatsReducer(prev, clearSessionStats(WS));
    expect(next.workspaceStats[WS]).toBeUndefined();
    expect(next.workspaceStats["ws-2"]).toEqual(b);
    // Agent stats are not workspace-keyed and must be preserved
    expect(next.agentStats).toEqual(agentStats);
  });

  it("clearSessionStats clears only the specified workspace's loading/error entries", () => {
    const prev = {
      ...initialState,
      loadingWorkspaceStats: { [WS]: true, "ws-2": true },
      workspaceStatsErrors: { [WS]: "some error", "ws-2": "keep me" },
      workspaceStats: { [WS]: mockWorkspaceStats() },
    };
    const next = sessionStatsReducer(prev, clearSessionStats(WS));
    expect(next.workspaceStats[WS]).toBeUndefined();
    expect(next.loadingWorkspaceStats[WS]).toBeUndefined();
    expect(next.workspaceStatsErrors[WS]).toBeUndefined();
    // Other workspaces' loading/error entries must be preserved
    expect(next.loadingWorkspaceStats["ws-2"]).toBe(true);
    expect(next.workspaceStatsErrors["ws-2"]).toBe("keep me");
  });

  it("concurrent workspaces do not stomp each other's loading/error state", () => {
    // Both workspaces start fetching → both loading flags set independently
    let state = sessionStatsReducer(initialState, fetchWorkspaceStats(WS, ["s1"]));
    state = sessionStatsReducer(state, fetchWorkspaceStats("ws-2", ["s2"]));
    expect(state.loadingWorkspaceStats[WS]).toBe(true);
    expect(state.loadingWorkspaceStats["ws-2"]).toBe(true);

    // wsA fails → only wsA's entries change; wsB still in flight
    state = sessionStatsReducer(state, workspaceStatsFailed(WS, "boom"));
    expect(state.workspaceStatsErrors[WS]).toBe("boom");
    expect(state.loadingWorkspaceStats[WS]).toBeUndefined();
    expect(state.loadingWorkspaceStats["ws-2"]).toBe(true);
    expect(state.workspaceStatsErrors["ws-2"]).toBeUndefined();

    // Clearing wsA removes only wsA entries
    state = sessionStatsReducer(state, clearSessionStats(WS));
    expect(state.loadingWorkspaceStats[WS]).toBeUndefined();
    expect(state.workspaceStatsErrors[WS]).toBeUndefined();
    expect(state.loadingWorkspaceStats["ws-2"]).toBe(true);
    expect(state.workspaceStatsErrors["ws-2"]).toBeUndefined();
  });

  it("removeAgent prunes agentStats / loadingAgentStats / agentStatsErrors for that agent", () => {
    const prev = {
      ...initialState,
      agentStats: {
        [AGENT]: mockAgentStats(),
        keep: mockAgentStats(),
      },
      loadingAgentStats: { [AGENT]: true, keep: true },
      agentStatsErrors: { [AGENT]: "err", keep: "still here" },
    };
    const next = sessionStatsReducer(prev, removeAgent(WS, AGENT));
    expect(next.agentStats[AGENT]).toBeUndefined();
    expect(next.agentStats.keep).toBeDefined();
    expect(next.loadingAgentStats[AGENT]).toBeUndefined();
    expect(next.loadingAgentStats.keep).toBe(true);
    expect(next.agentStatsErrors[AGENT]).toBeUndefined();
    expect(next.agentStatsErrors.keep).toBe("still here");
  });

  it("clearAgentStatsLoading clears loading and error but preserves agentStats", () => {
    const stats = mockAgentStats();
    const prev = {
      ...initialState,
      agentStats: { [AGENT]: stats, other: mockAgentStats() },
      loadingAgentStats: { [AGENT]: true, other: true },
      agentStatsErrors: { [AGENT]: "boom", other: "keep" },
    };
    const next = sessionStatsReducer(prev, clearAgentStatsLoading(AGENT));
    // Loading and error cleared for this agent
    expect(next.loadingAgentStats[AGENT]).toBeUndefined();
    expect(next.agentStatsErrors[AGENT]).toBeUndefined();
    // Stats preserved
    expect(next.agentStats[AGENT]).toEqual(stats);
    // Other agents untouched
    expect(next.loadingAgentStats.other).toBe(true);
    expect(next.agentStatsErrors.other).toBe("keep");
    expect(next.agentStats.other).toBeDefined();
  });

  it("removeAgent is a no-op when the agent has no stats", () => {
    const prev = {
      ...initialState,
      agentStats: { other: mockAgentStats() },
    };
    const next = sessionStatsReducer(prev, removeAgent(WS, "unknown"));
    expect(next.agentStats).toEqual(prev.agentStats);
    expect(next.loadingAgentStats).toEqual({});
    expect(next.agentStatsErrors).toEqual({});
  });
});
