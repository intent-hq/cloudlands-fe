import { describe, it } from "vitest";
import { expectSaga } from "redux-saga-test-plan";
import * as matchers from "redux-saga-test-plan/matchers";
import { throwError } from "redux-saga-test-plan/providers";

import type {
  CachedAgentTokens,
  WorkspaceTokenScanResult,
} from "../../../../../features/token-usage/token-usage-types";
import type { WorkspaceEvent } from "../../../../../features/events/types";
import { WorkspaceId } from "../../../../../shared/types/branded-ids";
import { workspaceEventAccepted } from "../../workspace-events/workspace-events-slice";
import { workspaceDeleting } from "../../workspace-lifecycle-events/workspace-lifecycle-events-slice";
import {
  agentRemoved,
  emptyWorkspaceTokenUsageState,
  refreshRequested,
  scanCompleted,
  scanFailed,
  scanStarted,
  workspaceCleanedUp,
  type WorkspaceTokenUsageState,
} from "../token-usage-slice";
import { selectWorkspaceTokenUsage } from "../token-usage-selectors";
import {
  TOKEN_USAGE_REFRESH_INTERVAL_MS,
  broadcastTokenUsageChanged,
  handleAgentDeletedForTokenUsage,
  handleRefreshRequested,
  handleScanCompleted,
  handleWorkspaceDeletingForTokenUsage,
  runWorkspaceTokenScan,
} from "./token-usage-saga";

const WS = "ws-1";

const makeWs = (
  overrides: Partial<WorkspaceTokenUsageState> = {},
): WorkspaceTokenUsageState => ({
  ...emptyWorkspaceTokenUsageState,
  ...overrides,
});

const cached: Record<string, CachedAgentTokens> = {
  "agent-1": {
    agentId: "agent-1",
    sessionId: "session-1",
    lastMessageId: "msg-1",
    inputTokens: 1,
    outputTokens: 2,
    cacheReadTokens: 3,
    cacheCreationTokens: 4,
    byModel: {
      "model-a": {
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheCreationTokens: 4,
      },
    },
    computedAt: 1000,
  },
};

const scanResult: WorkspaceTokenScanResult = {
  perAgent: cached,
  totals: {
    inputTokens: 1,
    outputTokens: 2,
    cacheReadTokens: 3,
    cacheCreationTokens: 4,
  },
  byModel: {
    "model-a": {
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheCreationTokens: 4,
    },
  },
  scannedCount: 1,
  cacheHits: 0,
  skippedAgentIds: [],
};

const provideWs = (ws: WorkspaceTokenUsageState) =>
  [matchers.select(selectWorkspaceTokenUsage.select, WS), ws] as const;

describe("handleRefreshRequested", () => {
  it("skips when a scan is already in flight for the workspace", () => {
    return expectSaga(handleRefreshRequested, refreshRequested(WS))
      .provide([provideWs(makeWs({ status: "scanning" }))])
      .not.put.actionType(scanStarted.type)
      .run();
  });

  it("skips when the last scan is fresher than the refresh interval", () => {
    const ws = makeWs({ lastScanAt: Date.now() - 1000 });
    return expectSaga(handleRefreshRequested, refreshRequested(WS))
      .provide([provideWs(ws)])
      .not.put.actionType(scanStarted.type)
      .not.call.fn(runWorkspaceTokenScan)
      .run();
  });

  it("scans with the cached byAgentId map when never scanned before", () => {
    const ws = makeWs({ byAgentId: cached });
    return expectSaga(handleRefreshRequested, refreshRequested(WS))
      .provide([
        provideWs(ws),
        [matchers.call.fn(runWorkspaceTokenScan), scanResult],
      ])
      .put(scanStarted(WS))
      .call(runWorkspaceTokenScan, WS, cached)
      .put.actionType(scanCompleted.type)
      .run();
  });

  it("scans when the last scan is older than the refresh interval", () => {
    const ws = makeWs({
      lastScanAt: Date.now() - TOKEN_USAGE_REFRESH_INTERVAL_MS - 1,
    });
    return expectSaga(handleRefreshRequested, refreshRequested(WS))
      .provide([
        provideWs(ws),
        [matchers.call.fn(runWorkspaceTokenScan), scanResult],
      ])
      .put(scanStarted(WS))
      .put.actionType(scanCompleted.type)
      .run();
  });

  it("dispatches scanFailed when the scan throws", () => {
    return expectSaga(handleRefreshRequested, refreshRequested(WS))
      .provide([
        provideWs(makeWs()),
        [matchers.call.fn(runWorkspaceTokenScan), throwError(new Error("boom"))],
      ])
      .put(scanStarted(WS))
      .put(scanFailed(WS))
      .not.put.actionType(scanCompleted.type)
      .run();
  });
});

describe("handleScanCompleted", () => {
  it("broadcasts the updated snapshot to renderer windows", () => {
    const ws = makeWs({
      byAgentId: cached,
      totals: scanResult.totals,
      byModel: scanResult.byModel,
      lastScanAt: 5000,
    });
    return expectSaga(handleScanCompleted, scanCompleted(WS, scanResult, 5000))
      .provide([
        provideWs(ws),
        [matchers.call.fn(broadcastTokenUsageChanged), undefined],
      ])
      .call(broadcastTokenUsageChanged, {
        workspaceId: WS,
        byAgentId: ws.byAgentId,
        totals: ws.totals,
        byModel: ws.byModel,
        lastScanAt: 5000,
        status: "idle",
      })
      .run();
  });
});

describe("cache pruning", () => {
  const agentDeletedEvent = {
    id: "evt-1",
    type: "agent:deleted",
    timestamp: new Date().toISOString(),
    workspaceId: WS,
    data: { agentId: "agent-1" },
  } as unknown as WorkspaceEvent;

  it("prunes the agent cache entry on agent:deleted events", () => {
    return expectSaga(
      handleAgentDeletedForTokenUsage,
      workspaceEventAccepted(agentDeletedEvent),
    )
      .put(agentRemoved(WS, "agent-1"))
      .run();
  });

  it("ignores non agent:deleted workspace events", () => {
    const otherEvent = {
      ...agentDeletedEvent,
      type: "agent:created",
    } as unknown as WorkspaceEvent;
    return expectSaga(
      handleAgentDeletedForTokenUsage,
      workspaceEventAccepted(otherEvent),
    )
      .not.put.actionType(agentRemoved.type)
      .run();
  });

  it("drops the workspace entry on workspaceDeleting", () => {
    return expectSaga(
      handleWorkspaceDeletingForTokenUsage,
      workspaceDeleting({ workspaceId: WorkspaceId(WS) }),
    )
      .put(workspaceCleanedUp(WS))
      .run();
  });
});

