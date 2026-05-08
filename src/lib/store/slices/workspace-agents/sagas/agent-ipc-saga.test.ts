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
import { AgentStatus, type AgentSession } from "$shared/types";

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

vi.mock("../workspace-agents-selectors", () => {
  const selectAgentByIdImpl = (_state: any, _agentId: string) => {
    const result = selectState.results[selectState.index] ?? undefined;
    selectState.index++;
    return result;
  };
  return {
    selectAgentById: {
      select: selectAgentByIdImpl,
      effect: function* (agentId: string) {
        return yield sagaEffects.select(selectAgentByIdImpl, agentId);
      },
    },
    selectDiskMessageCount: { select: () => 0 },
    selectRecentAgentCreatedEvent: { select: () => undefined },
    selectRecentAgentCreatedEventsCount: { select: () => 0 },
  };
});

vi.mock("../../workspace/workspace-selectors", () => ({
  selectActiveWorkspaceId: { select: () => "active-ws-id" },
}));

vi.mock("../../agent-session/agent-session-slice", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    upsertSession: vi.fn((s: any) => ({ type: "agentSessions/upsertSession", payload: s })),
    addMessage: vi.fn((agentId: string, msg: any) => ({ type: "agentSessions/addMessage", payload: [agentId, msg] })),
    removeMessage: vi.fn((agentId: string, msgId: string) => ({ type: "agentSessions/removeMessage", payload: [agentId, msgId] })),
    replaceMessageById: vi.fn((agentId: string, oldId: string, newMsg: any) => ({ type: "agentSessions/replaceMessageById", payload: [agentId, oldId, newMsg] })),
  };
});

vi.mock("$lib/store/utils/ipc-channel", () => ({
  takeEveryFromElectronChannel: vi.fn(function* () {}),
  takeEveryFromWindowEvent: vi.fn(function* () {}),
}));

// Import after mocks
import {
  handleQueueProcessing,
  handleQueueCancelled,
  handleExistingSessionUpdate,
  handleAgentCreated,
  handleStreamDisconnected,
  handleAgentIdle,
} from "./agent-ipc-saga";
import { setAgentStreaming, removeAgentMessage, replaceAgentMessageById, updateAgentMessage } from "../workspace-agents-slice";
import { streamCompleted } from "../../chat-state/chat-state-slice";

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

