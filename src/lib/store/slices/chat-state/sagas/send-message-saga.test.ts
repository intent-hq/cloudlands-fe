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

// Hoisted logger mocks so tests can assert on logger calls
const { mockLoggerWarn, mockLoggerInfo } = vi.hoisted(() => ({
  mockLoggerWarn: vi.fn(),
  mockLoggerInfo: vi.fn(),
}));

// Mock client logger
vi.mock("$lib/utils/client-logger", () => ({
  createLogger: () => ({
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock svelte-sonner
vi.mock("svelte-sonner", () => ({
  toast: { error: vi.fn() },
}));

// Mock cleanErrorMessage to pass through
vi.mock("$shared/errors/messages", () => ({
  cleanErrorMessage: (msg: string) => msg,
}));

// Mock chat service — MessageGuardError must be a real class so instanceof works
class MockMessageGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MessageGuardError';
  }
}
const mockSendMessage = vi.fn().mockResolvedValue(undefined);
vi.mock("$features/agent/services/chat.service", () => ({
  getChatService: vi.fn(() => ({
    sendMessage: mockSendMessage,
  })),
  MessageGuardError: MockMessageGuardError,
}));

// Mock consolidated backend service
const mockQueueMessage = vi.fn().mockResolvedValue({ success: true });
vi.mock("$features/agent/services/consolidated-backend.service", () => ({
  unifiedOrchestrator: {
    queueMessage: mockQueueMessage,
  },
}));

// Mock waitFor utility
const mockWaitForResult = vi.fn<() => boolean>().mockReturnValue(true);
vi.mock("$lib/store/slices/store-utility/sagas/waitFor", () => ({
  waitFor: function* () {
    return mockWaitForResult();
  },
}));

// Mock selector-channel-effects (prevents readableStoreState issues)
vi.mock("$lib/store/utils/selector-channel-effects", () => ({
  createChannelFromSelector: vi.fn(),
}));

// Hoisted mock fns — vi.hoisted runs before vi.mock factories
const {
  mockSelectAgentById,
  mockSelectWorkspaceById,
  mockSelectChatIsRebinding,
  mockSelectChatTrackedWorkspaceId,
} = vi.hoisted(() => ({
  mockSelectAgentById: vi.fn(),
  mockSelectWorkspaceById: vi.fn(),
  mockSelectChatIsRebinding: vi.fn().mockReturnValue(false),
  mockSelectChatTrackedWorkspaceId: vi.fn().mockReturnValue(null),
}));

// Import hoisted so it's available in vi.mock factories
const { hoistedSagaEffects } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const effects = require("redux-saga/effects") as typeof sagaEffects;
  return { hoistedSagaEffects: effects };
});

vi.mock("../../workspace-agents/workspace-agents-selectors", () => ({
  selectAgentById: {
    select: (...args: any[]) => mockSelectAgentById(...args),
    effect: function* (...args: any[]) {
      return yield hoistedSagaEffects.select(mockSelectAgentById, ...args);
    },
  },
}));

vi.mock("../../workspace/workspace-selectors", () => ({
  selectWorkspaceById: {
    select: (...args: any[]) => mockSelectWorkspaceById(...args),
    effect: function* (...args: any[]) {
      return yield hoistedSagaEffects.select(mockSelectWorkspaceById, ...args);
    },
  },
}));

vi.mock("../chat-state-selectors", () => ({
  selectChatIsRebinding: {
    select: (...args: any[]) => mockSelectChatIsRebinding(...args),
    effect: function* (...args: any[]) {
      return yield hoistedSagaEffects.select(mockSelectChatIsRebinding, ...args);
    },
  },
  selectChatTrackedWorkspaceId: {
    select: (...args: any[]) => mockSelectChatTrackedWorkspaceId(...args),
    effect: function* (...args: any[]) {
      return yield hoistedSagaEffects.select(mockSelectChatTrackedWorkspaceId, ...args);
    },
  },
}));

// Mock transient-ui and multi-panel-context slices
vi.mock("../../transient-ui/transient-ui-slice", () => ({
  clearChatDraft: (...args: any[]) => ({
    type: "transientUi/clearChatDraft",
    payload: args,
  }),
}));

vi.mock("../../multi-panel-context/multi-panel-context-slice", () => ({
  uncheckAllSelections: () => ({
    type: "multiPanelContext/uncheckAllSelections",
  }),
}));

// Import actions after mocks
import {
  sendMessage,
  chatSendStarted,
  chatSendFailed,
} from "../chat-state-slice";


// ============================================================================
// Test constants and helpers
// ============================================================================

const AGENT_ID = "agent-test-1";
const WS_ID = "ws-test-1";

function makePayload(overrides: Record<string, any> = {}) {
  return {
    text: "Hello world",
    wsId: WS_ID,
    serializedContextItems: [],
    ...overrides,
  };
}

function makeSendAction(overrides: Record<string, any> = {}) {
  return sendMessage(AGENT_ID, makePayload(overrides) as any);
}

const MOCK_WORKSPACE = {
  id: WS_ID,
  name: "Test Workspace",
  path: "/test/path",
};

// ============================================================================
// Tests
// ============================================================================

describe("send-message-saga", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Default: agent is not streaming/processing
    mockSelectAgentById.mockReturnValue(undefined);
    // Default: workspace exists
    mockSelectWorkspaceById.mockReturnValue(MOCK_WORKSPACE);
    // Default: not rebinding
    mockSelectChatIsRebinding.mockReturnValue(false);
    // Default: no tracked workspace (no workspace change)
    mockSelectChatTrackedWorkspaceId.mockReturnValue(null);
    // Default: waitFor succeeds
    mockWaitForResult.mockReturnValue(true);
    // Default: sendMessage succeeds
    mockSendMessage.mockResolvedValue(undefined);
    // Default: queueMessage succeeds
    mockQueueMessage.mockResolvedValue({ success: true });
  });

  afterEach(async () => {
    vi.useRealTimers();
    const { _resetActiveSendsForTest } = await import("./send-message-saga");
    _resetActiveSendsForTest();
  });

  // Helper to run the saga with a sendMessage action
  async function runSendMessageSaga(actionOverrides: Record<string, any> = {}) {
    const { watchSendMessage } = await import("./send-message-saga");

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
      watchSendMessage,
    );

    const action = makeSendAction(actionOverrides);
    channel.put(action);
    await vi.advanceTimersByTimeAsync(0);

    return { dispatched, channel };
  }

  // ========================================================================
  // Test 1: Immediate loading state (the regression)
  // ========================================================================
  describe("immediate loading state (regression)", () => {
    it("dispatches chatSendStarted before chatService.sendMessage is called", async () => {
      let sendStartedDispatched = false;
      mockSendMessage.mockImplementation(() => {
        // At the time sendMessage is called, chatSendStarted should already be dispatched
        expect(sendStartedDispatched).toBe(true);
        return Promise.resolve();
      });

      const { dispatched } = await runSendMessageSaga();

      // Verify chatSendStarted was dispatched
      const sendStartedIdx = dispatched.findIndex(
        (a) => a.type === chatSendStarted.type,
      );
      expect(sendStartedIdx).toBeGreaterThanOrEqual(0);
      sendStartedDispatched = dispatched
        .slice(0, dispatched.length)
        .some((a) => a.type === chatSendStarted.type);
    });

    it("dispatches chatSendStarted before clearChatDraft and uncheckAllSelections", async () => {
      const { dispatched } = await runSendMessageSaga();

      const sendStartedIdx = dispatched.findIndex(
        (a) => a.type === chatSendStarted.type,
      );
      const clearDraftIdx = dispatched.findIndex(
        (a) => a.type === "transientUi/clearChatDraft",
      );
      const uncheckIdx = dispatched.findIndex(
        (a) => a.type === "multiPanelContext/uncheckAllSelections",
      );

      expect(sendStartedIdx).toBeGreaterThanOrEqual(0);
      // clearChatDraft and uncheckAllSelections should come after chatSendStarted
      if (clearDraftIdx >= 0) {
        expect(sendStartedIdx).toBeLessThan(clearDraftIdx);
      }
      if (uncheckIdx >= 0) {
        expect(sendStartedIdx).toBeLessThan(uncheckIdx);
      }
    });
  });

  // ========================================================================
  // Test 2: Error path — rebind timeout resets loading state
  // ========================================================================
  describe("rebind timeout resets loading state", () => {
    it("dispatches chatSendFailed after chatSendStarted when rebind times out", async () => {
      mockSelectChatIsRebinding.mockReturnValue(true);
      mockWaitForResult.mockReturnValue(false); // timeout

      const { dispatched } = await runSendMessageSaga();

      const sendStartedIdx = dispatched.findIndex(
        (a) => a.type === chatSendStarted.type,
      );
      const sendFailedIdx = dispatched.findIndex(
        (a) => a.type === chatSendFailed.type,
      );

      expect(sendStartedIdx).toBeGreaterThanOrEqual(0);
      expect(sendFailedIdx).toBeGreaterThan(sendStartedIdx);
    });
  });

  // ========================================================================
  // Test 3: Error path — workspace not found resets loading state
  // ========================================================================
  describe("workspace not found resets loading state", () => {
    it("dispatches chatSendFailed when workspace is null", async () => {
      mockSelectWorkspaceById.mockReturnValue(null);

      const { dispatched } = await runSendMessageSaga();

      const sendStartedAction = dispatched.find(
        (a) => a.type === chatSendStarted.type,
      );
      const sendFailedAction = dispatched.find(
        (a) => a.type === chatSendFailed.type,
      );

      expect(sendStartedAction).toBeDefined();
      expect(sendFailedAction).toBeDefined();
    });
  });

  // ========================================================================
  // Test 4: Error path — chatService.sendMessage throws
  // ========================================================================
  describe("chatService.sendMessage throws resets loading state", () => {
    it("dispatches chatSendFailed when sendMessage throws", async () => {
      mockSendMessage.mockRejectedValue(new Error("Network failure"));

      const { dispatched } = await runSendMessageSaga();
      // Allow microtask for the rejection to propagate
      await vi.advanceTimersByTimeAsync(0);

      const sendFailedAction = dispatched.find(
        (a) => a.type === chatSendFailed.type,
      );
      expect(sendFailedAction).toBeDefined();
    });

    it("does NOT dispatch chatSendFailed for 'Agent interrupted' errors", async () => {
      mockSendMessage.mockRejectedValue(new Error("Agent interrupted"));

      const { dispatched } = await runSendMessageSaga();
      await vi.advanceTimersByTimeAsync(0);

      const sendFailedAction = dispatched.find(
        (a) => a.type === chatSendFailed.type,
      );
      expect(sendFailedAction).toBeUndefined();
    });
  });


  // ========================================================================
  // Test 5: Error path — workspace reinit failure resets loading state
  // ========================================================================
  describe("workspace reinit failure resets loading state", () => {
    it("dispatches chatSendFailed when workspace reinit fails", async () => {
      // Workspace has changed: tracked is "old-ws", current is WS_ID
      mockSelectChatTrackedWorkspaceId.mockReturnValue("old-ws");

      const { watchSendMessage } = await import("./send-message-saga");

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
        watchSendMessage,
      );

      const action = makeSendAction();
      channel.put(action);
      await vi.advanceTimersByTimeAsync(0);

      // The saga dispatches initializeChatRequested and then races for
      // chatInitialized vs chatInitFailed vs 30s timeout.
      // Simulate chatInitFailed arriving:
      const { chatInitFailed } = await import("../chat-state-slice");
      channel.put(chatInitFailed(AGENT_ID, "init error"));
      await vi.advanceTimersByTimeAsync(0);

      const sendStarted = dispatched.find(
        (a) => a.type === chatSendStarted.type,
      );
      const sendFailed = dispatched.find(
        (a) => a.type === chatSendFailed.type,
      );

      expect(sendStarted).toBeDefined();
      expect(sendFailed).toBeDefined();
    });

    it("dispatches chatSendFailed when workspace reinit times out", async () => {
      mockSelectChatTrackedWorkspaceId.mockReturnValue("old-ws");

      const { watchSendMessage } = await import("./send-message-saga");

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
        watchSendMessage,
      );

      const action = makeSendAction();
      channel.put(action);
      await vi.advanceTimersByTimeAsync(0);

      // Don't send any init response — let the 30s timeout hit
      await vi.advanceTimersByTimeAsync(31_000);

      const sendFailed = dispatched.find(
        (a) => a.type === chatSendFailed.type,
      );

      expect(sendFailed).toBeDefined();
    });
  });

  // ========================================================================
  // Test 6: Queue path does NOT dispatch chatSendStarted
  // ========================================================================
  describe("queue path does not dispatch chatSendStarted", () => {
    it("takes queue path when agent is streaming and does not dispatch chatSendStarted", async () => {
      mockSelectAgentById.mockReturnValue({
        id: AGENT_ID,
        isStreaming: true,
        isProcessing: false,
      });

      const { dispatched } = await runSendMessageSaga();

      const sendStartedAction = dispatched.find(
        (a) => a.type === chatSendStarted.type,
      );
      expect(sendStartedAction).toBeUndefined();
    });

    it("takes queue path when agent is processing and does not dispatch chatSendStarted", async () => {
      mockSelectAgentById.mockReturnValue({
        id: AGENT_ID,
        isStreaming: false,
        isProcessing: true,
      });

      const { dispatched } = await runSendMessageSaga();

      const sendStartedAction = dispatched.find(
        (a) => a.type === chatSendStarted.type,
      );
      expect(sendStartedAction).toBeUndefined();
    });
  });

  // ========================================================================
  // Test 7: Concurrent send guard queues duplicate sends
  // ========================================================================
  describe("concurrent send guard", () => {
    it("queues a second sendMessage for the same agent while the first is in-flight", async () => {
      // Make sendMessage hang so the first send stays in-flight
      let resolveSend!: () => void;
      mockSendMessage.mockImplementation(
        () => new Promise<void>((r) => { resolveSend = r; }),
      );

      const { watchSendMessage } = await import("./send-message-saga");

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
        watchSendMessage,
      );

      // Dispatch first sendMessage — it will reach mockSendMessage and hang
      channel.put(makeSendAction());
      await vi.advanceTimersByTimeAsync(0);

      // Dispatch second sendMessage for the same agent while first is in-flight
      channel.put(makeSendAction({ text: "Second message" }));
      await vi.advanceTimersByTimeAsync(0);

      // Only one chatSendStarted should have been dispatched (the queued path skips it)
      const sendStartedActions = dispatched.filter(
        (a) => a.type === chatSendStarted.type,
      );
      expect(sendStartedActions).toHaveLength(1);

      // chatService.sendMessage should have been called exactly once (queued path uses queueMessage)
      expect(mockSendMessage).toHaveBeenCalledTimes(1);

      // The queueing info log should have been emitted
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        "Send already in flight, queueing message",
        expect.objectContaining({ agentId: AGENT_ID }),
      );

      // The queued message should have been routed to queueMessage
      expect(mockQueueMessage).toHaveBeenCalled();

      // Resolve the pending send to clean up
      resolveSend();
      await vi.advanceTimersByTimeAsync(0);
    });
  });

  // ========================================================================
  // Test 8: Happy path dispatches chatSendStarted then completes
  // ========================================================================
  describe("happy path", () => {
    it("dispatches chatSendStarted, calls chatService.sendMessage, dispatches clearChatDraft", async () => {
      const { dispatched } = await runSendMessageSaga();

      // chatSendStarted dispatched
      const sendStartedAction = dispatched.find(
        (a) => a.type === chatSendStarted.type,
      );
      expect(sendStartedAction).toBeDefined();

      // chatService.sendMessage was called
      expect(mockSendMessage).toHaveBeenCalled();

      // clearChatDraft dispatched
      const clearDraftAction = dispatched.find(
        (a) => a.type === "transientUi/clearChatDraft",
      );
      expect(clearDraftAction).toBeDefined();

      // No chatSendFailed
      const sendFailedAction = dispatched.find(
        (a) => a.type === chatSendFailed.type,
      );
      expect(sendFailedAction).toBeUndefined();
    });
  });

  // ========================================================================
  // Test 9: MessageGuardError (rate limiter / idempotency) clears state silently
  // ========================================================================
  describe("MessageGuardError handling (rate limiter / idempotency fix)", () => {
    it("dispatches chatSendFailed without error toast when sendMessage throws MessageGuardError", async () => {
      // Simulate the rate limiter or idempotency guard throwing
      mockSendMessage.mockRejectedValue(
        new MockMessageGuardError("Message sent too quickly, please wait a moment"),
      );

      const { dispatched } = await runSendMessageSaga();
      await vi.advanceTimersByTimeAsync(0);

      // chatSendStarted should have been dispatched (before sendMessage)
      const sendStarted = dispatched.find(
        (a) => a.type === chatSendStarted.type,
      );
      expect(sendStarted).toBeDefined();

      // chatSendFailed should be dispatched to clear the streaming state
      const sendFailed = dispatched.find(
        (a) => a.type === chatSendFailed.type,
      );
      expect(sendFailed).toBeDefined();
      // The error string should be empty (no error banner shown)
      expect(sendFailed.payload[1]).toBe('');
    });

    it("does NOT show error toast for MessageGuardError (unlike real errors)", async () => {
      // Real error shows toast
      mockSendMessage.mockRejectedValue(new Error("Network failure"));
      const { dispatched: d1 } = await runSendMessageSaga();
      await vi.advanceTimersByTimeAsync(0);
      const realFailed = d1.find((a) => a.type === chatSendFailed.type);
      expect(realFailed).toBeDefined();
      expect(realFailed.payload[1]).toBe("Network failure"); // non-empty error

      vi.clearAllMocks();
      mockSelectWorkspaceById.mockReturnValue(MOCK_WORKSPACE);
      mockSelectChatIsRebinding.mockReturnValue(false);
      mockSelectChatTrackedWorkspaceId.mockReturnValue(null);

      // Guard error clears state silently
      mockSendMessage.mockRejectedValue(
        new MockMessageGuardError("Duplicate message detected"),
      );
      const { dispatched: d2 } = await runSendMessageSaga();
      await vi.advanceTimersByTimeAsync(0);
      const guardFailed = d2.find((a) => a.type === chatSendFailed.type);
      expect(guardFailed).toBeDefined();
      expect(guardFailed.payload[1]).toBe(''); // empty = no error banner
    });
  });

  // ========================================================================
  // Regression test: activeSends guard must NOT block queue-path messages
  // Root cause #6 — the activeSends Set was previously checked for ALL
  // messages, which meant the second and third queued messages were silently
  // dropped when the agent was streaming.
  // ========================================================================
  describe("activeSends guard does not block queue-path messages (root cause #6)", () => {
    it("allows multiple queue-path messages while agent is streaming", async () => {
      // Set agent as streaming so all messages take the queue path
      mockSelectAgentById.mockReturnValue({
        id: AGENT_ID,
        isStreaming: true,
        isProcessing: false,
      });

      const { watchSendMessage } = await import("./send-message-saga");

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
        watchSendMessage,
      );

      // Dispatch 3 sendMessage actions while agent is streaming
      channel.put(makeSendAction({ text: "Message 1" }));
      await vi.advanceTimersByTimeAsync(0);

      channel.put(makeSendAction({ text: "Message 2" }));
      await vi.advanceTimersByTimeAsync(0);

      channel.put(makeSendAction({ text: "Message 3" }));
      await vi.advanceTimersByTimeAsync(0);

      // All 3 should have called queueMessage — none should be dropped
      expect(mockQueueMessage).toHaveBeenCalledTimes(3);

      // No chatSendStarted should have been dispatched (queue path skips it)
      const sendStartedActions = dispatched.filter(
        (a) => a.type === chatSendStarted.type,
      );
      expect(sendStartedActions).toHaveLength(0);

      // No concurrent-send warning should have been logged
      expect(mockLoggerWarn).not.toHaveBeenCalledWith(
        "Dropping concurrent sendMessage — send already in flight",
        expect.anything(),
      );
    });
  });

  // ========================================================================
  // Regression test: skipQueueCheck forces the send path
  // Root cause #5 — the "Send now" action from the queue UI sets
  // skipQueueCheck=true to bypass the isStreaming/isProcessing check.
  // Without this flag, the message would be re-queued instead of sent.
  // ========================================================================
  describe("skipQueueCheck forces send path (root cause #5)", () => {
    it("skipQueueCheck forces send path even when agent is streaming", async () => {
      // Agent is streaming — normally this would trigger the queue path
      mockSelectAgentById.mockReturnValue({
        id: AGENT_ID,
        isStreaming: true,
        isProcessing: false,
      });

      const { dispatched } = await runSendMessageSaga({ skipQueueCheck: true });

      // Should take the send path: chatSendStarted dispatched
      const sendStartedAction = dispatched.find(
        (a) => a.type === chatSendStarted.type,
      );
      expect(sendStartedAction).toBeDefined();

      // Should NOT have queued the message
      expect(mockQueueMessage).not.toHaveBeenCalled();

      // chatService.sendMessage should have been called (send path)
      expect(mockSendMessage).toHaveBeenCalled();
    });
  });

  describe("send now with image blocks (regression)", () => {
    it("forwards imageBlocks as contextItems when sending a queued message via skipQueueCheck", async () => {
      const imageBlocks = [
        { type: "image" as const, data: "base64data1", mimeType: "image/png" },
        { type: "image" as const, data: "base64data2", mimeType: "image/jpeg" },
      ];

      await runSendMessageSaga({
        skipQueueCheck: true,
        imageBlocks,
      });

      // chatService.sendMessage should have been called with image data in contextItems
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const options = mockSendMessage.mock.calls[0][3];
      expect(options.contextItems).toBeDefined();
      expect(options.contextItems.length).toBe(2);
      expect(options.contextItems[0]).toMatchObject({
        imageData: "base64data1",
        imageMimeType: "image/png",
      });
      expect(options.contextItems[1]).toMatchObject({
        imageData: "base64data2",
        imageMimeType: "image/jpeg",
      });
    });

    it("passes serializedContextItems through unchanged when both it and imageBlocks are present (no image duplication)", async () => {
      // Normal ChatPanel send flow: serializedContextItems already contains the
      // image entry (with imageData/imageMimeType), and imageBlocks is the same
      // image re-extracted for the main process. The saga must NOT append a
      // reconstructed image — that would deliver the image twice to the agent.
      const imageItem = {
        id: "ctx-img-1",
        type: "file",
        label: "pasted.png",
        imageData: "base64data1",
        imageMimeType: "image/png",
      };
      const imageBlocks = [
        { type: "image" as const, data: "base64data1", mimeType: "image/png" },
      ];

      await runSendMessageSaga({
        serializedContextItems: [imageItem],
        imageBlocks,
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const options = mockSendMessage.mock.calls[0][3];
      expect(options.contextItems).toBeDefined();
      // Exactly one image — no duplication from imageBlocks
      expect(options.contextItems).toHaveLength(1);
      expect(options.contextItems[0]).toMatchObject({
        id: "ctx-img-1",
        imageData: "base64data1",
        imageMimeType: "image/png",
      });
    });

    it("image-only send: inline image context items never carry file/fileData to chatService (no stray file pill)", async () => {
      // Repro for the "stray File pill on image-only send" bug. An inline image
      // extracted from the TipTap editor is represented as a context item with
      // { type: 'file', imageData, imageMimeType } and MUST NOT carry a File
      // object or fileData — otherwise chat.service.ts would classify it as a
      // non-image file and emit a type:'file' content block that renders as a
      // "File" pill in the collapsed user message.
      const inlineImageItem = {
        id: "inline-image-0",
        type: "file",
        label: "pasted.png",
        description: "image/png",
        imageData: "base64data1",
        imageMimeType: "image/png",
      };
      const imageBlocks = [
        { type: "image" as const, data: "base64data1", mimeType: "image/png" },
      ];

      await runSendMessageSaga({
        serializedContextItems: [inlineImageItem],
        imageBlocks,
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const options = mockSendMessage.mock.calls[0][3];
      expect(options.contextItems).toHaveLength(1);
      const forwarded = options.contextItems[0];
      // Must have image data
      expect(forwarded.imageData).toBe("base64data1");
      expect(forwarded.imageMimeType).toBe("image/png");
      // Must NOT have any of the fields that would cause chat.service.ts to
      // emit a type:'file' content block for this image.
      expect(forwarded.file).toBeUndefined();
      expect(forwarded.fileData).toBeUndefined();
      expect(forwarded.fileMimeType).toBeUndefined();
    });

    it("passes serializedContextItems through unchanged even when it mixes a file and an image alongside imageBlocks", async () => {
      const fileItem = { id: "ctx-1", type: "file", label: "test.ts" };
      const imageItem = {
        id: "ctx-img-1",
        type: "file",
        label: "pasted.png",
        imageData: "imgdata",
        imageMimeType: "image/png",
      };
      const imageBlocks = [
        { type: "image" as const, data: "imgdata", mimeType: "image/png" },
      ];

      await runSendMessageSaga({
        serializedContextItems: [fileItem, imageItem],
        imageBlocks,
      });

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const options = mockSendMessage.mock.calls[0][3];
      expect(options.contextItems).toBeDefined();
      // The two original items, with no extra reconstructed image appended
      expect(options.contextItems).toHaveLength(2);
      expect(options.contextItems[0]).toMatchObject({ id: "ctx-1" });
      expect(options.contextItems[1]).toMatchObject({
        id: "ctx-img-1",
        imageData: "imgdata",
        imageMimeType: "image/png",
      });
    });
  });
});
