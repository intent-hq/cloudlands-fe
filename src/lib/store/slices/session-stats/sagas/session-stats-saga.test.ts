import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as sagaEffects from "redux-saga/effects";
import { runSaga, stdChannel } from "redux-saga";
import { expectSaga } from "redux-saga-test-plan";

// Must mock typed-redux-saga BEFORE importing saga modules
vi.mock("typed-redux-saga", () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  take: function* (pattern: any) {
    return yield sagaEffects.take(pattern);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  cancel: function* (task: any) {
    return yield sagaEffects.cancel(task);
  },
  delay: function* (ms: any) {
    return yield sagaEffects.delay(ms);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
}));

// Hoisted selector mocks
const { mockSelectAllWorkspaceAgents, mockSelectAgentsLoaded, mockSelectActiveWorkspaceId } =
  vi.hoisted(() => ({
    mockSelectAllWorkspaceAgents: vi.fn(() => [] as any[]),
    mockSelectAgentsLoaded: vi.fn(() => true),
    mockSelectActiveWorkspaceId: vi.fn(() => null as string | null),
  }));

const { hoistedSagaEffects } = vi.hoisted(() => {
  const effects = require("redux-saga/effects") as typeof sagaEffects;
  return { hoistedSagaEffects: effects };
});

vi.mock("../../workspace-agents/workspace-agents-selectors", () => ({
  selectAllWorkspaceAgents: {
    select: (...args: any[]) => mockSelectAllWorkspaceAgents(...args),
    effect: function* (...args: any[]) {
      return yield hoistedSagaEffects.select(mockSelectAllWorkspaceAgents, ...args);
    },
  },
  selectAgentsLoaded: {
    select: (...args: any[]) => mockSelectAgentsLoaded(...args),
    effect: function* (...args: any[]) {
      return yield hoistedSagaEffects.select(mockSelectAgentsLoaded, ...args);
    },
  },
}));

vi.mock("../../workspace/workspace-selectors", () => ({
  selectActiveWorkspaceId: {
    select: (...args: any[]) => mockSelectActiveWorkspaceId(...args),
    effect: function* (...args: any[]) {
      return yield hoistedSagaEffects.select(mockSelectActiveWorkspaceId, ...args);
    },
  },
}));

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock("$lib/electron-bridge", () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
  isElectron: () => true,
}));

// Import after mocks
import {
  fetchWorkspaceStats,
  workspaceStatsReceived,
  workspaceStatsFailed,
  fetchAgentStats,
  agentStatsReceived,
  agentStatsFailed,
  clearSessionStats,
  clearAgentStatsLoading,
} from "../session-stats-slice";
import {
  workspaceMounted,
  workspaceUnmounted,
} from "../../workspace-lifecycle/workspace-lifecycle-slice";
import { removeAgent } from "../../workspace-agents/workspace-agents-slice";
import { eventReceived } from "../../workspace-events/workspace-events-slice";
import { sessionStatsSaga } from "./session-stats-saga";

const WS = "ws-1";
const SESSION_ID = "sess-1";
const AGENT_ID = "agent-1";
const FIXED_ISO = "2026-04-16T00:00:00.000Z";