describe("handleAgentCreated", () => {
  beforeEach(() => {
    selectState.index = 0;
    selectState.results = [];
    ensureStreamHandlerMock.mockClear();
  });

  it("creates blank backend-created sessions as idle and non-streaming", async () => {
    const dispatched: any[] = [];

    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleAgentCreated,
      {
        agentId: "agent-blank",
        workspaceId: "ws-blank",
        agent: {
          id: "agent-blank",
          workspaceId: "ws-blank",
          name: "Blank Agent",
          status: AgentStatus.Active,
          messages: [],
        },
      },
    ).toPromise();

    const upsert = dispatched.find((a) => a.type === "agentSessions/upsertSession");
    expect(upsert?.payload).toMatchObject({
      id: "agent-blank",
      status: AgentStatus.Idle,
      isStreaming: false,
      isProcessing: false,
      isResponding: false,
    });
    expect(ensureStreamHandlerMock).toHaveBeenCalledWith("agent-blank", {
      workspaceId: "ws-blank",
    });
  });
});

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

  it("preserves queued user app ID and passes assistant app ID to stream handler", async () => {
    const session = makeSession();
    selectState.results = [session];
    const data = {
      ...queueData,
      appMessageId: "app_msg_user_queue",
      assistantAppMessageId: "app_msg_assistant_queue",
    };

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleQueueProcessing,
      data,
    ).toPromise();

    const userMessageAction = dispatched.find((a) => a.payload?.[1]?.id === data.messageId);
    expect(userMessageAction?.payload[1].appMessageId).toBe(data.appMessageId);
    expect(ensureStreamHandlerMock).toHaveBeenCalledWith("agent-1", {
      forceReregister: true,
      assistantAppMessageId: data.assistantAppMessageId,
    });
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


describe("handleExistingSessionUpdate — content-hash collision", () => {
  const baseTime = new Date("2025-01-15T12:00:00Z");
  const makeMsg = (id: string, text: string, offsetMs = 0): AgentMessage => ({
    id,
    role: "assistant",
    contentBlocks: [{ type: "text", text }],
    timestamp: new Date(baseTime.getTime() + offsetMs).toISOString(),
    metadata: {},
  });

  beforeEach(() => {
    selectState.index = 0;
    selectState.results = [];
  });

  it("picks the closest-timestamp local message when multiple share the same content hash", async () => {
    // Two local messages with identical content but different timestamps.
    // The canonical message's timestamp is closer to localB.
    const localA = makeMsg("local-uuid-a", "Hello world", 0);       // T+0
    const localB = makeMsg("local-uuid-b", "Hello world", 5_000);   // T+5s
    const canonical = makeMsg("msg_canonical-1", "Hello world", 4_000); // T+4s  (closer to B)

    const session = makeSession({
      id: "agent-1",
      workspaceId: "ws-1",
      messages: [localA, localB],
    });

    const agent = { messages: [canonical] };

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleExistingSessionUpdate as any,
      session,
      agent,
      "agent-1",
      "ws-1",
    ).toPromise();

    // Should replace localB in-place (closer timestamp) with canonical
    const replaceOps = dispatched.filter((a) => a.type === "agentSessions/replaceMessageById");
    expect(replaceOps.length).toBe(1);
    expect(replaceOps[0].payload).toEqual(["agent-1", "local-uuid-b", canonical]);

    // Workspace-agents store should also get in-place replacement
    const wsReplace = dispatched.filter((a) => a.type === replaceAgentMessageById.type);
    expect(wsReplace.length).toBe(1);
    expect(wsReplace[0].payload).toEqual(["ws-1", "agent-1", "local-uuid-b", canonical]);
  });

  it("preserves single-match behavior (no regression)", async () => {
    const local = makeMsg("local-uuid-only", "Single message", 0);
    const canonical = makeMsg("msg_canonical-2", "Single message", 2_000);

    const session = makeSession({
      id: "agent-1",
      workspaceId: "ws-1",
      messages: [local],
    });

    const agent = { messages: [canonical] };

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleExistingSessionUpdate as any,
      session,
      agent,
      "agent-1",
      "ws-1",
    ).toPromise();

    // Should replace local message in-place with canonical
    const replaceOps = dispatched.filter((a) => a.type === "agentSessions/replaceMessageById");
    expect(replaceOps.length).toBe(1);
    expect(replaceOps[0].payload).toEqual(["agent-1", "local-uuid-only", canonical]);
  });
});


// ============================================================================
// handleStreamDisconnected — regression: must not fall back to active workspace
//
// Scenario: agent belongs to workspace A, user is viewing workspace B.
// If the session lacks a workspaceId, the saga must skip — NOT write to
// the active workspace (B). Writing to B lands stale flags in a workspace
// the agent doesn't own.
// ============================================================================

describe("handleStreamDisconnected", () => {
  beforeEach(() => {
    sendMock.mockClear();
    selectState.index = 0;
    selectState.results = [];
  });

  it("uses session.workspaceId (agent's workspace A), not active workspace (B)", async () => {
    // Agent belongs to workspace A; user is viewing active workspace "active-ws-id" (B)
    const session = makeSession({ workspaceId: "ws-A" as any });
    selectState.results = [session];

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleStreamDisconnected,
      { agentId: "agent-1" },
    ).toPromise();

    const streamingAction = dispatched.find((a) => a.type === setAgentStreaming.type);
    expect(streamingAction).toBeDefined();
    expect(streamingAction.payload[0]).toBe("ws-A");
    // Must NOT land on the active workspace (B)
    expect(streamingAction.payload[0]).not.toBe("active-ws-id");
  });

  it("skips when session has no workspaceId — no state change lands on active workspace (B)", async () => {
    // Session found in state but missing workspaceId; active workspace is "active-ws-id" (B)
    const session = makeSession({ workspaceId: "" as any });
    selectState.results = [session];

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleStreamDisconnected,
      { agentId: "agent-1" },
    ).toPromise();

    // No setAgentStreaming dispatch at all — must not fall back to "active-ws-id"
    const streamingActions = dispatched.filter((a) => a.type === setAgentStreaming.type);
    expect(streamingActions).toHaveLength(0);
  });

  it("skips when session is not found", async () => {
    selectState.results = [undefined];

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleStreamDisconnected,
      { agentId: "agent-1" },
    ).toPromise();

    expect(dispatched).toHaveLength(0);
  });
});


