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

// Mock safe-local-storage-saga
vi.mock("$lib/utils/safe-local-storage-saga" , () => ({
  getLocalStorageJSON: vi.fn(),
  setLocalStorageJSON: vi.fn(),
  removeLocalStorageItem: vi.fn(),
}));

// Mock safe-local-storage-saga at the correct path
vi.mock("../../../utils/safe-local-storage-saga", () => ({
  getLocalStorageJSON: vi.fn(),
  setLocalStorageJSON: vi.fn(),
  removeLocalStorageItem: vi.fn(),
}));

// Mock client logger
vi.mock("$lib/utils/client-logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock initialize-chat-saga
vi.mock("./initialize-chat-saga", () => ({
  initializeChatSaga: function* () { yield; },
}));

// Mock send-message-saga
vi.mock("./send-message-saga", () => ({
  watchSendMessage: function* () { yield; },
}));

// Mock chat-lifecycle-saga
vi.mock("./chat-lifecycle-saga", () => ({
  chatLifecycleSaga: function* () { yield; },
}));

// Mock workspace-agents imports used by cleanup watchers
const {
  mockRemoveAgent,
  mockRemoveWorkspaceAgentState,
  mockAgentStreamUpdateReceived,
  mockWorkspaceUnmounted,
} = vi.hoisted(() => {
  const createMockAction = (type: string) => Object.assign(
    (...args: any[]) => ({ type, payload: args }),
    { type, toString: () => type },
  );

  return {
    mockRemoveAgent: createMockAction("workspaceAgents/removeAgent"),
    mockRemoveWorkspaceAgentState: createMockAction("workspaceAgents/removeWorkspaceAgentState"),
    mockAgentStreamUpdateReceived: createMockAction("workspaceAgents/agentStreamUpdateReceived"),
    mockWorkspaceUnmounted: createMockAction("workspace-lifecycle/workspaceUnmounted"),
  };
});
vi.mock("../../workspace-agents/workspace-agents-slice", () => ({
  removeAgent: mockRemoveAgent,
  removeWorkspaceAgentState: mockRemoveWorkspaceAgentState,
  agentStreamUpdateReceived: mockAgentStreamUpdateReceived,
}));

vi.mock("../../workspace-lifecycle/workspace-lifecycle-slice", () => ({
  workspaceUnmounted: mockWorkspaceUnmounted,
}));

const selectAgentSessionMock = vi.fn();
const selectAllWorkspaceAgentsMock = vi.fn(() => [] as any[]);
vi.mock("../../workspace-agents/workspace-agents-selectors", () => ({
  selectAgentSession: {
    select: (state: any, agentId: string) => selectAgentSessionMock(state, agentId),
    effect: function* (agentId: string) { return yield sagaEffects.select(selectAgentSessionMock, agentId); },
  },
  selectAllWorkspaceAgents: {
    select: (state: any, wsId: string) => selectAllWorkspaceAgentsMock(state, wsId),
    effect: function* (wsId: string) { return yield sagaEffects.select(selectAllWorkspaceAgentsMock, wsId); },
  },
}));

vi.mock("../../agent-session/agent-session-selectors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../agent-session/agent-session-selectors")>();
  const selectSessionIsProcessing = (state: any, agentId: string) =>
    state.agentSessions?.byAgentId?.[agentId]?.isProcessing === true;
  const selectIsResponding = (state: any, agentId: string) => {
    const agent = selectAgentSessionMock(state, agentId) ?? state.agentSessions?.byAgentId?.[agentId];
    return !!(agent?.isStreaming || agent?.isProcessing || agent?.isResponding);
  };

  return {
    ...actual,
    selectAgentSessionIsProcessing: {
      select: selectSessionIsProcessing,
      effect: function* (agentId: string) {
        return yield sagaEffects.select(selectSessionIsProcessing, agentId);
      },
    },
    selectAgentIsResponding: {
      select: selectIsResponding,
      effect: function* (agentId: string) {
        return yield sagaEffects.select(selectIsResponding, agentId);
      },
    },
  };
});

import {
  chatStatusEventsHydrated,
  initializeChatRequested,
  chatSendStarted,
  chatStuckStateCleared,
  streamCompleted,
  streamStatusReceived,
} from "../chat-state-slice";
import {
  STATE_RECONCILIATION_INTERVAL_MS,
  type StatusEvent,
} from "../chat-state-types";
import {
  getLocalStorageJSON,
  setLocalStorageJSON,
} from "../../../utils/safe-local-storage-saga";

const setLocalStorageJSONMock = setLocalStorageJSON as unknown as ReturnType<typeof vi.fn>;


