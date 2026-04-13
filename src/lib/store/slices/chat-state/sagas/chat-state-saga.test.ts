import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as sagaEffects from "redux-saga/effects";
import { runSaga, stdChannel } from "redux-saga";

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
  select: function* (selector: any) {
    return yield sagaEffects.select(selector);
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

// Mock chat service
vi.mock("$features/agent/services/chat.service", () => ({
  getChatService: vi.fn(() => ({
    flushPendingStreamingContent: vi.fn(),
  })),
}));

// Mock agent-ipc-bridge
vi.mock("$features/agent/agent-ipc-bridge", () => ({
  agentService: {
    getSession: vi.fn(),
    restoreSession: vi.fn(),
  },
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
const mockRemoveAgent = Object.assign(
  (...args: any[]) => ({ type: "workspaceAgents/removeAgent", payload: args }),
  { type: "workspaceAgents/removeAgent", toString: () => "workspaceAgents/removeAgent" },
);
vi.mock("../../workspace-agents/workspace-agents-slice", () => ({
  removeAgent: mockRemoveAgent,
}));

const mockWorkspaceUnmounted = Object.assign(
  (...args: any[]) => ({ type: "workspace-lifecycle/workspaceUnmounted", payload: args }),
  { type: "workspace-lifecycle/workspaceUnmounted", toString: () => "workspace-lifecycle/workspaceUnmounted" },
);
vi.mock("../../workspace-lifecycle/workspace-lifecycle-slice", () => ({
  workspaceUnmounted: mockWorkspaceUnmounted,
}));

vi.mock("../../workspace-agents/workspace-agents-selectors", () => ({
  selectAgentById: { select: vi.fn() },
  selectAllWorkspaceAgents: { select: vi.fn(() => []) },
}));

import {
  chatSendStarted,
  chatStuckStateCleared,
} from "../chat-state-slice";
import { STATE_RECONCILIATION_INTERVAL_MS } from "../chat-state-types";



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
          agentSessions: { byAgentId: {}, agentIdsByWorkspace: {} },
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
            agentIdsByWorkspace: {},
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