const rawIpcSuccess = {
  sessions: [
    {
      sessionId: SESSION_ID,
      messageCount: 3,
      toolCount: 2,
      creditsUsed: 0.5,
      parentCreditsUsed: 0.4,
      subAgentCreditsUsed: 0.1,
    },
  ],
  totalCreditsUsed: 0.5,
  totalMessageCount: 3,
  totalToolCount: 2,
  hasPendingCredits: false,
  isPartial: false,
  failedCount: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectAllWorkspaceAgents.mockReturnValue([]);
  mockSelectAgentsLoaded.mockReturnValue(true);
  mockSelectActiveWorkspaceId.mockReturnValue(null);
  vi.spyOn(Date.prototype, "toISOString").mockReturnValue(FIXED_ISO);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("session-stats-saga — handlers", () => {
  it("handleFetchWorkspaceStats: success → workspaceStatsReceived", async () => {
    mockInvoke.mockResolvedValue({ success: true, data: rawIpcSuccess });
    await expectSaga(sessionStatsSaga)
      .dispatch(fetchWorkspaceStats(WS, [SESSION_ID]))
      .put(
        workspaceStatsReceived(WS, {
          totalCreditsUsed: 0.5,
          totalMessageCount: 3,
          totalToolCount: 2,
          agentCount: 1,
          hasPendingCredits: false,
          isPartial: false,
          failedCount: 0,
          lastFetchedAt: FIXED_ISO,
        }),
      )
      .silentRun(50);
  });

  it("handleFetchWorkspaceStats: IPC failure → workspaceStatsFailed", async () => {
    mockInvoke.mockResolvedValue({ success: false, error: "ipc exploded" });
    await expectSaga(sessionStatsSaga)
      .dispatch(fetchWorkspaceStats(WS, [SESSION_ID]))
      .put(workspaceStatsFailed(WS, "ipc exploded"))
      .silentRun(50);
  });

  it("handleFetchAgentStats: success → agentStatsReceived", async () => {
    mockInvoke.mockResolvedValue({ success: true, data: rawIpcSuccess });
    await expectSaga(sessionStatsSaga)
      .dispatch(fetchAgentStats(AGENT_ID, SESSION_ID))
      .put(
        agentStatsReceived(AGENT_ID, {
          sessionId: SESSION_ID,
          messageCount: 3,
          toolCount: 2,
          creditsUsed: 0.5,
          parentCreditsUsed: 0.4,
          subAgentCreditsUsed: 0.1,
          lastFetchedAt: FIXED_ISO,
        }),
      )
      .silentRun(50);
  });

  it("handleFetchAgentStats: IPC failure → agentStatsFailed", async () => {
    mockInvoke.mockResolvedValue({ success: false, error: "no sess" });
    await expectSaga(sessionStatsSaga)
      .dispatch(fetchAgentStats(AGENT_ID, SESSION_ID))
      .put(agentStatsFailed(AGENT_ID, "no sess"))
      .silentRun(50);
  });

  it("handleFetchAgentStats: missing session in response → agentStatsFailed", async () => {
    mockInvoke.mockResolvedValue({
      success: true,
      data: { ...rawIpcSuccess, sessions: [] },
    });
    await expectSaga(sessionStatsSaga)
      .dispatch(fetchAgentStats(AGENT_ID, SESSION_ID))
      .put(agentStatsFailed(AGENT_ID, "No stats returned for session"))
      .silentRun(50);
  });

  it("handleFetchWorkspaceStats: structured Zod error object → stringified error in workspaceStatsFailed", async () => {
    const zodErr = {
      code: "VALIDATION_ERROR",
      message: "Invalid request parameters",
      details: [{ path: ["sessionIds"], message: "bad" }],
    };
    mockInvoke.mockResolvedValue({ success: false, error: zodErr });
    await expectSaga(sessionStatsSaga)
      .dispatch(fetchWorkspaceStats(WS, [SESSION_ID]))
      .put(workspaceStatsFailed(WS, JSON.stringify(zodErr)))
      .silentRun(50);
  });
});

// ---------------------------------------------------------------------------
// Polling lifecycle — runSaga-based to observe task cancellation and dedup
// ---------------------------------------------------------------------------

type DispatchedAction = { type: string; payload?: any };

function startSaga(opts: { activeWorkspaceId?: string | null } = {}) {
  const dispatched: DispatchedAction[] = [];
  const channel = stdChannel();
  mockSelectActiveWorkspaceId.mockReturnValue(opts.activeWorkspaceId ?? null);
  const task = runSaga(
    {
      channel,
      dispatch: (action: DispatchedAction) => {
        dispatched.push(action);
        channel.put(action as any);
      },
      getState: () => ({}),
    },
    sessionStatsSaga,
  );
  return { task, dispatched, channel };
}


describe("session-stats-saga — polling lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockInvoke.mockResolvedValue({ success: true, data: rawIpcSuccess });
    mockSelectAllWorkspaceAgents.mockReturnValue([
      { id: AGENT_ID, acpSessionId: SESSION_ID, provider: "auggie" } as any,
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const flush = async () => {
    // Let microtasks settle so forked sagas reach their next blocking effect
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  it("skips IPC when no agents have acpSessionId (no fallback to agent IDs)", async () => {
    mockSelectAllWorkspaceAgents.mockReturnValue([
      { id: AGENT_ID, acpSessionId: null, provider: "auggie" } as any,
    ]);
    const { task, dispatched, channel } = startSaga();
    await flush();
    channel.put(workspaceMounted(WS) as any);
    await flush();
    const fetched = dispatched.filter((a) => a.type === fetchWorkspaceStats.type);
    expect(fetched).toHaveLength(0);
    task.cancel();
  });

  it("dispatches fetchWorkspaceStats on workspaceMounted when a session ID exists", async () => {
    const { task, dispatched, channel } = startSaga();
    await flush();
    channel.put(workspaceMounted(WS) as any);
    await flush();
    const fetched = dispatched.filter((a) => a.type === fetchWorkspaceStats.type);
    expect(fetched).toHaveLength(1);
    expect(fetched[0].payload).toEqual([WS, [SESSION_ID]]);
    task.cancel();
  });

  it("includes acp-only, backend-only, and acp+backend agents (deduped) in workspace aggregate", async () => {
    // Mirror AgentCard.svelte's per-agent fallback so persisted agents with only
    // a backendSessionId still count in the workspace totals. The agent that has
    // both should contribute its acpSessionId (ACP wins). Different agents that
    // happen to share a session ID should be deduped to one entry.
    mockSelectAllWorkspaceAgents.mockReturnValue([
      { id: "agent-acp-only", acpSessionId: "sess-acp", backendSessionId: null, provider: "auggie" } as any,
      { id: "agent-backend-only", acpSessionId: null, backendSessionId: "sess-backend", provider: "auggie" } as any,
      { id: "agent-both", acpSessionId: "sess-both-acp", backendSessionId: "sess-both-backend", provider: "auggie" } as any,
      // Duplicate of agent-acp-only's session — must be deduped out.
      { id: "agent-dup", acpSessionId: "sess-acp", backendSessionId: null, provider: "auggie" } as any,
    ]);
    const { task, dispatched, channel } = startSaga();
    await flush();
    channel.put(workspaceMounted(WS) as any);
    await flush();
    const fetched = dispatched.filter((a) => a.type === fetchWorkspaceStats.type);
    expect(fetched).toHaveLength(1);
    expect(fetched[0].payload).toEqual([
      WS,
      ["sess-acp", "sess-backend", "sess-both-acp"],
    ]);
    task.cancel();
  });

  it("clears stale stats when agents are removed between polls (empty sessionIds)", async () => {
    const { task, dispatched, channel } = startSaga();
    await flush();

    // Mount with a populated agent → first fetch dispatched.
    channel.put(workspaceMounted(WS) as any);
    await flush();
    expect(
      dispatched.filter((a) => a.type === fetchWorkspaceStats.type),
    ).toHaveLength(1);
    const clearsBefore = dispatched.filter(
      (a) => a.type === clearSessionStats.type,
    ).length;

    // All agents removed before the next poll tick; still the active workspace.
    mockSelectAllWorkspaceAgents.mockReturnValue([]);
    mockSelectActiveWorkspaceId.mockReturnValue(WS);

    await vi.advanceTimersByTimeAsync(60_000);
    await flush();

    // Poll tick must dispatch clearSessionStats, NOT another fetchWorkspaceStats.
    expect(
      dispatched.filter((a) => a.type === fetchWorkspaceStats.type),
    ).toHaveLength(1);
    const clearsAfter = dispatched.filter(
      (a) => a.type === clearSessionStats.type,
    );
    expect(clearsAfter.length).toBe(clearsBefore + 1);
    expect(clearsAfter[clearsAfter.length - 1].payload).toEqual([WS]);

    task.cancel();
  });

  it("cancels poll loop on workspaceUnmounted and puts clearSessionStats", async () => {
    const { task, dispatched, channel } = startSaga();
    await flush();
    channel.put(workspaceMounted(WS) as any);
    await flush();
    expect(
      dispatched.filter((a) => a.type === fetchWorkspaceStats.type),
    ).toHaveLength(1);

    channel.put(workspaceUnmounted(WS) as any);
    await flush();
    expect(
      dispatched.some((a) => a.type === clearSessionStats.type),
    ).toBe(true);

    // Advance past two poll intervals — cancelled task must not fire again.
    await vi.advanceTimersByTimeAsync(180_000);
    await flush();
    expect(
      dispatched.filter((a) => a.type === fetchWorkspaceStats.type),
    ).toHaveLength(1);
    task.cancel();
  });

  it("dedupes retroactive mount against real workspaceMounted (no double poll)", async () => {
    const { task, dispatched, channel } = startSaga({ activeWorkspaceId: WS });
    await flush();
    // Retroactive fork should have started polling already
    const afterRetroactive = dispatched.filter(
      (a) => a.type === fetchWorkspaceStats.type,
    ).length;
    expect(afterRetroactive).toBe(1);

    channel.put(workspaceMounted(WS) as any);
    await flush();
    // No new fetch — dedup kept the existing poller
    expect(
      dispatched.filter((a) => a.type === fetchWorkspaceStats.type),
    ).toHaveLength(1);
    task.cancel();
  });

  it("cleans up pollingTasks on wsId-change early return and on unmount so re-mount polls again", async () => {
    const { task, dispatched, channel } = startSaga();
    await flush();

    // Mount → first fetch
    channel.put(workspaceMounted(WS) as any);
    await flush();
    expect(
      dispatched.filter((a) => a.type === fetchWorkspaceStats.type),
    ).toHaveLength(1);

    // Active workspace switches under the poller; at the next tick the loop
    // sees currentWsId !== wsId and returns early. The wrapper's finally must
    // clear pollingTasks[wsId] so a later mount is not deduped.
    mockSelectActiveWorkspaceId.mockReturnValue("ws-other");
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(
      dispatched.filter((a) => a.type === fetchWorkspaceStats.type),
    ).toHaveLength(1);

    // Re-mount original wsId → fetch dispatched again (polling restarted).
    channel.put(workspaceMounted(WS) as any);
    await flush();
    expect(
      dispatched.filter((a) => a.type === fetchWorkspaceStats.type),
    ).toHaveLength(2);

    // Unmount cancels the poll; re-mount afterwards must also start fresh
    // (proves the pollingTasks entry was cleared on cancel too).
    channel.put(workspaceUnmounted(WS) as any);
    await flush();
    channel.put(workspaceMounted(WS) as any);
    await flush();
    expect(
      dispatched.filter((a) => a.type === fetchWorkspaceStats.type),
    ).toHaveLength(3);

    task.cancel();
  });
});


// ---------------------------------------------------------------------------
// Fix B — cancel in-flight fetches
// ---------------------------------------------------------------------------

describe("session-stats-saga — cancel in-flight fetches", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSelectAllWorkspaceAgents.mockReturnValue([
      { id: AGENT_ID, acpSessionId: SESSION_ID, provider: "auggie" } as any,
    ]);
    mockSelectAgentsLoaded.mockReturnValue(true);
    mockSelectActiveWorkspaceId.mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  it("clearSessionStats cancels in-flight workspace fetch — no workspaceStatsReceived emitted", async () => {
    // IPC resolves after a delay so the fetch is in-flight when clear arrives
    mockInvoke.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ success: true, data: rawIpcSuccess }), 5000)),
    );
    const { task, dispatched, channel } = startSaga();
    await flush();

    // Dispatch fetchWorkspaceStats directly (not via mount, to isolate the test)
    channel.put(fetchWorkspaceStats(WS, [SESSION_ID]) as any);
    await flush();

    // Clear before the IPC resolves
    channel.put(clearSessionStats(WS) as any);
    await flush();

    // Advance past the IPC delay so it would have resolved
    await vi.advanceTimersByTimeAsync(10_000);
    await flush();

    // workspaceStatsReceived must NOT have been put for this wsId
    const received = dispatched.filter((a) => a.type === workspaceStatsReceived.type);
    expect(received).toHaveLength(0);

    task.cancel();
  });

  it("rapid fetchAgentStats for same agentId cancels the first — only later result is put", async () => {
    let callCount = 0;
    mockInvoke.mockImplementation(() => {
      callCount++;
      const thisCall = callCount;
      // First call resolves slowly, second call resolves fast
      const delayMs = thisCall === 1 ? 5000 : 100;
      const data = {
        ...rawIpcSuccess,
        sessions: [
          {
            ...rawIpcSuccess.sessions[0],
            messageCount: thisCall === 1 ? 10 : 20,
          },
        ],
      };
      return new Promise((resolve) =>
        setTimeout(() => resolve({ success: true, data }), delayMs),
      );
    });

    const { task, dispatched, channel } = startSaga();
    await flush();

    // Dispatch two rapid fetchAgentStats for the same agent
    channel.put(fetchAgentStats(AGENT_ID, SESSION_ID) as any);
    await flush();
    channel.put(fetchAgentStats(AGENT_ID, SESSION_ID) as any);
    await flush();

    // Advance past both delays
    await vi.advanceTimersByTimeAsync(10_000);
    await flush();

    // Only the second (later) result should have been put
    const received = dispatched.filter((a) => a.type === agentStatsReceived.type);
    expect(received).toHaveLength(1);
    expect(received[0].payload[1].messageCount).toBe(20);

    task.cancel();
  });

  it("clearSessionStats dispatches clearAgentStatsLoading for agents with in-flight fetches", async () => {
    // IPC resolves after a delay so the fetch is in-flight when clear arrives
    mockInvoke.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ success: true, data: rawIpcSuccess }), 5000)),
    );
    mockSelectAllWorkspaceAgents.mockReturnValue([
      { id: AGENT_ID, acpSessionId: SESSION_ID, provider: "auggie" } as any,
    ]);
    const { task, dispatched, channel } = startSaga();
    await flush();

    // Start an in-flight agent fetch
    channel.put(fetchAgentStats(AGENT_ID, SESSION_ID) as any);
    await flush();

    // Clear workspace stats — should cancel agent fetch and dispatch clearAgentStatsLoading
    channel.put(clearSessionStats(WS) as any);
    await flush();

    const clearLoading = dispatched.filter((a) => a.type === clearAgentStatsLoading.type);
    expect(clearLoading).toHaveLength(1);
    expect(clearLoading[0].payload).toEqual([AGENT_ID]);

    task.cancel();
  });

  it("rapid fetchAgentStats: old task's finally does not delete new task's map entry", async () => {
    // Both calls use the same delay so the race is about cancellation ordering,
    // not speed.  The fix ensures the old task's `finally` only deletes its own
    // entry — not the newer task's entry.
    let callCount = 0;
    mockInvoke.mockImplementation(() => {
      callCount++;
      const thisCall = callCount;
      const data = {
        ...rawIpcSuccess,
        sessions: [
          { ...rawIpcSuccess.sessions[0], messageCount: thisCall * 10 },
        ],
      };
      return new Promise((resolve) =>
        setTimeout(() => resolve({ success: true, data }), 200),
      );
    });

    const { task, dispatched, channel } = startSaga();
    await flush();

    // First dispatch — starts task A
    channel.put(fetchAgentStats(AGENT_ID, SESSION_ID) as any);
    await flush();

    // Second dispatch — cancels task A, starts task B
    channel.put(fetchAgentStats(AGENT_ID, SESSION_ID) as any);
    await flush();

    // Let cancelled task A's finally run
    await vi.advanceTimersByTimeAsync(50);
    await flush();

    // Now a *third* dispatch should still be able to cancel task B correctly.
    // If A's finally wrongly deleted B's entry, B would never be cancelled
    // and a stale result would leak.
    channel.put(fetchAgentStats(AGENT_ID, SESSION_ID) as any);
    await flush();

    // Advance past all delays
    await vi.advanceTimersByTimeAsync(500);
    await flush();

    // Only the third (latest) result should land
    const received = dispatched.filter((a) => a.type === agentStatsReceived.type);
    expect(received).toHaveLength(1);
    expect(received[0].payload[1].messageCount).toBe(30);

    task.cancel();
  });

  it("rapid fetchWorkspaceStats: old task's finally does not delete new task's map entry", async () => {
    let callCount = 0;
    mockInvoke.mockImplementation(() => {
      callCount++;
      const thisCall = callCount;
      const data = {
        ...rawIpcSuccess,
        totalMessageCount: thisCall * 10,
      };
      return new Promise((resolve) =>
        setTimeout(() => resolve({ success: true, data }), 200),
      );
    });

    const { task, dispatched, channel } = startSaga();
    await flush();

    // First dispatch — starts task A
    channel.put(fetchWorkspaceStats(WS, [SESSION_ID]) as any);
    await flush();

    // Second dispatch — cancels task A, starts task B
    channel.put(fetchWorkspaceStats(WS, [SESSION_ID]) as any);
    await flush();

    // Let cancelled task A's finally run
    await vi.advanceTimersByTimeAsync(50);
    await flush();

    // Third dispatch — should still cancel task B correctly
    channel.put(fetchWorkspaceStats(WS, [SESSION_ID]) as any);
    await flush();

    // Advance past all delays
    await vi.advanceTimersByTimeAsync(500);
    await flush();

    // Only the third (latest) result should land
    const received = dispatched.filter((a) => a.type === workspaceStatsReceived.type);
    expect(received).toHaveLength(1);
    expect(received[0].payload[1].totalMessageCount).toBe(30);

    task.cancel();
  });

  it("removeAgent cancels in-flight fetchAgentStats — no agentStatsReceived or agentStatsFailed emitted", async () => {
    // IPC resolves after a delay so the fetch is in-flight when removeAgent arrives
    mockInvoke.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ success: true, data: rawIpcSuccess }), 5000)),
    );
    const { task, dispatched, channel } = startSaga();
    await flush();

    // Dispatch fetchAgentStats to start an in-flight fetch
    channel.put(fetchAgentStats(AGENT_ID, SESSION_ID) as any);
    await flush();

    // Remove the agent while the fetch is in-flight
    channel.put(removeAgent(WS, AGENT_ID) as any);
    await flush();

    // Advance past the IPC delay so it would have resolved
    await vi.advanceTimersByTimeAsync(10_000);
    await flush();

    // Neither agentStatsReceived nor agentStatsFailed should have been put
    const received = dispatched.filter((a) => a.type === agentStatsReceived.type);
    const failed = dispatched.filter((a) => a.type === agentStatsFailed.type);
    expect(received).toHaveLength(0);
    expect(failed).toHaveLength(0);

    task.cancel();
  });
});


