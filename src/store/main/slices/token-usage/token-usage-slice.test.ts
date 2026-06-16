import { describe, expect, it } from "vitest";

import type {
  CachedAgentTokens,
  WorkspaceTokenScanResult,
} from "../../../../features/token-usage/token-usage-types";
import {
  agentRemoved,
  emptyWorkspaceTokenUsageState,
  initialState,
  scanCompleted,
  scanFailed,
  scanStarted,
  tokenUsageReducer,
  workspaceCleanedUp,
} from "./token-usage-slice";

const WS = "ws-1";

const makeCached = (
  agentId: string,
  tokens: number,
  model = `model-${agentId}`,
): CachedAgentTokens => ({
  agentId,
  sessionId: `session-${agentId}`,
  lastMessageId: `msg-${agentId}`,
  inputTokens: tokens,
  outputTokens: tokens * 2,
  cacheReadTokens: tokens * 3,
  cacheCreationTokens: tokens * 4,
  byModel: {
    [model]: {
      inputTokens: tokens,
      outputTokens: tokens * 2,
      cacheReadTokens: tokens * 3,
      cacheCreationTokens: tokens * 4,
    },
  },
  computedAt: 1000,
});

const makeResult = (
  perAgent: Record<string, CachedAgentTokens>,
): WorkspaceTokenScanResult => {
  const totals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
  const byModel: WorkspaceTokenScanResult["byModel"] = {};
  for (const entry of Object.values(perAgent)) {
    totals.inputTokens += entry.inputTokens;
    totals.outputTokens += entry.outputTokens;
    totals.cacheReadTokens += entry.cacheReadTokens;
    totals.cacheCreationTokens += entry.cacheCreationTokens;
    for (const [model, t] of Object.entries(entry.byModel)) {
      const acc = (byModel[model] ??= {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      });
      acc.inputTokens += t.inputTokens;
      acc.outputTokens += t.outputTokens;
      acc.cacheReadTokens += t.cacheReadTokens;
      acc.cacheCreationTokens += t.cacheCreationTokens;
    }
  }
  return { perAgent, totals, byModel, scannedCount: 1, cacheHits: 0, skippedAgentIds: [] };
};

describe("tokenUsageReducer", () => {
  it("scanStarted marks the workspace as scanning", () => {
    const state = tokenUsageReducer(initialState, scanStarted(WS));
    expect(state.byWorkspaceId[WS].status).toBe("scanning");
  });

  it("scanStarted is a no-op when already scanning", () => {
    const scanning = tokenUsageReducer(initialState, scanStarted(WS));
    expect(tokenUsageReducer(scanning, scanStarted(WS))).toBe(scanning);
  });

  it("scanCompleted replaces cache + totals + byModel, sets lastScanAt, and resets status", () => {
    const scanning = tokenUsageReducer(initialState, scanStarted(WS));
    const result = makeResult({ "agent-1": makeCached("agent-1", 10) });

    const state = tokenUsageReducer(scanning, scanCompleted(WS, result, 5000));
    const ws = state.byWorkspaceId[WS];

    expect(ws.byAgentId).toEqual(result.perAgent);
    expect(ws.totals).toEqual(result.totals);
    expect(ws.byModel).toEqual(result.byModel);
    expect(ws.lastScanAt).toBe(5000);
    expect(ws.status).toBe("idle");
  });

  it("scanFailed resets status without touching cached data", () => {
    const result = makeResult({ "agent-1": makeCached("agent-1", 10) });
    let state = tokenUsageReducer(initialState, scanCompleted(WS, result, 5000));
    state = tokenUsageReducer(state, scanStarted(WS));

    const failed = tokenUsageReducer(state, scanFailed(WS));
    const ws = failed.byWorkspaceId[WS];

    expect(ws.status).toBe("idle");
    expect(ws.byAgentId).toEqual(result.perAgent);
    expect(ws.totals).toEqual(result.totals);
    expect(ws.lastScanAt).toBe(5000);
  });

  it("scanFailed is a no-op when the workspace is idle", () => {
    expect(tokenUsageReducer(initialState, scanFailed(WS))).toBe(initialState);
  });

  it("agentRemoved drops the agent's entry and recomputes totals and byModel", () => {
    const a1 = makeCached("agent-1", 10);
    const a2 = makeCached("agent-2", 100);
    const result = makeResult({ "agent-1": a1, "agent-2": a2 });
    const state = tokenUsageReducer(initialState, scanCompleted(WS, result, 5000));

    const pruned = tokenUsageReducer(state, agentRemoved(WS, "agent-1"));
    const ws = pruned.byWorkspaceId[WS];

    expect(ws.byAgentId).toEqual({ "agent-2": a2 });
    expect(ws.totals).toEqual({
      inputTokens: a2.inputTokens,
      outputTokens: a2.outputTokens,
      cacheReadTokens: a2.cacheReadTokens,
      cacheCreationTokens: a2.cacheCreationTokens,
    });
    expect(ws.byModel).toEqual(a2.byModel);
  });

  it("agentRemoved merges byModel of remaining agents sharing a model", () => {
    const a1 = makeCached("agent-1", 10, "model-shared");
    const a2 = makeCached("agent-2", 100, "model-shared");
    const a3 = makeCached("agent-3", 1, "model-other");
    const result = makeResult({ "agent-1": a1, "agent-2": a2, "agent-3": a3 });
    const state = tokenUsageReducer(initialState, scanCompleted(WS, result, 5000));

    const pruned = tokenUsageReducer(state, agentRemoved(WS, "agent-3"));
    const ws = pruned.byWorkspaceId[WS];

    expect(ws.byModel).toEqual({
      "model-shared": {
        inputTokens: 110,
        outputTokens: 220,
        cacheReadTokens: 330,
        cacheCreationTokens: 440,
      },
    });
  });

  it("agentRemoved is a no-op for unknown agents", () => {
    const result = makeResult({ "agent-1": makeCached("agent-1", 10) });
    const state = tokenUsageReducer(initialState, scanCompleted(WS, result, 5000));
    expect(tokenUsageReducer(state, agentRemoved(WS, "agent-x"))).toBe(state);
  });

  it("workspaceCleanedUp removes the whole workspace entry", () => {
    const result = makeResult({ "agent-1": makeCached("agent-1", 10) });
    const state = tokenUsageReducer(initialState, scanCompleted(WS, result, 5000));

    const cleaned = tokenUsageReducer(state, workspaceCleanedUp(WS));
    expect(cleaned.byWorkspaceId[WS]).toBeUndefined();
  });

  it("workspaceCleanedUp is a no-op for unknown workspaces", () => {
    expect(tokenUsageReducer(initialState, workspaceCleanedUp("ws-x"))).toBe(
      initialState,
    );
  });

  it("exposes an empty workspace state with zeroed totals", () => {
    expect(emptyWorkspaceTokenUsageState).toEqual({
      byAgentId: {},
      totals: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      byModel: {},
      lastScanAt: null,
      status: "idle",
    });
  });
});