describe("handleExistingSessionUpdate — in-place replacement preserves order", () => {
  const makeMsg = (id: string, text: string, ts: string): AgentMessage => ({
    id,
    role: "assistant",
    contentBlocks: [{ type: "text", text }],
    timestamp: ts,
    metadata: {},
  });

  beforeEach(() => {
    selectState.index = 0;
    selectState.results = [];
  });

  it("replaces local message in-place (not appended to end)", async () => {
    // Existing session: [msgA@t=10, localB@t=20, msgC@t=30]
    const msgA = makeMsg("msg_a", "First", "2024-01-01T00:00:10.000Z");
    const localB = makeMsg("local-uuid-b", "Middle", "2024-01-01T00:00:20.000Z");
    const msgC = makeMsg("msg_c", "Third", "2024-01-01T00:00:30.000Z");

    const session = makeSession({
      id: "agent-1",
      workspaceId: "ws-1",
      messages: [msgA, localB, msgC],
    });

    // Canonical message for localB (same content, close timestamp)
    const canonicalB = makeMsg("msg_b_canonical", "Middle", "2024-01-01T00:00:20.000Z");
    const agent = { messages: [canonicalB] };

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleExistingSessionUpdate as any,
      session,
      agent,
      "agent-1",
      "ws-1",
    ).toPromise();

    // Should dispatch replaceMessageById (in-place), NOT remove+add
    const replaceOps = dispatched.filter((a) => a.type === "agentSessions/replaceMessageById");
    expect(replaceOps.length).toBe(1);
    expect(replaceOps[0].payload).toEqual(["agent-1", "local-uuid-b", canonicalB]);

    // Should NOT dispatch addMessage (which would append to end)
    const addOps = dispatched.filter((a) => a.type === "agentSessions/addMessage");
    expect(addOps.length).toBe(0);

    // Should NOT dispatch removeMessage
    const removeOps = dispatched.filter((a) => a.type === "agentSessions/removeMessage");
    expect(removeOps.length).toBe(0);
  });
});


// ============================================================================
// handleAgentIdle — backend authoritative "turn done" reconciliation
//
// The agent overview reads `session.isStreaming`/`session.isProcessing` and
// `lastAssistantMsg.isStreaming`/`streamingComplete` to decide if an agent
// is "responding". When ChatService misses the per-stream `complete` event
// (e.g. delegated agent never had a chat handler, or IPC was congested),
// these flags get stuck. `agent:idle` is the backend's authoritative signal,
// and the saga must clear all stale flags so the overview matches reality.
// ============================================================================

