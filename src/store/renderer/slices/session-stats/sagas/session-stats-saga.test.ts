import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as sagaEffects from "redux-saga/effects";
import {
  runSaga,
  stdChannel,
} from "redux-saga";
import { expectSaga } from "redux-saga-test-plan";

const { mockForkedSagaNames, mockTakeLatestRegistrations } = vi.hoisted(() => ({
  mockForkedSagaNames: [] as string[],
  mockTakeLatestRegistrations: [] as Array<{ patternType: string; workerName: string }>,
}));

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
  takeLatest: function* (pattern: any, worker: any) {
    mockTakeLatestRegistrations.push({
      patternType: pattern.type ?? pattern.name ?? String(pattern),
      workerName: worker.name || "<anonymous>",
    });
    return yield sagaEffects.takeLatest(pattern, worker);
  },
  fork: function* (fn: any, ...args: any[]) {
    mockForkedSagaNames.push(fn.name || "<anonymous>");
    return yield sagaEffects.fork(fn, ...args);
  },
  cancel: function* (task: any) {
    return yield sagaEffects.cancel(task);
  },
  delay: function* (ms: any) {
    return yield sagaEffects.delay(ms);
  },
  race: function* (effects: any) {
    return yield sagaEffects.race(effects);
  },
  getContext: function* (prop: string) {
    return yield sagaEffects.getContext(prop);
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
  clearActiveWorkspace,
  setActiveWorkspaceId,
} from "../../workspace/workspace-slice";
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

function createReduxStoreContext(state: any = {}) {
  const subscribers = new Set<() => void>();
  return {
    reduxStore: {
      getState: () => state,
      subscribe: (listener: () => void) => {
        subscribers.add(listener);
        return () => subscribers.delete(listener);
      },
    },
    notify: () => {
      subscribers.forEach((listener) => listener());
    },
  };
}

function workspaceStatsRequest(
  agentId: string,
  sessionId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    agentId,
    sessionId,
    messageCount: 0,
    isActive: false,
    ...overrides,
  };
}

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

function rawIpcSuccessFor(sessionId: string, messageCount = 3) {
  return {
    ...rawIpcSuccess,
    sessions: [
      {
        ...rawIpcSuccess.sessions[0],
        sessionId,
        messageCount,
      },
    ],
    totalMessageCount: messageCount,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockForkedSagaNames.length = 0;
  mockTakeLatestRegistrations.length = 0;
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
    const { reduxStore } = createReduxStoreContext();
    await expectSaga(sessionStatsSaga)
      .provide([[sagaEffects.getContext("reduxStore"), reduxStore]])
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
    const { reduxStore } = createReduxStoreContext();
    await expectSaga(sessionStatsSaga)
      .provide([[sagaEffects.getContext("reduxStore"), reduxStore]])
      .dispatch(fetchWorkspaceStats(WS, [SESSION_ID]))
      .put(workspaceStatsFailed(WS, "ipc exploded"))
      .silentRun(50);
  });

  it("handleFetchAgentStats: success → agentStatsReceived", async () => {
    mockInvoke.mockResolvedValue({ success: true, data: rawIpcSuccess });
    const { reduxStore } = createReduxStoreContext();
    await expectSaga(sessionStatsSaga)
      .provide([[sagaEffects.getContext("reduxStore"), reduxStore]])
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
    const { reduxStore } = createReduxStoreContext();
    await expectSaga(sessionStatsSaga)
      .provide([[sagaEffects.getContext("reduxStore"), reduxStore]])
      .dispatch(fetchAgentStats(AGENT_ID, SESSION_ID))
      .put(agentStatsFailed(AGENT_ID, "no sess"))
      .silentRun(50);
  });

  it("handleFetchAgentStats: missing session in response → agentStatsFailed", async () => {
    mockInvoke.mockResolvedValue({
      success: true,
      data: { ...rawIpcSuccess, sessions: [] },
    });
    const { reduxStore } = createReduxStoreContext();
    await expectSaga(sessionStatsSaga)
      .provide([[sagaEffects.getContext("reduxStore"), reduxStore]])
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
    const { reduxStore } = createReduxStoreContext();
    await expectSaga(sessionStatsSaga)
      .provide([[sagaEffects.getContext("reduxStore"), reduxStore]])
      .dispatch(fetchWorkspaceStats(WS, [SESSION_ID]))
      .put(workspaceStatsFailed(WS, JSON.stringify(zodErr)))
      .silentRun(50);
  });
});

