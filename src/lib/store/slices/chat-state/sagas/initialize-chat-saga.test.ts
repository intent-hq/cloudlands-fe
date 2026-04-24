import { beforeEach, describe, expect, it, vi } from "vitest";
import * as sagaEffects from "redux-saga/effects";
import { runSaga, stdChannel } from "redux-saga";

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
  join: function* (task: any) {
    return yield sagaEffects.join(task);
  },
  delay: function* (ms: any) {
    return yield sagaEffects.delay(ms);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  race: function* (effects: any) {
    return yield sagaEffects.race(effects);
  },
}));

vi.mock("$lib/utils/client-logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockLoadSession = vi.fn();
vi.mock("$features/agent/browser/index", () => ({
  persistenceService: {
    loadSession: (...args: any[]) => mockLoadSession(...args),
  },
}));

const mockGetSession = vi.fn();
const mockRestoreSession = vi.fn();
vi.mock("$features/agent/agent-ipc-bridge", () => ({
  agentService: {
    getSession: (...args: any[]) => mockGetSession(...args),
    restoreSession: (...args: any[]) => mockRestoreSession(...args),
  },
}));

const mockSetupStreaming = vi.fn();
vi.mock("$features/agent/services/chat.service", () => ({
  getChatService: vi.fn(() => ({
    setupStreamingForSession: mockSetupStreaming,
  })),
}));

vi.mock("../../workspace-agents/workspace-agents-slice", () => ({
  addAgent: Object.assign(
    (...args: any[]) => ({ type: "workspaceAgents/addAgent", payload: args }),
    { type: "workspaceAgents/addAgent", toString: () => "workspaceAgents/addAgent" },
  ),
  upsertAgentSession: (...args: any[]) => ({
    type: "workspaceAgents/upsertAgentSession",
    payload: args,
  }),
}));

vi.mock("../../workspace/workspace-selectors", () => ({
  selectWorkspaceById: {
    select: vi.fn(),
    effect: function* () { return { id: "ws-1", worktreePath: "/tmp" }; },
  },
}));

// These need to return functions that work as selectors
const mockSelectAgentById = vi.fn();
vi.mock("../../workspace-agents/workspace-agents-selectors", () => ({
  selectAgentById: {
    select: (...args: any[]) => mockSelectAgentById(...args),
  },
  selectIsInitialSpecWriteInProgress: {
    select: () => false,
  },
}));

const mockSelectAgentMessages = vi.fn();
vi.mock("../../agent-session/agent-session-selectors", () => ({
  selectAgentMessages: {
    select: (...args: any[]) => mockSelectAgentMessages(...args),
  },
}));

vi.mock("../../agent-session/agent-session-slice", () => ({
  upsertSession: (session: any) => ({
    type: "agentSessions/upsertSession",
    payload: session,
  }),
  replaceMessages: (agentId: any, messages: any) => ({
    type: "agentSessions/replaceMessages",
    payload: [agentId, messages],
  }),
}));

const mockSelectChatState = vi.fn();
vi.mock("../chat-state-selectors", () => ({
  selectChatStateOrDefault: {
    select: (...args: any[]) => mockSelectChatState(...args),
  },
}));

import { initializeChatRequested } from "../chat-state-slice";


function makeMsg(id: string, role: "user" | "assistant" = "user", text = "hello") {
  return {
    id,
    role,
    contentBlocks: [{ type: "text" as const, text }],
    timestamp: new Date().toISOString(),
  };
}

const defaultChatState = {
  isStreaming: false,
  isProcessing: false,
  streamingContent: "",
  lastAttemptedMessage: null,
  sendKeys: [],
  statusEvents: [],
};

describe("initialize-chat-saga: disk message merge regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectChatState.mockReturnValue(defaultChatState);
  });

  it("merges missing initial messages from disk when Redux has stale subset", async () => {
    const { initializeChatSaga } = await import("./initialize-chat-saga");

    // Redux has messages 2,3 (missing message 1 — the initial message)
    const msg1 = makeMsg("msg-1", "user", "initial prompt");
    const msg2 = makeMsg("msg-2", "assistant", "response");
    const msg3 = makeMsg("msg-3", "user", "follow-up");

    const existingSession = {
      id: "agent-1",
      sessionId: "session-1",
      workspaceId: "ws-1",
      name: "Test Agent",
      status: "idle",
      isStreaming: false,
      messages: [msg2, msg3], // Missing msg1!
      model: "test-model",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // selectAgentById returns the session (re-open scenario)
    mockSelectAgentById.mockReturnValue(existingSession);
    // selectAgentMessages returns same stale messages
    mockSelectAgentMessages.mockReturnValue([msg2, msg3]);
    // Disk has all 3 messages
    mockLoadSession.mockResolvedValue({
      ...existingSession,
      messages: [msg1, msg2, msg3],
    });

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
          chatState: { byAgentId: {} },
          agentSessions: {
            byAgentId: {
              "agent-1": existingSession,
            },
            agentIdsByWorkspace: {},
          },
          workspaceAgents: { byWorkspaceId: {} },
        }),
      },
      initializeChatSaga as any,
    );

    // Dispatch the init action
    channel.put(initializeChatRequested("agent-1", { wsId: "ws-1" }));

    // Wait for async operations
    await vi.dynamicImportSettled();
    await new Promise((r) => setTimeout(r, 50));

    // Verify loadSession was called with (agentId, wsId, { bypassCache: true })
    // bypassCache ensures we read fresh data from disk, not a stale cached session
    expect(mockLoadSession).toHaveBeenCalledWith("agent-1", "ws-1", { bypassCache: true });

    // Find the upsertSession dispatch — it should contain all 3 messages
    const upsertActions = dispatched.filter(
      (a) => a.type === "agentSessions/upsertSession",
    );
    expect(upsertActions.length).toBeGreaterThanOrEqual(1);

    const upsertedSession = upsertActions[upsertActions.length - 1].payload;
    const messageIds = upsertedSession.messages.map((m: any) => m.id);

    // The critical assertion: msg-1 (the initial message) must be present
    expect(messageIds).toContain("msg-1");
    expect(messageIds).toContain("msg-2");
    expect(messageIds).toContain("msg-3");
    // And in the correct order (disk canonical order)
    expect(messageIds).toEqual(["msg-1", "msg-2", "msg-3"]);
  });

  it("does NOT call disk load when actively streaming", async () => {
    const { initializeChatSaga } = await import("./initialize-chat-saga");

    const msg1 = makeMsg("msg-1", "user");
    const streamingSession = {
      id: "agent-1",
      sessionId: "session-1",
      workspaceId: "ws-1",
      name: "Test Agent",
      status: "active",
      isStreaming: true,
      messages: [msg1],
      model: "test-model",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockSelectAgentById.mockReturnValue(streamingSession);
    mockSelectAgentMessages.mockReturnValue([msg1]);

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
          chatState: { byAgentId: {} },
          agentSessions: {
            byAgentId: { "agent-1": streamingSession },
            agentIdsByWorkspace: {},
          },
          workspaceAgents: { byWorkspaceId: {} },
        }),
      },
      initializeChatSaga as any,
    );

    channel.put(initializeChatRequested("agent-1", { wsId: "ws-1" }));

    await vi.dynamicImportSettled();
    await new Promise((r) => setTimeout(r, 50));

    // persistenceService.loadSession should NOT have been called during streaming
    expect(mockLoadSession).not.toHaveBeenCalled();
  });

  it("handles disk load failure gracefully — uses in-memory messages", async () => {
    const { initializeChatSaga } = await import("./initialize-chat-saga");

    const msg1 = makeMsg("msg-1", "user");
    const session = {
      id: "agent-1",
      sessionId: "session-1",
      workspaceId: "ws-1",
      name: "Test Agent",
      status: "idle",
      isStreaming: false,
      messages: [msg1],
      model: "test-model",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockSelectAgentById.mockReturnValue(session);
    mockSelectAgentMessages.mockReturnValue([msg1]);
    mockLoadSession.mockRejectedValue(new Error("Disk read failed"));

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
          chatState: { byAgentId: {} },
          agentSessions: {
            byAgentId: { "agent-1": session },
            agentIdsByWorkspace: {},
          },
          workspaceAgents: { byWorkspaceId: {} },
        }),
      },
      initializeChatSaga as any,
    );

    channel.put(initializeChatRequested("agent-1", { wsId: "ws-1" }));

    await vi.dynamicImportSettled();
    await new Promise((r) => setTimeout(r, 50));

    // Verify loadSession was called with correct args (including bypassCache) despite failure
    expect(mockLoadSession).toHaveBeenCalledWith("agent-1", "ws-1", { bypassCache: true });

    // Should still dispatch upsertSession with the in-memory message
    const upsertActions = dispatched.filter(
      (a) => a.type === "agentSessions/upsertSession",
    );
    expect(upsertActions.length).toBeGreaterThanOrEqual(1);

    const upsertedSession = upsertActions[upsertActions.length - 1].payload;
    expect(upsertedSession.messages.map((m: any) => m.id)).toContain("msg-1");
  });
});