/**
 * Tests for watchQueueProcessingSaga retry and fallback behavior.
 *
 * Verifies:
 * 1. Session retry logic (3 attempts, 200ms apart)
 * 2. Uses session.workspaceId instead of selectActiveWorkspaceId
 * 3. Always sends agent:handler-ready even when session is missing
 * 4. Normal flow works with session present on first try
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSaga } from "redux-saga";
import * as sagaEffects from "redux-saga/effects";
import type { AgentSession } from "$shared/types";

const {
  sendMock,
  saveSessionMock,
  ensureStreamHandlerMock,
  selectState,
} = vi.hoisted(() => ({
  sendMock: vi.fn(),
  saveSessionMock: vi.fn(async () => {}),
  ensureStreamHandlerMock: vi.fn(async () => ({ created: false })),
  selectState: { results: [] as any[], index: 0 },
}));

// Mock window + electronAPI
vi.stubGlobal("window", {
  electronAPI: { send: sendMock },
  dispatchEvent: vi.fn(),
  CustomEvent: class CustomEvent { constructor(public type: string) {} },
});

vi.mock("typed-redux-saga", () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  delay: function* (ms: any) {
    return yield sagaEffects.delay(ms);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  take: function* (pattern: any) {
    return yield sagaEffects.take(pattern);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
  takeLatest: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeLatest(pattern, worker);
  },
}));

vi.mock("$features/agent/agent-ipc-bridge", () => ({
  agentService: {
    saveSession: saveSessionMock,
    ensureStreamHandler: ensureStreamHandlerMock,
    isSendMessageSettingUpStream: vi.fn(async () => false),
    hasActiveStreamHandler: vi.fn(async () => false),
    clearPendingStreamRegistration: vi.fn(async () => {}),
    dispose: vi.fn(),
    reconnectToBackendStreams: vi.fn(async () => {}),
    extractPendingDeletions: vi.fn(async () => []),
    deleteSession: vi.fn(async () => {}),
  },
}));

vi.mock("$features/agent/browser", () => ({
  persistenceService: {
    loadSession: vi.fn(async () => null),
    saveSession: vi.fn(async () => {}),
  },
}));

vi.mock("$lib/utils/client-logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("../workspace-agents-selectors", () => ({
  selectAgentById: {
    select: (_state: any, _agentId: string) => {
      const result = selectState.results[selectState.index] ?? undefined;
      selectState.index++;
      return result;
    },
  },
  selectDiskMessageCount: { select: () => 0 },
  selectRecentAgentCreatedEvent: { select: () => undefined },
  selectRecentAgentCreatedEventsCount: { select: () => 0 },
}));

vi.mock("../../workspace/workspace-selectors", () => ({
  selectActiveWorkspaceId: { select: () => "active-ws-id" },
}));

vi.mock("../../agent-session/agent-session-slice", () => ({
  upsertSession: vi.fn((s: any) => ({ type: "agentSessions/upsertSession", payload: s })),
  addMessage: vi.fn((agentId: string, msg: any) => ({ type: "agentSessions/addMessage", payload: [agentId, msg] })),
  removeMessage: vi.fn((agentId: string, msgId: string) => ({ type: "agentSessions/removeMessage", payload: [agentId, msgId] })),
}));

vi.mock("$lib/store/utils/ipc-channel", () => ({
  takeEveryFromElectronChannel: vi.fn(function* () {}),
  takeEveryFromWindowEvent: vi.fn(function* () {}),
}));

// Import after mocks
import { handleQueueProcessing, handleQueueCancelled } from "./agent-ipc-saga";
import { setAgentStreaming, removeAgentMessage } from "../workspace-agents-slice";

const makeSession = (overrides: Partial<AgentSession> = {}): AgentSession => ({
  id: "agent-1",
  name: "Test Agent",
  workspaceId: "ws-agent-1",
  messages: [],
  isStreaming: false,
  ...overrides,
} as AgentSession);

const queueData = {
  agentId: "agent-1",
  messageId: "msg-1",
  content: "Hello",
};

describe("handleQueueProcessing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sendMock.mockClear();
    saveSessionMock.mockClear();
    ensureStreamHandlerMock.mockClear();
    selectState.index = 0;
    selectState.results = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends handler-ready and dispatches actions when session is found on first attempt", async () => {
    const session = makeSession();
    selectState.results = [session];

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleQueueProcessing,
      queueData,
    ).toPromise();

    expect(sendMock).toHaveBeenCalledWith("agent:handler-ready", { agentId: "agent-1" });
    // Should use session.workspaceId ("ws-agent-1"), not selectActiveWorkspaceId
    const streamingAction = dispatched.find((a) => a.type === setAgentStreaming.type);
    expect(streamingAction?.payload).toEqual(["ws-agent-1", "agent-1", true]);
  });

  // Regression test for root cause #1: session lookup must retry because the
  // session may still be loading when the queue:processing event arrives.
  it("retries session lookup and succeeds on second attempt", async () => {
    const session = makeSession();
    // First call returns undefined, second returns session
    selectState.results = [undefined, session];

    const dispatched: any[] = [];
    const task = runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleQueueProcessing,
      queueData,
    );

    // Advance past the retry delay
    await vi.advanceTimersByTimeAsync(300);
    await task.toPromise();

    expect(selectState.index).toBe(2); // Called twice
    expect(sendMock).toHaveBeenCalledWith("agent:handler-ready", { agentId: "agent-1" });
    const streamingAction = dispatched.find((a) => a.type === setAgentStreaming.type);
    expect(streamingAction?.payload).toEqual(["ws-agent-1", "agent-1", true]);
  });

  // Regression test for root cause #1: handler-ready MUST always be sent even
  // when the session is never found, otherwise the backend blocks indefinitely.
  it("retries 3 times then sends handler-ready without session", async () => {
    // All attempts return undefined
    selectState.results = [undefined, undefined, undefined];

    const dispatched: any[] = [];
    const task = runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleQueueProcessing,
      queueData,
    );

    // Advance past all retry delays (2 delays of 200ms)
    await vi.advanceTimersByTimeAsync(500);
    await task.toPromise();

    expect(selectState.index).toBe(3); // Called 3 times
    // handler-ready MUST still be sent
    expect(sendMock).toHaveBeenCalledWith("agent:handler-ready", { agentId: "agent-1" });
    // No streaming action should be dispatched
    const streamingAction = dispatched.find((a) => a.type === setAgentStreaming.type);
    expect(streamingAction).toBeUndefined();
  });

  it("sends handler-ready when session has no workspaceId", async () => {
    const session = makeSession({ workspaceId: "" as any });
    selectState.results = [session];

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleQueueProcessing,
      queueData,
    ).toPromise();

    expect(sendMock).toHaveBeenCalledWith("agent:handler-ready", { agentId: "agent-1" });
    // No streaming action dispatched (no wsId)
    const streamingAction = dispatched.find((a) => a.type === setAgentStreaming.type);
    expect(streamingAction).toBeUndefined();
  });

  it("uses session.workspaceId for all dispatches, not active workspace", async () => {
    const session = makeSession({ workspaceId: "different-ws" as any });
    selectState.results = [session];

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleQueueProcessing,
      queueData,
    ).toPromise();

    // All dispatched actions should use "different-ws", not "active-ws-id"
    const streamingAction = dispatched.find((a) => a.type === setAgentStreaming.type);
    expect(streamingAction?.payload[0]).toBe("different-ws");
    expect(saveSessionMock).toHaveBeenCalledWith("agent-1", "different-ws", true);
  });
});

// ============================================================================
// handleQueueCancelled — regression tests for queue cancellation cleanup
//
// Verifies the saga uses session.workspaceId (not selectActiveWorkspaceId)
// to clean up workspace-agents state. This is a regression test for the
// verifier finding that cancellation could fail when the user switches to
// a different workspace while a queue operation is being cancelled.
// ============================================================================

describe("handleQueueCancelled", () => {
  const cancelData = { agentId: "agent-1", messageId: "msg-cancel-1" };

  beforeEach(() => {
    vi.useFakeTimers();
    sendMock.mockClear();
    saveSessionMock.mockClear();
    selectState.index = 0;
    selectState.results = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses session.workspaceId for cleanup, not active workspace (verifier regression)", async () => {
    // Session has workspaceId "ws-agent-1" but active workspace is "active-ws-id"
    const session = makeSession({ workspaceId: "ws-agent-1" as any });
    selectState.results = [session];

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleQueueCancelled,
      cancelData,
    ).toPromise();

    // removeAgentMessage should use session.workspaceId, not "active-ws-id"
    const removeAction = dispatched.find((a) => a.type === removeAgentMessage.type);
    expect(removeAction).toBeDefined();
    expect(removeAction?.payload[0]).toBe("ws-agent-1");

    // saveSession should use session.workspaceId
    expect(saveSessionMock).toHaveBeenCalledWith("agent-1", "ws-agent-1", true);
  });

  it("still removes agent-session message when session has no workspaceId", async () => {
    // Session exists but has no workspaceId
    const session = makeSession({ workspaceId: "" as any });
    selectState.results = [session];

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleQueueCancelled,
      cancelData,
    ).toPromise();

    // agent-session message removal always happens (no wsId needed)
    const removeSessionMsg = dispatched.find(
      (a) => a.type === "agentSessions/removeMessage",
    );
    expect(removeSessionMsg).toBeDefined();

    // workspace-agents removal SHOULD happen using activeWorkspaceId fallback
    const removeAgentMsg = dispatched.find((a) => a.type === removeAgentMessage.type);
    expect(removeAgentMsg).toBeDefined();
    expect(removeAgentMsg.payload).toEqual(["active-ws-id", "agent-1", "msg-cancel-1"]);

    // saveSession should be called with the active workspace fallback
    expect(saveSessionMock).toHaveBeenCalledWith("agent-1", "active-ws-id", true);
  });

  it("still removes agent-session message when session is not found at all", async () => {
    // No session found
    selectState.results = [undefined];

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleQueueCancelled,
      cancelData,
    ).toPromise();

    // agent-session message removal always happens
    const removeSessionMsg = dispatched.find(
      (a) => a.type === "agentSessions/removeMessage",
    );
    expect(removeSessionMsg).toBeDefined();

    // workspace-agents cleanup SHOULD happen using activeWorkspaceId fallback
    const removeAgentMsg = dispatched.find((a) => a.type === removeAgentMessage.type);
    expect(removeAgentMsg).toBeDefined();
    expect(removeAgentMsg.payload).toEqual(["active-ws-id", "agent-1", "msg-cancel-1"]);

    // saveSession should be called with the active workspace fallback
    expect(saveSessionMock).toHaveBeenCalledWith("agent-1", "active-ws-id", true);
  });
});
