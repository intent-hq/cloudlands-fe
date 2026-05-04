import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  getContext: function* (prop: string) {
    return yield sagaEffects.getContext(prop);
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

class MockMessageGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MessageGuardError';
  }
}
const mockSetupStreaming = vi.fn();
const mockSendMessage = vi.fn().mockResolvedValue(undefined);
vi.mock("$features/agent/services/chat.service", () => ({
  MessageGuardError: MockMessageGuardError,
  getChatService: vi.fn(() => ({
    setupStreamingForSession: mockSetupStreaming,
    sendMessage: mockSendMessage,
  })),
}));

vi.mock("../../workspace/workspace-selectors", () => ({
  selectWorkspaceById: {
    select: vi.fn(),
    effect: function* () { return { id: "ws-1", worktreePath: "/tmp" }; },
  },
}));

// These need to return functions that work as selectors
const mockSelectAgentById = vi.fn();
const mockSelectWorkspaceAgentReadySession = vi.fn();
vi.mock("../../workspace-agents/workspace-agents-selectors", () => ({
  selectAgentById: {
    select: (...args: any[]) => mockSelectAgentById(...args),
    effect: function* (...args: any[]) { return mockSelectAgentById(...args); },
  },
  selectWorkspaceAgentReadySession: {
    select: (...args: any[]) => mockSelectWorkspaceAgentReadySession(...args),
    effect: function* (...args: any[]) { return mockSelectWorkspaceAgentReadySession(...args); },
  },
  selectIsInitialSpecWriteInProgress: {
    select: () => false,
    effect: function* () { return false; },
  },
}));

const mockSelectAgentMessages = vi.fn();
const mockSelectAgentSession = vi.fn();
vi.mock("../../agent-session/agent-session-selectors", () => ({
  selectAgentMessages: {
    select: (...args: any[]) => mockSelectAgentMessages(...args),
    effect: function* (...args: any[]) { return mockSelectAgentMessages(...args); },
  },
  selectAgentSession: {
    select: (...args: any[]) => mockSelectAgentSession(...args),
  },
}));

vi.mock("../../agent-session/agent-session-slice", () => ({
  upsertSession: Object.assign(
    (session: any) => ({
      type: "agentSessions/upsertSession",
      payload: [session],
    }),
    { type: "agentSessions/upsertSession", toString: () => "agentSessions/upsertSession" },
  ),
  replaceMessages: (agentId: any, messages: any) => ({
    type: "agentSessions/replaceMessages",
    payload: [agentId, messages],
  }),
}));

const mockSelectChatState = vi.fn();
vi.mock("../chat-state-selectors", () => ({
  selectChatStateOrDefault: {
    select: (...args: any[]) => mockSelectChatState(...args),
    effect: function* (...args: any[]) { return mockSelectChatState(...args); },
  },
}));

function getLatestDispatchedMessageIds(dispatched: any[]): string[] {
  const replaceMessagesActions = dispatched.filter(
    (a) => a.type === "agentSessions/replaceMessages",
  );
  if (replaceMessagesActions.length > 0) {
    const [, replacedMessages] = replaceMessagesActions[replaceMessagesActions.length - 1].payload;
    return replacedMessages.map((m: any) => m.id);
  }

  const upsertActions = dispatched.filter((a) => a.type === "agentSessions/upsertSession");
  expect(upsertActions.length).toBeGreaterThanOrEqual(1);
  const [upsertedSession] = upsertActions[upsertActions.length - 1].payload;
  return upsertedSession.messages.map((m: any) => m.id);
}

import {
  initializeChatRequested,
  sendInitialMessageRequested,
  chatSendStarted,
  chatSendFailed,
} from "../chat-state-slice";


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
    mockSelectAgentSession.mockReturnValue(undefined);
    mockSelectWorkspaceAgentReadySession.mockReturnValue(null);
    mockSendMessage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends initial message through saga after session is ready", async () => {
    const { initializeChatSaga } = await import("./initialize-chat-saga");
    const session = {
      id: "agent-1",
      workspaceId: "ws-1",
      name: "Test Agent",
      status: "idle",
      isStreaming: false,
      messages: [],
    };
    mockSelectAgentSession.mockReturnValue(session);
    mockSelectWorkspaceAgentReadySession.mockReturnValue(session);

    const dispatched: any[] = [];
    const channel = stdChannel();

    runSaga(
      {
        channel,
        dispatch: (action: any) => {
          dispatched.push(action);
          channel.put(action);
        },
        getState: () => ({}),
      },
      initializeChatSaga as any,
    );

    const storage = new Map<string, string>();
    storage.set("workspace:ws-1:agent-config", JSON.stringify({
      agentId: "agent-1",
      prompt: "Initial prompt",
      imageBlocks: [{ type: "image", data: "img", mimeType: "image/png" }],
      contextReferences: [{ type: "file", path: "src/file.ts" }],
    }));
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });

    channel.put(sendInitialMessageRequested("agent-1", { wsId: "ws-1" }));

    await vi.dynamicImportSettled();
    await new Promise((r) => setTimeout(r, 50));

    expect(dispatched.some((a) => a.type === chatSendStarted.type)).toBe(true);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage.mock.calls[0][0]).toBe("Initial prompt");
    expect(mockSendMessage.mock.calls[0][2]).toBe("agent-1");
    expect(mockSendMessage.mock.calls[0][3]).toMatchObject({
      agentId: "agent-1",
      contextReferences: [{ type: "file", path: "src/file.ts" }],
    });
    expect(mockSendMessage.mock.calls[0][3].contextItems[0]).toMatchObject({
      imageData: "img",
      imageMimeType: "image/png",
    });
    expect(storage.has("workspace:ws-1:agent-config")).toBe(false);
  });

  it("fails initial message request when session readiness times out", async () => {
    vi.useFakeTimers();
    try {
      const { initializeChatSaga } = await import("./initialize-chat-saga");
      mockSelectAgentSession.mockReturnValue(undefined);

      const dispatched: any[] = [];
      const channel = stdChannel();

      runSaga(
        {
          channel,
          dispatch: (action: any) => {
            dispatched.push(action);
            channel.put(action);
          },
          context: {
            readableStoreState: {
              subscribe: (run: (state: any) => void) => {
                run({ storeUtility: { updatesLocked: false } });
                return () => {};
              },
            },
          },
          getState: () => ({ storeUtility: { updatesLocked: false } }),
        },
        initializeChatSaga as any,
      );

      channel.put(sendInitialMessageRequested("agent-1", {
        wsId: "ws-1",
        message: "Initial prompt",
      }));

      await vi.advanceTimersByTimeAsync(5000);

      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(dispatched.some((a) => a.type === chatSendFailed.type)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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

    const messageIds = getLatestDispatchedMessageIds(dispatched);

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

    const messageIds = getLatestDispatchedMessageIds(dispatched);
    expect(messageIds).toContain("msg-1");
  });
});