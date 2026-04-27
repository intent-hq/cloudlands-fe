import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectSaga } from "redux-saga-test-plan";
import * as matchers from "redux-saga-test-plan/matchers";
import { dynamic } from "redux-saga-test-plan/providers";

vi.mock("$lib/electron-bridge", () => ({
  invoke: vi.fn(),
  invokeWithTimeout: vi.fn(),
  IpcTimeoutError: class IpcTimeoutError extends Error {},
}));

vi.mock("$features/line-changes/line-changes.client", () => ({
  lineChangesClient: {
    getAgentStats: vi.fn(),
  },
}));

vi.mock("$lib/utils/client-logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Import after mocks
import { syncAgentStatsFromMain } from "./changes-saga";
import { updateAgentStatsBatch } from "../changes-slice";
import { selectActiveWorkspaceId } from "../../workspace/workspace-selectors";
import { selectAllWorkspaceAgents } from "../../workspace-agents/workspace-agents-selectors";
import { lineChangesClient } from "$features/line-changes/line-changes.client";
import type { LineChangeStats } from "../changes-types";

const makeStats = (additions: number): LineChangeStats => ({
  additions,
  deletions: 0,
  timestamp: "2026-01-01T00:00:00.000Z",
});

const agent = (id: string) => ({ id }) as any;

describe("syncAgentStatsFromMain", () => {
  beforeEach(() => {
    vi.mocked(lineChangesClient.getAgentStats).mockReset();
  });

  it("dispatches one batched update with all entries when every agent succeeds", async () => {
    const a = makeStats(1);
    const b = makeStats(2);
    const c = makeStats(3);

    vi.mocked(lineChangesClient.getAgentStats).mockImplementation((async (id: string) => {
      if (id === "a") return a;
      if (id === "b") return b;
      if (id === "c") return c;
      return null;
    }) as any);

    await expectSaga(syncAgentStatsFromMain)
      .provide([
        [matchers.select.selector(selectActiveWorkspaceId.select), "ws-1"],
        [matchers.select.selector(selectAllWorkspaceAgents.select), [agent("a"), agent("b"), agent("c")]],
      ])
      .put(updateAgentStatsBatch({ a, b, c }))
      .silentRun(50);
  });

  it("includes other agents' stats when one agent's getAgentStats throws", async () => {
    const a = makeStats(10);
    const c = makeStats(30);

    vi.mocked(lineChangesClient.getAgentStats).mockImplementation((async (id: string) => {
      if (id === "a") return a;
      if (id === "b") throw new Error("boom");
      if (id === "c") return c;
      return null;
    }) as any);

    await expectSaga(syncAgentStatsFromMain)
      .provide([
        [matchers.select.selector(selectActiveWorkspaceId.select), "ws-1"],
        [matchers.select.selector(selectAllWorkspaceAgents.select), [agent("a"), agent("b"), agent("c")]],
      ])
      .put(updateAgentStatsBatch({ a, c }))
      .silentRun(50);
  });

  it("does not dispatch when there are zero agents", async () => {
    const dispatched: any[] = [];

    await expectSaga(syncAgentStatsFromMain)
      .provide([
        [matchers.select.selector(selectActiveWorkspaceId.select), "ws-1"],
        [matchers.select.selector(selectAllWorkspaceAgents.select), []],
        {
          put: dynamic(({ action }: any) => {
            dispatched.push(action);
            return undefined;
          }),
        },
      ])
      .silentRun(50);

    expect(dispatched).toEqual([]);
    expect(lineChangesClient.getAgentStats).not.toHaveBeenCalled();
  });

  it("runs per-agent getAgentStats calls concurrently rather than sequentially", async () => {
    // Track the order/timing: all calls must start before any resolves.
    const startedIds: string[] = [];
    let resolveAll: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      resolveAll = resolve;
    });

    vi.mocked(lineChangesClient.getAgentStats).mockImplementation((async (id: string) => {
      startedIds.push(id);
      await gate;
      return makeStats(1);
    }) as any);

    const run = expectSaga(syncAgentStatsFromMain)
      .provide([
        [matchers.select.selector(selectActiveWorkspaceId.select), "ws-1"],
        [matchers.select.selector(selectAllWorkspaceAgents.select), [agent("a"), agent("b"), agent("c")]],
      ])
      .silentRun(200);

    // Yield to the microtask queue so the saga can dispatch all 3 calls.
    await Promise.resolve();
    await Promise.resolve();

    expect(startedIds).toEqual(["a", "b", "c"]);

    resolveAll!();
    await run;
  });
});