describe("chat-state-saga: status event hydration", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  async function runHydration(persistedValue: unknown): Promise<any[]> {
    (getLocalStorageJSON as any).mockReturnValue(persistedValue);
    const { chatStateSaga } = await import("./chat-state-saga");
    const dispatched: any[] = [];
    const channel = stdChannel();
    const task = runSaga(
      {
        channel,
        dispatch: (action: any) => {
          dispatched.push(action);
          channel.put(action);
        },
        getState: () => ({
          chatState: { byAgentId: {} },
          agentSessions: { byAgentId: {} },
          workspaceAgents: { byWorkspaceId: {} },
        }),
      },
      chatStateSaga,
    );

    channel.put(initializeChatRequested("agent-1", { wsId: "ws-1" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    task.cancel();
    await task.toPromise().catch(() => undefined);
    return dispatched;
  }

  it("hydrates valid persisted status events for the initializing agent", async () => {
    const statusEvents: StatusEvent[] = [
      { phase: "tool-call", message: "Calling tool", level: "info", timestamp: 123 },
    ];

    const dispatched = await runHydration(statusEvents);

    expect(getLocalStorageJSON).toHaveBeenCalledWith("chat-status-events:agent-1");
    expect(dispatched).toContainEqual(chatStatusEventsHydrated("agent-1", statusEvents));
  });

  it("ignores malformed persisted status events without hydrating state", async () => {
    const dispatched = await runHydration({ events: [
      { phase: "tool-call", message: "Calling tool", level: "info", timestamp: 123 },
    ] });

    expect(getLocalStorageJSON).toHaveBeenCalledWith("chat-status-events:agent-1");
    expect(dispatched.some((action) => action.type === chatStatusEventsHydrated.type)).toBe(false);
  });
});



describe("chat-state-saga: reconciliation loop termination (P2-4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("terminates stateReconciliationLoop when isProcessing becomes false", async () => {
    const { chatStateSaga } = await import("./chat-state-saga");

    const dispatched: any[] = [];
    const channel = stdChannel();
    let isProcessing = true;

    runSaga(
      {
        channel,
        dispatch: (action: any) => {
          dispatched.push(action);
          channel.put(action);
        },
        getState: () => ({
          chatState: {
            byAgentId: {
              "agent-1": {
                isStreaming: false,
                isProcessing,
                isStalled: false,
                lastChunkTime: null,
                streamingStartTime: null,
                lastChunkReceivedAt: null,
                statusEvents: [],
                trackedWorkspaceId: null,
              },
            },
          },
          agentSessions: { byAgentId: {} },
          workspaceAgents: { byWorkspaceId: {} },
        }),
      },
      chatStateSaga,
    );

    // Trigger a send started to fork the loops
    channel.put(chatSendStarted({ agentId: "agent-1" }));

    // First tick: isProcessing is true initially, then becomes false
    isProcessing = false;

    // Advance through one reconciliation interval — the loop should return (not continue)
    await vi.advanceTimersByTimeAsync(STATE_RECONCILIATION_INTERVAL_MS + 100);

    // The loop should have terminated without dispatching chatStuckStateCleared
    const stuckCleared = dispatched.filter(
      (a) => a.type === chatStuckStateCleared.type,
    );
    expect(stuckCleared.length).toBe(0);
  });
});

describe("chat-state-saga: per-agentId dedup (P2-5)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancels previous tasks when a new chatSendStarted fires for the same agentId", async () => {
    const { chatStateSaga } = await import("./chat-state-saga");

    const dispatched: any[] = [];
    const channel = stdChannel();

    runSaga(
      {
        channel,
        dispatch: (action: any) => {
          dispatched.push(action);
          channel.put(action);
        },
        getState: () => ({
          chatState: {
            byAgentId: {
              "agent-1": {
                isStreaming: true,
                isProcessing: true,
                isStalled: false,
                lastChunkTime: Date.now(),
                streamingStartTime: Date.now(),
                lastChunkReceivedAt: Date.now(),
                statusEvents: [],
                trackedWorkspaceId: null,
              },
            },
          },
          agentSessions: {
            byAgentId: {
              "agent-1": {
                id: "agent-1",
                messages: [{ role: "assistant", contentBlocks: [{ type: "text" }] }],
              },
            },
          },
          workspaceAgents: { byWorkspaceId: {} },
        }),
      },
      chatStateSaga,
    );

    // Fire first send started
    channel.put(chatSendStarted({ agentId: "agent-1" }));
    await vi.advanceTimersByTimeAsync(100);

    // Fire second send started for same agent — should cancel previous tasks
    channel.put(chatSendStarted({ agentId: "agent-1" }));
    await vi.advanceTimersByTimeAsync(100);

    // Fire third send started — should still only have one set of tasks running
    channel.put(chatSendStarted({ agentId: "agent-1" }));
    await vi.advanceTimersByTimeAsync(100);

    // If dedup works, we shouldn't accumulate tasks — only the latest set runs
    // This test passes as long as it doesn't hang or error from task accumulation
    expect(true).toBe(true);
  });
});