// ---------------------------------------------------------------------------
// Polling lifecycle — runSaga-based to observe task cancellation and dedup
// ---------------------------------------------------------------------------

type DispatchedAction = { type: string; payload?: any };

function startSaga(opts: { activeWorkspaceId?: string | null; state?: any } = {}) {
  const dispatched: DispatchedAction[] = [];
  const channel = stdChannel();
  mockSelectActiveWorkspaceId.mockReturnValue(opts.activeWorkspaceId ?? null);
  const { reduxStore, notify } = createReduxStoreContext(opts.state ?? {});
  const task = runSaga(
    {
      channel,
      dispatch: (action: DispatchedAction) => {
        dispatched.push(action);
        channel.put(action as any);
      },
      getState: () => opts.state ?? {},
      context: { reduxStore },
    },
    sessionStatsSaga,
  );
  return {
    task,
    dispatched,
    channel,
    setActiveWorkspace: (wsId: string | null) => {
      mockSelectActiveWorkspaceId.mockReturnValue(wsId);
      notify();
      channel.put((wsId ? setActiveWorkspaceId(wsId) : clearActiveWorkspace()) as any);
    },
  };
}


describe("session-stats-saga — watcher registration", () => {
  it("does not register global takeLatest for keyed fetch and agent:idle paths", async () => {
    const { task } = startSaga();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockTakeLatestRegistrations).toEqual([]);

    task.cancel();
  });
});


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
    for (let i = 0; i < 8; i++) {
      await Promise.resolve();
    }
  };

  it("skips IPC when no agents have acpSessionId (no fallback to agent IDs)", async () => {
    mockSelectAllWorkspaceAgents.mockReturnValue([
      { id: AGENT_ID, acpSessionId: null, provider: "auggie" } as any,
    ]);
    const { task, dispatched } = startSaga({ activeWorkspaceId: WS });
    await flush();
    const fetched = dispatched.filter((a) => a.type === fetchWorkspaceStats.type);
    expect(fetched).toHaveLength(0);
    task.cancel();
  });

  it("dispatches fetchWorkspaceStats for the active workspace when a session ID exists", async () => {
    const { task, dispatched } = startSaga({ activeWorkspaceId: WS });
    await flush();
    const fetched = dispatched.filter((a) => a.type === fetchWorkspaceStats.type);
    expect(fetched).toHaveLength(1);
    expect(fetched[0].payload).toEqual([
      WS,
      [workspaceStatsRequest(AGENT_ID, SESSION_ID)],
      [SESSION_ID],
    ]);
    task.cancel();
  });

  it("uses cached stable stats without invoking IPC", async () => {
    mockSelectAllWorkspaceAgents.mockReturnValue([
      {
        id: AGENT_ID,
        acpSessionId: SESSION_ID,
        provider: "auggie",
        messages: [{}, {}, {}],
      } as any,
    ]);
    const { task, dispatched } = startSaga({
      activeWorkspaceId: WS,
      state: {
        sessionStats: {
          agentStats: {
            [AGENT_ID]: {
              sessionId: SESSION_ID,
              messageCount: 3,
              toolCount: 2,
              creditsUsed: 0.5,
              parentCreditsUsed: 0.4,
              subAgentCreditsUsed: 0.1,
              lastFetchedAt: "2026-04-15T00:00:00.000Z",
            },
          },
        },
      },
    });

    await flush();

    expect(mockInvoke).not.toHaveBeenCalled();
    const fetched = dispatched.filter((a) => a.type === fetchWorkspaceStats.type);
    expect(fetched[0].payload[2]).toEqual([]);
    expect(
      dispatched.some((a) => a.type === workspaceStatsReceived.type),
    ).toBe(true);
    task.cancel();
  });

  it("refreshes cached stats when the thread message count increased", async () => {
    mockSelectAllWorkspaceAgents.mockReturnValue([
      {
        id: AGENT_ID,
        acpSessionId: SESSION_ID,
        provider: "auggie",
        messages: [{}, {}, {}],
      } as any,
    ]);
    const { task, dispatched } = startSaga({
      activeWorkspaceId: WS,
      state: {
        sessionStats: {
          agentStats: {
            [AGENT_ID]: {
              sessionId: SESSION_ID,
              messageCount: 2,
              toolCount: 2,
              creditsUsed: 0.5,
              parentCreditsUsed: 0.4,
              subAgentCreditsUsed: 0.1,
              lastFetchedAt: "2026-04-15T00:00:00.000Z",
            },
          },
        },
      },
    });

    await flush();

    const fetched = dispatched.filter((a) => a.type === fetchWorkspaceStats.type);
    expect(fetched[0].payload[2]).toEqual([SESSION_ID]);
    expect(mockInvoke).toHaveBeenCalledWith(expect.any(String), { sessionIds: [SESSION_ID] });
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
    const { task, dispatched } = startSaga({ activeWorkspaceId: WS });
    await flush();
    const fetched = dispatched.filter((a) => a.type === fetchWorkspaceStats.type);
    expect(fetched).toHaveLength(1);
    expect(fetched[0].payload).toEqual([
      WS,
      [
        workspaceStatsRequest("agent-acp-only", "sess-acp"),
        workspaceStatsRequest("agent-backend-only", "sess-backend"),
        workspaceStatsRequest("agent-both", "sess-both-acp"),
      ],
      ["sess-acp", "sess-backend", "sess-both-acp"],
    ]);
    task.cancel();
  });

  it("clears stale stats when agents are removed between polls (empty sessionIds)", async () => {
    const { task, dispatched } = startSaga({ activeWorkspaceId: WS });
    await flush();

    // Active workspace with a populated agent → first fetch dispatched.
    expect(
      dispatched.filter((a) => a.type === fetchWorkspaceStats.type),
    ).toHaveLength(1);
    const clearsBefore = dispatched.filter(
      (a) => a.type === clearSessionStats.type,
    ).length;

    // All agents removed before the next poll tick; still the active workspace.
    mockSelectAllWorkspaceAgents.mockReturnValue([]);
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

  it("keeps polling loop alive on workspaceUnmounted and puts clearSessionStats", async () => {
    const { task, dispatched, channel } = startSaga({ activeWorkspaceId: WS });
    await flush();
    expect(
      dispatched.filter((a) => a.type === fetchWorkspaceStats.type),
    ).toHaveLength(1);

    channel.put(workspaceUnmounted(WS) as any);
    await flush();
    expect(
      dispatched.some((a) => a.type === clearSessionStats.type),
    ).toBe(true);

    // Advance past two poll intervals — the long-lived loop must stay alive but
    // skip stale refresh work for the unmounted active workspace.
    await vi.advanceTimersByTimeAsync(180_000);
    await flush();
    expect(
      dispatched.filter((a) => a.type === fetchWorkspaceStats.type),
    ).toHaveLength(1);
    task.cancel();
  });

  it("dedupes the active-workspace polling owner against workspaceMounted", async () => {
    const { task, dispatched, channel } = startSaga({ activeWorkspaceId: WS });
    await flush();
    // Selector startup should have started active-workspace polling already.
    const afterRetroactive = dispatched.filter(
      (a) => a.type === fetchWorkspaceStats.type,
    ).length;
    expect(afterRetroactive).toBe(1);

    channel.put(workspaceMounted(WS) as any);
    await flush();
    // No new fetch — the single active polling owner kept the existing poller.
    expect(
      dispatched.filter((a) => a.type === fetchWorkspaceStats.type),
    ).toHaveLength(1);
    task.cancel();
  });

  it("uses the single polling loop for active workspace changes and clear", async () => {
    const { task, dispatched, setActiveWorkspace } = startSaga();
    await flush();

    setActiveWorkspace(WS);
    await flush();
    expect(
      dispatched.filter((a) => a.type === fetchWorkspaceStats.type),
    ).toHaveLength(1);

    setActiveWorkspace("ws-other");
    await flush();
    let fetched = dispatched.filter((a) => a.type === fetchWorkspaceStats.type);
    expect(fetched).toHaveLength(2);
    expect(fetched[fetched.length - 1].payload[0]).toBe("ws-other");

    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    fetched = dispatched.filter((a) => a.type === fetchWorkspaceStats.type);
    expect(fetched.filter((a) => a.payload[0] === WS)).toHaveLength(1);

    setActiveWorkspace(null);
    await flush();
    const countAfterClear = dispatched.filter((a) => a.type === fetchWorkspaceStats.type).length;
    await vi.advanceTimersByTimeAsync(180_000);
    await flush();
    expect(dispatched.filter((a) => a.type === fetchWorkspaceStats.type)).toHaveLength(countAfterClear);

    task.cancel();
  });

  it("keeps one polling loop fork across active workspace changes", async () => {
    const { task, setActiveWorkspace, channel } = startSaga({ activeWorkspaceId: WS });
    await flush();

    setActiveWorkspace("ws-other");
    await flush();
    setActiveWorkspace(null);
    await flush();
    channel.put(workspaceUnmounted("ws-other") as any);
    await flush();
    channel.put(workspaceMounted(WS) as any);
    await flush();

    expect(
      mockForkedSagaNames.filter((name) => name === "sessionStatsPollingLoop"),
    ).toHaveLength(1);

    task.cancel();
  });

  it("refreshes the active workspace when it remounts after unmount", async () => {
    const { task, dispatched, channel } = startSaga({ activeWorkspaceId: WS });
    await flush();
    expect(
      dispatched.filter((a) => a.type === fetchWorkspaceStats.type),
    ).toHaveLength(1);

    channel.put(workspaceUnmounted(WS) as any);
    await flush();
    await vi.advanceTimersByTimeAsync(180_000);
    await flush();
    expect(
      dispatched.filter((a) => a.type === fetchWorkspaceStats.type),
    ).toHaveLength(1);

    channel.put(workspaceMounted(WS) as any);
    await flush();
    expect(
      dispatched.filter((a) => a.type === fetchWorkspaceStats.type),
    ).toHaveLength(2);

    task.cancel();
  });
});