describe("handleAgentIdle", () => {
  beforeEach(() => {
    selectState.index = 0;
    selectState.results = [];
  });

  it("dispatches streamCompleted to clear session-level streaming flags", async () => {
    const session = makeSession({ workspaceId: "ws-A" as any, isStreaming: true });
    selectState.results = [session];

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleAgentIdle,
      { agentId: "agent-1", workspaceId: "ws-A" },
    ).toPromise();

    const completedAction = dispatched.find((a) => a.type === streamCompleted.type);
    expect(completedAction).toBeDefined();
    expect(completedAction.payload[0]).toBe("agent-1");
    expect(completedAction.payload[1]).toEqual({
      lastAttemptedMessage: null,
      modelUnavailable: null,
    });
  });

  it("clears isStreaming on in-flight assistant messages", async () => {
    const session = makeSession({
      workspaceId: "ws-A" as any,
      isStreaming: true,
      messages: [
        { id: "msg-user-1", role: "user", contentBlocks: [], timestamp: "" } as any,
        { id: "msg-asst-1", role: "assistant", contentBlocks: [], timestamp: "", isStreaming: true } as any,
      ],
    });
    selectState.results = [session];

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleAgentIdle,
      { agentId: "agent-1", workspaceId: "ws-A" },
    ).toPromise();

    const updates = dispatched.filter((a) => a.type === updateAgentMessage.type);
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toEqual([
      "ws-A",
      "agent-1",
      "msg-asst-1",
      { isStreaming: false, streamingComplete: true },
    ]);
  });

  it("clears messages with streamingComplete === false even when isStreaming is unset", async () => {
    const session = makeSession({
      workspaceId: "ws-A" as any,
      messages: [
        { id: "msg-asst-1", role: "assistant", contentBlocks: [], timestamp: "", streamingComplete: false } as any,
      ],
    });
    selectState.results = [session];

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleAgentIdle,
      { agentId: "agent-1" },
    ).toPromise();

    const updates = dispatched.filter((a) => a.type === updateAgentMessage.type);
    expect(updates).toHaveLength(1);
    expect(updates[0].payload[3]).toEqual({ isStreaming: false, streamingComplete: true });
  });

  it("does not dispatch updates for messages that are already finalized", async () => {
    const session = makeSession({
      workspaceId: "ws-A" as any,
      messages: [
        { id: "msg-asst-1", role: "assistant", contentBlocks: [], timestamp: "", isStreaming: false, streamingComplete: true } as any,
      ],
    });
    selectState.results = [session];

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleAgentIdle,
      { agentId: "agent-1" },
    ).toPromise();

    const updates = dispatched.filter((a) => a.type === updateAgentMessage.type);
    expect(updates).toHaveLength(0);
  });

  it("prefers session.workspaceId over the event payload's workspaceId", async () => {
    const session = makeSession({
      workspaceId: "ws-A" as any,
      messages: [
        { id: "msg-asst-1", role: "assistant", contentBlocks: [], timestamp: "", isStreaming: true } as any,
      ],
    });
    selectState.results = [session];

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleAgentIdle,
      { agentId: "agent-1", workspaceId: "ws-WRONG" },
    ).toPromise();

    const updates = dispatched.filter((a) => a.type === updateAgentMessage.type);
    expect(updates[0].payload[0]).toBe("ws-A");
  });

  it("falls back to the event's workspaceId when the session has none", async () => {
    const session = makeSession({
      workspaceId: "" as any,
      messages: [
        { id: "msg-asst-1", role: "assistant", contentBlocks: [], timestamp: "", isStreaming: true } as any,
      ],
    });
    selectState.results = [session];

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleAgentIdle,
      { agentId: "agent-1", workspaceId: "ws-fallback" },
    ).toPromise();

    const updates = dispatched.filter((a) => a.type === updateAgentMessage.type);
    expect(updates[0].payload[0]).toBe("ws-fallback");
  });

  it("skips when session is not found", async () => {
    selectState.results = [undefined];

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleAgentIdle,
      { agentId: "agent-missing", workspaceId: "ws-A" },
    ).toPromise();

    expect(dispatched).toHaveLength(0);
  });

  it("skips when no agentId is provided", async () => {
    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleAgentIdle,
      { workspaceId: "ws-A" } as any,
    ).toPromise();

    expect(dispatched).toHaveLength(0);
  });

  it("skips when neither session nor payload has a workspaceId", async () => {
    const session = makeSession({ workspaceId: "" as any, isStreaming: true });
    selectState.results = [session];

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleAgentIdle,
      { agentId: "agent-1" },
    ).toPromise();

    expect(dispatched).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // Guard: only act if there is stale state to clean up. This keeps the
  // handler as a strict fallback so it cannot interfere with the healthy
  // path (where ChatService has already cleared the flags) or with a
  // queued message's freshly-starting stream on the same agent.
  // ---------------------------------------------------------------------
  it("dispatches nothing when session flags are already cleared and no in-flight messages", async () => {
    const session = makeSession({
      workspaceId: "ws-A" as any,
      isStreaming: false,
      messages: [
        { id: "msg-asst-1", role: "assistant", contentBlocks: [], timestamp: "", streamingComplete: true } as any,
      ],
    });
    selectState.results = [session];

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleAgentIdle,
      { agentId: "agent-1", workspaceId: "ws-A" },
    ).toPromise();

    expect(dispatched).toHaveLength(0);
  });

  it("does not dispatch streamCompleted when session flags are already cleared (only finalizes in-flight messages)", async () => {
    const session = makeSession({
      workspaceId: "ws-A" as any,
      isStreaming: false,
      messages: [
        { id: "msg-asst-1", role: "assistant", contentBlocks: [], timestamp: "", streamingComplete: false } as any,
      ],
    });
    selectState.results = [session];

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleAgentIdle,
      { agentId: "agent-1", workspaceId: "ws-A" },
    ).toPromise();

    const completed = dispatched.filter((a) => a.type === streamCompleted.type);
    const updates = dispatched.filter((a) => a.type === updateAgentMessage.type);
    expect(completed).toHaveLength(0);
    expect(updates).toHaveLength(1);
  });

  it("dispatches streamCompleted when isProcessing is set even if isStreaming is false", async () => {
    const session = makeSession({
      workspaceId: "ws-A" as any,
      isStreaming: false,
      isProcessing: true,
    } as any);
    selectState.results = [session];

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleAgentIdle,
      { agentId: "agent-1", workspaceId: "ws-A" },
    ).toPromise();

    const completed = dispatched.filter((a) => a.type === streamCompleted.type);
    expect(completed).toHaveLength(1);
  });
});
