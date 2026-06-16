import { describe, expect, it } from "vitest";
import type { WorkspaceTokenUsageSnapshot } from "../../../../features/token-usage/token-usage-types";
import {
  clearWorkspaceTokenUsage,
  fetchWorkspaceTokenUsage,
  initialState,
  tokenUsageFetchFailed,
  tokenUsageReceived,
  tokenUsageReducer,
} from "./token-usage-slice";

const WS = "ws-1";

const snapshot: WorkspaceTokenUsageSnapshot = {
  workspaceId: WS,
  byAgentId: {
    "agent-1": {
      agentId: "agent-1",
      sessionId: "sess-1",
      lastMessageId: "msg-9",
      computedAt: 1000,
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheCreationTokens: 40,
      byModel: {
        "model-a": {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: 30,
          cacheCreationTokens: 40,
        },
      },
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
  lastScanAt: 5000,
  status: "idle",
};

describe("token-usage-slice", () => {
  it("has empty initial state", () => {
    expect(initialState).toEqual({ byWorkspaceId: {} });
  });

  it("fetchWorkspaceTokenUsage does not change state", () => {
    const next = tokenUsageReducer(initialState, fetchWorkspaceTokenUsage(WS));
    expect(next).toBe(initialState);
  });

  it("tokenUsageReceived stores the workspace snapshot as non-stale", () => {
    const next = tokenUsageReducer(initialState, tokenUsageReceived(WS, snapshot));
    expect(next.byWorkspaceId[WS]).toEqual({
      byAgentId: snapshot.byAgentId,
      totals: snapshot.totals,
      byModel: snapshot.byModel,
      lastScanAt: 5000,
      isStale: false,
    });
  });

  it("tokenUsageReceived does not store snapshot status or workspaceId", () => {
    const next = tokenUsageReducer(initialState, tokenUsageReceived(WS, snapshot));
    expect(next.byWorkspaceId[WS]).not.toHaveProperty("status");
    expect(next.byWorkspaceId[WS]).not.toHaveProperty("workspaceId");
  });

  it("tokenUsageFetchFailed marks an existing entry stale and keeps numbers", () => {
    const populated = tokenUsageReducer(initialState, tokenUsageReceived(WS, snapshot));
    const next = tokenUsageReducer(populated, tokenUsageFetchFailed(WS));
    expect(next.byWorkspaceId[WS]).toEqual({
      byAgentId: snapshot.byAgentId,
      totals: snapshot.totals,
      byModel: snapshot.byModel,
      lastScanAt: 5000,
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
    const other = tokenUsageReducer(
      initialState,
      tokenUsageReceived("ws-other", { ...snapshot, workspaceId: "ws-other" }),
    );
    const next = tokenUsageReducer(other, tokenUsageReceived(WS, snapshot));
    expect(next.byWorkspaceId["ws-other"]).toBe(other.byWorkspaceId["ws-other"]);
  });
});