// ---------------------------------------------------------------------------
// Keyed fetch cancellation
// ---------------------------------------------------------------------------

describe("session-stats-saga — keyed fetch cancellation", () => {
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

  it("rapid fetchAgentStats cancels the first request — only later result is put", async () => {
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

  it("does not cancel in-flight fetchAgentStats for different agent IDs", async () => {
    mockInvoke.mockImplementation((_channel, request: { sessionIds: string[] }) => {
      const [sessionId] = request.sessionIds;
      const delayMs = sessionId === SESSION_ID ? 5000 : 100;
      const messageCount = sessionId === SESSION_ID ? 10 : 20;
      return new Promise((resolve) =>
        setTimeout(() => resolve({ success: true, data: rawIpcSuccessFor(sessionId, messageCount) }), delayMs),
      );
    });

    const { task, dispatched, channel } = startSaga();
    await flush();

    channel.put(fetchAgentStats(AGENT_ID, SESSION_ID) as any);
    await flush();
    channel.put(fetchAgentStats("agent-2", "sess-2") as any);
    await flush();

    await vi.advanceTimersByTimeAsync(10_000);
    await flush();

    const received = dispatched.filter((a) => a.type === agentStatsReceived.type);
    expect(received).toHaveLength(2);
    expect(received.map((a) => a.payload[0])).toEqual(expect.arrayContaining([AGENT_ID, "agent-2"]));
    expect(received.find((a) => a.payload[0] === AGENT_ID)?.payload[1].messageCount).toBe(10);
    expect(received.find((a) => a.payload[0] === "agent-2")?.payload[1].messageCount).toBe(20);

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

  it("rapid fetchAgentStats keeps only the latest request across repeated cancellations", async () => {
    // All calls use the same delay so the assertion is about latest-request
    // cancellation, not speed.
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

    // First dispatch — starts request A
    channel.put(fetchAgentStats(AGENT_ID, SESSION_ID) as any);
    await flush();

    // Second dispatch — cancels request A, starts request B
    channel.put(fetchAgentStats(AGENT_ID, SESSION_ID) as any);
    await flush();

    // Let cancellation settle before dispatching the latest request.
    await vi.advanceTimersByTimeAsync(50);
    await flush();

    // Third dispatch — cancels request B and becomes the latest request.
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

  it("rapid fetchWorkspaceStats keeps only the latest request across repeated cancellations", async () => {
    let callCount = 0;
    mockInvoke.mockImplementation(() => {
      callCount++;
      const thisCall = callCount;
      const data = {
        ...rawIpcSuccess,
        sessions: [
          {
            ...rawIpcSuccess.sessions[0],
            messageCount: thisCall * 10,
          },
        ],
      };
      return new Promise((resolve) =>
        setTimeout(() => resolve({ success: true, data }), 200),
      );
    });

    const { task, dispatched, channel } = startSaga();
    await flush();

    // First dispatch — starts request A
    channel.put(fetchWorkspaceStats(WS, [SESSION_ID]) as any);
    await flush();

    // Second dispatch — cancels request A, starts request B
    channel.put(fetchWorkspaceStats(WS, [SESSION_ID]) as any);
    await flush();

    // Let cancellation settle before dispatching the latest request.
    await vi.advanceTimersByTimeAsync(50);
    await flush();

    // Third dispatch — cancels request B and becomes the latest request.
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

  it("does not cancel in-flight fetchWorkspaceStats for different workspace IDs", async () => {
    mockInvoke.mockImplementation((_channel, request: { sessionIds: string[] }) => {
      const [sessionId] = request.sessionIds;
      const delayMs = sessionId === SESSION_ID ? 5000 : 100;
      const messageCount = sessionId === SESSION_ID ? 10 : 20;
      return new Promise((resolve) =>
        setTimeout(() => resolve({ success: true, data: rawIpcSuccessFor(sessionId, messageCount) }), delayMs),
      );
    });

    const { task, dispatched, channel } = startSaga();
    await flush();

    channel.put(fetchWorkspaceStats(WS, [SESSION_ID]) as any);
    await flush();
    channel.put(fetchWorkspaceStats("ws-2", ["sess-2"]) as any);
    await flush();

    await vi.advanceTimersByTimeAsync(10_000);
    await flush();

    const received = dispatched.filter((a) => a.type === workspaceStatsReceived.type);
    expect(received).toHaveLength(2);
    expect(received.map((a) => a.payload[0])).toEqual(expect.arrayContaining([WS, "ws-2"]));
    expect(received.find((a) => a.payload[0] === WS)?.payload[1].totalMessageCount).toBe(10);
    expect(received.find((a) => a.payload[0] === "ws-2")?.payload[1].totalMessageCount).toBe(20);

    task.cancel();
  });

  it("removes completed agent fetch tasks so later clear does not retain stale loading", async () => {
    mockInvoke.mockResolvedValue({ success: true, data: rawIpcSuccess });
    mockSelectAllWorkspaceAgents.mockReturnValue([
      { id: AGENT_ID, acpSessionId: SESSION_ID, provider: "auggie" } as any,
    ]);
    const { task, dispatched, channel } = startSaga();
    await flush();

    channel.put(fetchAgentStats(AGENT_ID, SESSION_ID) as any);
    await flush();

    expect(dispatched.filter((a) => a.type === agentStatsReceived.type)).toHaveLength(1);

    channel.put(clearSessionStats(WS) as any);
    await flush();

    expect(dispatched.filter((a) => a.type === clearAgentStatsLoading.type)).toHaveLength(0);

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
    expect(fetched[fetched.length - 1].payload).toEqual([
      WS,
      [workspaceStatsRequest(AGENT_ID, SESSION_ID)],
      [SESSION_ID],
    ]);

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

  it("does not cancel pending agent:idle refetches for different workspaces", async () => {
    const { task, dispatched, channel } = startSaga();
    await flush();
    const baseline = dispatched.filter((a) => a.type === fetchWorkspaceStats.type).length;

    channel.put(eventReceived(WS, idleEvent(WS, "evt-ws-1") as any) as any);
    await flush();
    await vi.advanceTimersByTimeAsync(500);
    channel.put(eventReceived("ws-2", idleEvent("ws-2", "evt-ws-2") as any) as any);
    await flush();

    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    let fetched = dispatched.filter((a) => a.type === fetchWorkspaceStats.type);
    expect(fetched).toHaveLength(baseline + 1);
    expect(fetched[fetched.length - 1].payload[0]).toBe(WS);

    await vi.advanceTimersByTimeAsync(500);
    await flush();
    fetched = dispatched.filter((a) => a.type === fetchWorkspaceStats.type);
    expect(fetched).toHaveLength(baseline + 2);
    expect(fetched[fetched.length - 1].payload[0]).toBe("ws-2");

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

  it("does not let non-idle events cancel a pending agent:idle refetch", async () => {
    const { task, dispatched, channel } = startSaga();
    await flush();
    channel.put(workspaceMounted(WS) as any);
    await flush();
    const baseline = dispatched.filter((a) => a.type === fetchWorkspaceStats.type).length;

    channel.put(eventReceived(WS, idleEvent(WS) as any) as any);
    await flush();
    await vi.advanceTimersByTimeAsync(500);
    channel.put(
      eventReceived(WS, { ...idleEvent(WS, "evt-message"), type: "agent:message" as any } as any) as any,
    );
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    await flush();

    expect(
      dispatched.filter((a) => a.type === fetchWorkspaceStats.type),
    ).toHaveLength(baseline + 1);

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

  it("cancels a delayed agent:idle refetch when the workspace unmounts", async () => {
    const { task, dispatched, channel } = startSaga();
    await flush();
    const baseline = dispatched.filter((a) => a.type === fetchWorkspaceStats.type).length;

    channel.put(eventReceived(WS, idleEvent(WS) as any) as any);
    await flush();
    await vi.advanceTimersByTimeAsync(500);
    channel.put(workspaceUnmounted(WS) as any);
    await flush();

    await vi.advanceTimersByTimeAsync(2000);
    await flush();

    expect(
      dispatched.filter((a) => a.type === fetchWorkspaceStats.type),
    ).toHaveLength(baseline);
    expect(
      dispatched.some((a) => a.type === clearSessionStats.type && a.payload?.[0] === WS),
    ).toBe(true);

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
    const { task, dispatched } = startSaga({ activeWorkspaceId: WS });
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
    const { task, dispatched } = startSaga({ activeWorkspaceId: WS });
    await flush();

    const fetched = dispatched.filter((a) => a.type === fetchWorkspaceStats.type);
    expect(fetched).toHaveLength(1);
    expect(fetched[0].payload).toEqual([
      WS,
      [
        workspaceStatsRequest("agent-auggie-acp", "sess-a"),
        workspaceStatsRequest("agent-auggie-backend", "sess-b"),
      ],
      ["sess-a", "sess-b"],
    ]);

    task.cancel();
  });

  it("treats sessions with no provider and no model as non-Auggie (no fetch)", async () => {
    // Defensive: a session that can't resolve to any provider must not be
    // treated as Auggie. Without a model to infer from, we have no signal.
    mockSelectAllWorkspaceAgents.mockReturnValue([
      { id: AGENT_ID, acpSessionId: SESSION_ID } as any,
    ]);
    const { task, dispatched } = startSaga({ activeWorkspaceId: WS });
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
    const { task, dispatched } = startSaga({ activeWorkspaceId: WS });
    await flush();

    const fetched = dispatched.filter((a) => a.type === fetchWorkspaceStats.type);
    expect(fetched).toHaveLength(1);
    expect(fetched[0].payload).toEqual([
      WS,
      [workspaceStatsRequest(AGENT_ID, SESSION_ID)],
      [SESSION_ID],
    ]);

    task.cancel();
  });
});
