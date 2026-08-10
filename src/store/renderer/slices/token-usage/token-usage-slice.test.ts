import { describe, expect, it } from "vitest";
import type { TokenUsage } from "../../../../features/token-usage/token-usage-types";
import {
  clearWorkspaceTokenUsage,
  fetchWorkspaceTokenUsage,
  initialState,
  tokenUsageFetchFailed,
  tokenUsageReceived,
  tokenUsageReducer,
} from "./token-usage-slice";

const WS = "ws-1";

// Wire `TokenUsage` shape per PROTOCOL §5.23 (workspace.getTokenUsage result /
// workspace:tokenUsage-changed payload).
const snapshot: TokenUsage = {
  byAgentId: {
    "agent-1": {
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheCreationTokens: 40,
    },
  },
  totals: {
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 30,
    cacheCreationTokens: 40,
  },
  byModel: {
    "model-a": {
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheCreationTokens: 40,
    },
  },
  lastScanAt: "2026-06-17T12:00:00Z",
};

describe("token-usage-slice", () => {
  it("has empty initial state", () => {
    expect(initialState).toEqual({ byWorkspaceId: {} });
  });

  it("fetchWorkspaceTokenUsage does not change state", () => {
    const next = tokenUsageReducer(initialState, fetchWorkspaceTokenUsage(WS));
    expect(next).toBe(initialState);
  });

  it("tokenUsageReceived stores the workspace rollup as non-stale", () => {
    const next = tokenUsageReducer(initialState, tokenUsageReceived(WS, snapshot));
    expect(next.byWorkspaceId[WS]).toEqual({
      byAgentId: snapshot.byAgentId,
      totals: snapshot.totals,
      byModel: snapshot.byModel,
      lastScanAt: "2026-06-17T12:00:00Z",
      isStale: false,
    });
  });

  it("tokenUsageReceived mirrors reported thoughtTokens verbatim", () => {
    const withThoughts: TokenUsage = {
      ...snapshot,
      byAgentId: { "agent-1": { ...snapshot.byAgentId["agent-1"], thoughtTokens: 7 } },
      totals: { ...snapshot.totals, thoughtTokens: 7 },
      byModel: { "model-a": { ...snapshot.byModel["model-a"], thoughtTokens: 7 } },
    };
    const next = tokenUsageReducer(initialState, tokenUsageReceived(WS, withThoughts));
    expect(next.byWorkspaceId[WS].totals.thoughtTokens).toBe(7);
    expect(next.byWorkspaceId[WS].byAgentId["agent-1"].thoughtTokens).toBe(7);
    expect(next.byWorkspaceId[WS].byModel["model-a"].thoughtTokens).toBe(7);
    // An omitted counter stays omitted — no defensive zero-filling.
    const plain = tokenUsageReducer(initialState, tokenUsageReceived(WS, snapshot));
    expect(plain.byWorkspaceId[WS].totals).not.toHaveProperty("thoughtTokens");
  });

  it("tokenUsageFetchFailed marks an existing entry stale and keeps numbers", () => {
    const populated = tokenUsageReducer(initialState, tokenUsageReceived(WS, snapshot));
    const next = tokenUsageReducer(populated, tokenUsageFetchFailed(WS));
    expect(next.byWorkspaceId[WS]).toEqual({
      byAgentId: snapshot.byAgentId,
      totals: snapshot.totals,
      byModel: snapshot.byModel,
      lastScanAt: "2026-06-17T12:00:00Z",
      isStale: true,
    });
  });

  it("tokenUsageFetchFailed is a no-op for unknown or already-stale workspaces", () => {
    expect(tokenUsageReducer(initialState, tokenUsageFetchFailed(WS))).toBe(initialState);

    const populated = tokenUsageReducer(initialState, tokenUsageReceived(WS, snapshot));
    const stale = tokenUsageReducer(populated, tokenUsageFetchFailed(WS));
    expect(tokenUsageReducer(stale, tokenUsageFetchFailed(WS))).toBe(stale);
  });

  it("clearWorkspaceTokenUsage removes the workspace entry", () => {
    const populated = tokenUsageReducer(initialState, tokenUsageReceived(WS, snapshot));
    const next = tokenUsageReducer(populated, clearWorkspaceTokenUsage(WS));
    expect(next.byWorkspaceId[WS]).toBeUndefined();
  });

  it("clearWorkspaceTokenUsage is a no-op for unknown workspaces", () => {
    expect(tokenUsageReducer(initialState, clearWorkspaceTokenUsage(WS))).toBe(initialState);
  });

  it("only touches the targeted workspace entry", () => {
    const other = tokenUsageReducer(initialState, tokenUsageReceived("ws-other", snapshot));
    const next = tokenUsageReducer(other, tokenUsageReceived(WS, snapshot));
    expect(next.byWorkspaceId["ws-other"]).toBe(other.byWorkspaceId["ws-other"]);
  });
});