// ---------------------------------------------------------------------------
// Wave 22 — Agent-activity-driven refetch (agent:idle → debounced fetch)
// ---------------------------------------------------------------------------

describe("session-stats-saga — agent:idle refetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSelectAllWorkspaceAgents.mockReturnValue([
      { id: AGENT_ID, acpSessionId: SESSION_ID, provider: "auggie" } as any,
    ]);
    mockSelectAgentsLoaded.mockReturnValue(true);
    mockInvoke.mockResolvedValue({ success: true, data: rawIpcSuccess });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  const idleEvent = (wsId: string, evtId = "evt-idle-1") => ({
    id: evtId,
    type: "agent:idle" as const,
    workspaceId: wsId,
    timestamp: FIXED_ISO,
    actor: { type: "agent" as const, id: AGENT_ID, name: "Agent" },
    data: { agentId: AGENT_ID, agentName: "Agent" },
  });

  it("dispatches fetchWorkspaceStats 1500ms after agent:idle", async () => {
    const { task, dispatched, channel } = startSaga();
    await flush();

    // Mount baseline so we can isolate the refetch caused by agent:idle.
    channel.put(workspaceMounted(WS) as any);
    await flush();
    const baseline = dispatched.filter((a) => a.type === fetchWorkspaceStats.type).length;

    channel.put(eventReceived(WS, idleEvent(WS) as any) as any);
    await flush();

    // Before the debounce expires, no new fetch should fire.
    await vi.advanceTimersByTimeAsync(1499);
    await flush();
    expect(
      dispatched.filter((a) => a.type === fetchWorkspaceStats.type),
    ).toHaveLength(baseline);

    // Crossing the 1500ms threshold triggers the refetch exactly once.
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    const fetched = dispatched.filter((a) => a.type === fetchWorkspaceStats.type);
    expect(fetched).toHaveLength(baseline + 1);
    expect(fetched[fetched.length - 1].payload).toEqual([WS, [SESSION_ID]]);

    task.cancel();
  });

  it("debounces a burst of agent:idle events into a single fetch per workspace", async () => {
    const { task, dispatched, channel } = startSaga();
    await flush();
    channel.put(workspaceMounted(WS) as any);
    await flush();
    const baseline = dispatched.filter((a) => a.type === fetchWorkspaceStats.type).length;

    // Simulate parent + sub-agents finishing back-to-back.
    channel.put(eventReceived(WS, idleEvent(WS, "evt-1") as any) as any);
    await flush();
    await vi.advanceTimersByTimeAsync(500);
    channel.put(eventReceived(WS, idleEvent(WS, "evt-2") as any) as any);
    await flush();
    await vi.advanceTimersByTimeAsync(500);
    channel.put(eventReceived(WS, idleEvent(WS, "evt-3") as any) as any);
    await flush();

    // 1500ms after the LAST idle event — exactly one refetch should have fired.
    await vi.advanceTimersByTimeAsync(1500);
    await flush();
    const fetched = dispatched.filter((a) => a.type === fetchWorkspaceStats.type);
    expect(fetched).toHaveLength(baseline + 1);

    task.cancel();
  });

  it("ignores non-idle events (no fetch triggered by other event types)", async () => {
    const { task, dispatched, channel } = startSaga();
    await flush();
    channel.put(workspaceMounted(WS) as any);
    await flush();
    const baseline = dispatched.filter((a) => a.type === fetchWorkspaceStats.type).length;

    const otherEvent = {
      ...idleEvent(WS, "evt-other"),
      type: "agent:message" as any,
    };
    channel.put(eventReceived(WS, otherEvent as any) as any);
    await flush();
    await vi.advanceTimersByTimeAsync(2000);
    await flush();

    expect(
      dispatched.filter((a) => a.type === fetchWorkspaceStats.type),
    ).toHaveLength(baseline);

    task.cancel();
  });

  it("clears stats (no fetch) when agent:idle arrives but no agents have a session ID", async () => {
    mockSelectAllWorkspaceAgents.mockReturnValue([
      { id: AGENT_ID, acpSessionId: null, provider: "auggie" } as any,
    ]);
    const { task, dispatched, channel } = startSaga();
    await flush();
    // No mount → keep baseline at zero by resetting after construction.
    const baseline = dispatched.filter((a) => a.type === fetchWorkspaceStats.type).length;
    const clearsBefore = dispatched.filter((a) => a.type === clearSessionStats.type).length;

    channel.put(eventReceived(WS, idleEvent(WS) as any) as any);
    await flush();
    await vi.advanceTimersByTimeAsync(1500);
    await flush();

    expect(
      dispatched.filter((a) => a.type === fetchWorkspaceStats.type),
    ).toHaveLength(baseline);
    expect(
      dispatched.filter((a) => a.type === clearSessionStats.type).length,
    ).toBe(clearsBefore + 1);

    task.cancel();
  });
});