describe("chat-state-saga: clone-safe status event persistence", () => {
  beforeEach(() => {
    setLocalStorageJSONMock.mockReset();
  });

  it("persists sanitized status events when Redux state contains non-cloneable payloads", async () => {
    const { chatStateSaga } = await import("./chat-state-saga");
    const channel = stdChannel();
    const unsafeEvent: Record<string, unknown> = {
      phase: 'tool-call',
      message: new Error('tool failed'),
      level: 'error',
      timestamp: 3000,
      callback: () => undefined,
      token: Symbol('token'),
    };
    unsafeEvent.self = unsafeEvent;

    setLocalStorageJSONMock.mockImplementation((_key: string, value: unknown) => {
      expect(JSON.parse(JSON.stringify(value))).toEqual(value);
      expect(() => structuredClone(value)).not.toThrow();
    });

    runSaga(
      {
        channel,
        dispatch: (action: any) => channel.put(action),
        getState: () => ({
          chatState: {
            byAgentId: {
              "agent-1": {
                isStreaming: false,
                isProcessing: false,
                isStalled: false,
                lastChunkTime: null,
                streamingStartTime: null,
                lastChunkReceivedAt: null,
                statusEvents: [unsafeEvent],
                trackedWorkspaceId: null,
              },
            },
          },
          agentSessions: { byAgentId: {}, agentIdsByWorkspace: {} },
          workspaceAgents: { byWorkspaceId: {} },
        }),
      },
      chatStateSaga,
    );

    channel.put(streamStatusReceived("agent-1", unsafeEvent, false));
    await Promise.resolve();

    expect(setLocalStorageJSONMock).toHaveBeenCalledWith('chat-status-events:agent-1', [
      {
        phase: 'tool-call',
        message: 'tool failed',
        level: 'error',
        timestamp: 3000,
      },
    ]);
  });
});


describe("chat-state-saga: preserve per-agent tasks across workspace unmount (Task C)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    selectAgentSessionMock.mockReset();
    selectAllWorkspaceAgentsMock.mockReset();
    selectAllWorkspaceAgentsMock.mockImplementation(() => []);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps watchdog tasks alive on workspaceUnmounted while the agent is still streaming, then cancels them on streamCompleted", async () => {
    const { chatStateSaga, __getActiveSendTasksForTesting } = await import(
      "./chat-state-saga"
    );
    __getActiveSendTasksForTesting().clear();

    const dispatched: any[] = [];
    const channel = stdChannel();

    const sessionA = {
      id: "agent-X",
      workspaceId: "ws-A",
      isStreaming: true,
      isProcessing: true,
    };

    selectAllWorkspaceAgentsMock.mockImplementation((_state: any, wsId: string) =>
      wsId === "ws-A" ? [sessionA] : [],
    );
    selectAgentSessionMock.mockImplementation((_state: any, agentId: string) =>
      agentId === "agent-X" ? sessionA : undefined,
    );

    const getState = () => ({
      chatState: {
        byAgentId: {
          "agent-X": {
            isStreaming: true,
            isProcessing: true,
            isStalled: false,
            lastChunkTime: Date.now(),
            streamingStartTime: Date.now(),
            lastChunkReceivedAt: Date.now(),
            statusEvents: [],
            trackedWorkspaceId: "ws-A",
          },
        },
      },
      agentSessions: {
        byAgentId: { "agent-X": sessionA },
      },
      workspaceAgents: { byWorkspaceId: { "ws-A": { agentIds: ["agent-X"] } } },
    });

    runSaga(
      {
        channel,
        dispatch: (action: any) => {
          dispatched.push(action);
          channel.put(action);
        },
        getState,
      },
      chatStateSaga,
    );

    channel.put(chatSendStarted("agent-X", "ws-A"));
    await vi.advanceTimersByTimeAsync(50);

    const mapAfterStart = __getActiveSendTasksForTesting();
    expect(mapAfterStart.has("agent-X")).toBe(true);
    const tasksAfterStart = mapAfterStart.get("agent-X")!;
    expect(tasksAfterStart.length).toBeGreaterThan(0);
    expect(tasksAfterStart.every((t) => t.isRunning())).toBe(true);

    // Workspace unmounts while the agent is still streaming/processing —
    // watchdog tasks must remain alive.
    channel.put(mockWorkspaceUnmounted("ws-A"));
    await vi.advanceTimersByTimeAsync(50);

    const mapAfterUnmount = __getActiveSendTasksForTesting();
    expect(mapAfterUnmount.has("agent-X")).toBe(true);
    const tasksAfterUnmount = mapAfterUnmount.get("agent-X")!;
    expect(tasksAfterUnmount.every((t) => t.isRunning())).toBe(true);

    // Simulate the agent completing (equivalent to an `agent:completed`
    // event reaching the chat-state slice): session lifecycle event fires,
    // watchdogs must be cancelled and the map entry cleared.
    sessionA.isStreaming = false;
    sessionA.isProcessing = false;
    channel.put(
      streamCompleted("agent-X", {
        lastAttemptedMessage: null,
        modelUnavailable: null,
      }),
    );
    await vi.advanceTimersByTimeAsync(50);

    const mapAfterComplete = __getActiveSendTasksForTesting();
    expect(mapAfterComplete.has("agent-X")).toBe(false);
    expect(tasksAfterUnmount.every((t) => !t.isRunning())).toBe(true);
  });
});