// ---------------------------------------------------------------------------
// Auggie-only gating — only Auggie sessions reach `auggie session stats`
// ---------------------------------------------------------------------------

describe("session-stats-saga — gates to Auggie sessions only", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockInvoke.mockResolvedValue({ success: true, data: rawIpcSuccess });
    mockSelectAgentsLoaded.mockReturnValue(true);
    mockSelectActiveWorkspaceId.mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  it("excludes non-Auggie agents from the workspace aggregate (clears stats when only non-Auggie agents exist)", async () => {
    // Workspace contains only non-Auggie agents (claude-code, codex). Their
    // sessions must NOT be sent to `auggie session stats`; the saga should
    // dispatch clearSessionStats instead of fetchWorkspaceStats.
    mockSelectAllWorkspaceAgents.mockReturnValue([
      { id: "agent-cc", acpSessionId: "sess-cc", provider: "claude-code" } as any,
      { id: "agent-codex", acpSessionId: "sess-codex", provider: "codex" } as any,
    ]);
    const { task, dispatched, channel } = startSaga();
    await flush();

    channel.put(workspaceMounted(WS) as any);
    await flush();

    const fetched = dispatched.filter((a) => a.type === fetchWorkspaceStats.type);
    expect(fetched).toHaveLength(0);
    const cleared = dispatched.filter((a) => a.type === clearSessionStats.type);
    expect(cleared.length).toBeGreaterThan(0);
    expect(cleared[cleared.length - 1].payload).toEqual([WS]);

    task.cancel();
  });

  it("includes only Auggie agents in the workspace aggregate when the workspace mixes providers", async () => {
    // Mixed workspace: only the Auggie agents' session IDs should be sent.
    // The Auggie-with-backend-only agent must still be included via fallback.
    mockSelectAllWorkspaceAgents.mockReturnValue([
      { id: "agent-auggie-acp", acpSessionId: "sess-a", provider: "auggie" } as any,
      { id: "agent-cc", acpSessionId: "sess-cc", provider: "claude-code" } as any,
      {
        id: "agent-auggie-backend",
        acpSessionId: null,
        backendSessionId: "sess-b",
        provider: "auggie",
      } as any,
      { id: "agent-codex", acpSessionId: "sess-codex", provider: "codex" } as any,
    ]);
    const { task, dispatched, channel } = startSaga();
    await flush();

    channel.put(workspaceMounted(WS) as any);
    await flush();

    const fetched = dispatched.filter((a) => a.type === fetchWorkspaceStats.type);
    expect(fetched).toHaveLength(1);
    expect(fetched[0].payload).toEqual([WS, ["sess-a", "sess-b"]]);

    task.cancel();
  });

  it("treats sessions with no provider and no model as non-Auggie (no fetch)", async () => {
    // Defensive: a session that can't resolve to any provider must not be
    // treated as Auggie. Without a model to infer from, we have no signal.
    mockSelectAllWorkspaceAgents.mockReturnValue([
      { id: AGENT_ID, acpSessionId: SESSION_ID } as any,
    ]);
    const { task, dispatched, channel } = startSaga();
    await flush();

    channel.put(workspaceMounted(WS) as any);
    await flush();

    expect(
      dispatched.filter((a) => a.type === fetchWorkspaceStats.type),
    ).toHaveLength(0);

    task.cancel();
  });

  it("treats sessions with a bare model and no explicit provider as Auggie (model resolves to default provider)", async () => {
    // Bare model IDs like 'opus4.7' resolve to the default provider (auggie),
    // so existing persisted sessions without an explicit `provider` field
    // continue to participate in the workspace aggregate.
    mockSelectAllWorkspaceAgents.mockReturnValue([
      { id: AGENT_ID, acpSessionId: SESSION_ID, model: "opus4.7" } as any,
    ]);
    const { task, dispatched, channel } = startSaga();
    await flush();

    channel.put(workspaceMounted(WS) as any);
    await flush();

    const fetched = dispatched.filter((a) => a.type === fetchWorkspaceStats.type);
    expect(fetched).toHaveLength(1);
    expect(fetched[0].payload).toEqual([WS, [SESSION_ID]]);

    task.cancel();
  });
});
