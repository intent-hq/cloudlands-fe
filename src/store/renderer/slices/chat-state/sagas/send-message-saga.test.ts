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

// Mock send trigger — MessageGuardError must be a real class so name-based guard works
class MockMessageGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MessageGuardError';
  }
}
const mockSendMessage = vi.fn().mockResolvedValue(undefined);
const mockStopChat = vi.fn().mockResolvedValue(undefined);

vi.mock("$store/renderer/slices/agent-session/agent-session-slice", () => {
  const agentSessionSendMessageRequested = vi.fn(
    (agentId: string, wsId: string, text: string, options: unknown) => ({
      type: "agentSessions/sendMessageRequested",
      asyncActionType: "agentSessions/sendMessage",
      payload: [agentId, wsId, text, options],
      promise: Promise.resolve().then(() => mockSendMessage(agentId, wsId, text, options)),
      success: vi.fn((response: unknown) => ({
        type: "agentSessions/sendMessageRequested_SUCCESS",
        payload: { request: [agentId, wsId, text, options], response },
      })),
      failure: vi.fn((error: string) => ({
        type: "agentSessions/sendMessageRequested_FAILURE",
        payload: { request: [agentId, wsId, text, options], error },
      })),
    }),
  );
  const agentSessionStopChatRequested = vi.fn((agentId: string) => ({
    type: "agentSessions/stopChatRequested",
    asyncActionType: "agentSessions/stopChat",
    payload: [agentId],
    promise: Promise.resolve().then(() => mockStopChat(agentId)),
    success: vi.fn((response: unknown) => ({
      type: "agentSessions/stopChatRequested_SUCCESS",
      payload: { request: [agentId], response },
    })),
    failure: vi.fn((error: string) => ({
      type: "agentSessions/stopChatRequested_FAILURE",
      payload: { request: [agentId], error },
    })),
  }));
  agentSessionSendMessageRequested.type = "agentSessions/sendMessageRequested";
  agentSessionSendMessageRequested.toString = () => "agentSessions/sendMessageRequested";
  agentSessionStopChatRequested.type = "agentSessions/stopChatRequested";
  agentSessionStopChatRequested.toString = () => "agentSessions/stopChatRequested";
  return { agentSessionSendMessageRequested, agentSessionStopChatRequested };
});

// Mock consolidated backend service
const mockQueueMessage = vi.fn().mockResolvedValue({ success: true });
const mockRemoveQueuedMessage = vi.fn().mockResolvedValue({ success: true });
vi.mock("$features/agent/services/consolidated-backend.service", () => ({
  unifiedOrchestrator: {
    queueMessage: mockQueueMessage,
    removeQueuedMessage: mockRemoveQueuedMessage,
  },
}));

// Mock package waitFor utility
const mockWaitForResult = vi.fn<() => boolean>().mockReturnValue(true);
vi.mock("ag-redux-toolkit/saga", () => ({
  waitFor: function* () {
    return mockWaitForResult();
  },
}));

// Mock selector-channel-effects (prevents readableStoreState issues)
vi.mock("ag-redux-toolkit/utils/sagas/selector-channel-effects", () => ({
  createChannelFromSelector: vi.fn(),
}));

// Hoisted mock fns — vi.hoisted runs before vi.mock factories
const {
  mockSelectAgentById,
  mockSelectAgentIsResponding,
  mockSelectWorkspaceById,
  mockSelectChatIsRebinding,
  mockSelectChatLastMessageTime,
  mockSelectChatTrackedWorkspaceId,
  mockSelectPendingCount,
} = vi.hoisted(() => ({
  mockSelectAgentById: vi.fn(),
  mockSelectAgentIsResponding: vi.fn().mockReturnValue(false),
  mockSelectWorkspaceById: vi.fn(),
  mockSelectChatIsRebinding: vi.fn().mockReturnValue(false),
  mockSelectChatLastMessageTime: vi.fn().mockReturnValue(0),
  mockSelectChatTrackedWorkspaceId: vi.fn().mockReturnValue(null),
  mockSelectPendingCount: vi.fn().mockReturnValue(0),
}));

// Import hoisted so it's available in vi.mock factories
const { hoistedSagaEffects } = vi.hoisted(() => {

  const effects = require("redux-saga/effects") as typeof sagaEffects;
  return { hoistedSagaEffects: effects };
});

vi.mock("../../workspace-agents/workspace-agents-selectors", () => ({
  selectAgentSession: {
    select: (...args: any[]) => mockSelectAgentById(...args),
    effect: function* (...args: any[]) {
      return yield hoistedSagaEffects.select(mockSelectAgentById, ...args);
    },
  },
}));

vi.mock("../../agent-session/agent-session-selectors", () => ({
  selectAgentSession: {
    select: (...args: any[]) => mockSelectAgentById(...args),
    effect: function* (...args: any[]) {
      return yield hoistedSagaEffects.select(mockSelectAgentById, ...args);
    },
  },
  selectAgentIsResponding: {
    select: (_state: unknown, agentId: string) => mockSelectAgentIsResponding(agentId),
    effect: function* (agentId: string) {
      return yield hoistedSagaEffects.select(
        (_state: unknown, id: string) => mockSelectAgentIsResponding(id),
        agentId,
      );
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
  selectChatLastMessageTime: {
    select: (...args: any[]) => mockSelectChatLastMessageTime(...args),
    effect: function* (...args: any[]) {
      return yield hoistedSagaEffects.select(mockSelectChatLastMessageTime, ...args);
    },
  },
  selectChatTrackedWorkspaceId: {
    select: (...args: any[]) => mockSelectChatTrackedWorkspaceId(...args),
    effect: function* (...args: any[]) {
      return yield hoistedSagaEffects.select(mockSelectChatTrackedWorkspaceId, ...args);
    },
  },
}));

vi.mock("../../permission/permission-selectors", () => ({
  selectPendingCount: {
    select: (...args: any[]) => mockSelectPendingCount(...args),
    effect: function* (...args: any[]) {
      return yield hoistedSagaEffects.select(mockSelectPendingCount, ...args);
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
import {
  removeQueuedMessageFromAgentQueue,
  setAgentQueueError,
} from "../../agent-queue/agent-queue-slice";


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
    mockSelectAgentIsResponding.mockReturnValue(false);
    // Default: workspace exists
    mockSelectWorkspaceById.mockReturnValue(MOCK_WORKSPACE);
    // Default: not rebinding
    mockSelectChatIsRebinding.mockReturnValue(false);
    // Default: no previous accepted send for rate limiting
    mockSelectChatLastMessageTime.mockReturnValue(0);
    // Default: no tracked workspace (no workspace change)
    mockSelectChatTrackedWorkspaceId.mockReturnValue(null);
    // Default: no pending permission/user-action wait
    mockSelectPendingCount.mockReturnValue(0);
    // Default: waitFor succeeds
    mockWaitForResult.mockReturnValue(true);
    // Default: sendMessage succeeds
    mockSendMessage.mockResolvedValue(undefined);
    // Default: stopChat succeeds
    mockStopChat.mockResolvedValue(undefined);
    // Default: queueMessage succeeds
    mockQueueMessage.mockResolvedValue({ success: true });
    // Default: removeQueuedMessage succeeds
    mockRemoveQueuedMessage.mockResolvedValue({ success: true });
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
    it("dispatches chatSendStarted before the agent-session send trigger", async () => {
      const { dispatched } = await runSendMessageSaga();

      const sendStartedIdx = dispatched.findIndex(
        (a) => a.type === chatSendStarted.type,
      );
      const sendRequestedIdx = dispatched.findIndex(
        (a) => a.type === "agentSessions/sendMessageRequested",
      );
      expect(sendStartedIdx).toBeGreaterThanOrEqual(0);
      expect(sendRequestedIdx).toBeGreaterThan(sendStartedIdx);
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
  // Test 3: Error path — core send handler owns send failure state
  // ========================================================================
  describe("agent-session failure side effects are not duplicated", () => {
    it("does not dispatch chatSendFailed locally when the core send action rejects", async () => {
      mockSelectWorkspaceById.mockReturnValue(null);
      mockSendMessage.mockRejectedValue(new Error("Workspace not found. Please try again."));

      const { dispatched } = await runSendMessageSaga();
      await vi.advanceTimersByTimeAsync(0);

      const sendStartedAction = dispatched.find(
        (a) => a.type === chatSendStarted.type,
      );
      const sendFailedAction = dispatched.find(
        (a) => a.type === chatSendFailed.type,
      );

      expect(sendStartedAction).toBeDefined();
      expect(sendFailedAction).toBeUndefined();
    });
  });

  // ========================================================================
  // Test 4: Error path — agent-session send trigger failures are centralized
  // ========================================================================
  describe("agent-session send trigger throws", () => {
    it("does not duplicate chatSendFailed when sendMessage throws", async () => {
      mockSendMessage.mockRejectedValue(new Error("Network failure"));

      const { dispatched } = await runSendMessageSaga();
      // Allow microtask for the rejection to propagate
      await vi.advanceTimersByTimeAsync(0);

      const sendFailedAction = dispatched.find(
        (a) => a.type === chatSendFailed.type,
      );
      expect(sendFailedAction).toBeUndefined();
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
      mockSelectAgentIsResponding.mockReturnValue(true);

      const { dispatched } = await runSendMessageSaga();

      expect(mockSelectAgentIsResponding).toHaveBeenCalledWith(AGENT_ID);

      const sendStartedAction = dispatched.find(
        (a) => a.type === chatSendStarted.type,
      );
      expect(sendStartedAction).toBeUndefined();
      expect(mockQueueMessage).toHaveBeenCalledWith(
        AGENT_ID,
        'Hello world',
        [],
        undefined,
        WS_ID,
      );
    });

    it("takes queue path when agent is processing and does not dispatch chatSendStarted", async () => {
      mockSelectAgentIsResponding.mockReturnValue(true);

      const { dispatched } = await runSendMessageSaga();

      expect(mockSelectAgentIsResponding).toHaveBeenCalledWith(AGENT_ID);

      const sendStartedAction = dispatched.find(
        (a) => a.type === chatSendStarted.type,
      );
      expect(sendStartedAction).toBeUndefined();
    });

    it("sends directly for a stopped end_turn agent even when local processing flags are stale", async () => {
      mockSelectAgentById.mockReturnValue({
        id: AGENT_ID,
        status: "idle",
        activationState: null,
        isActive: false,
        isStreaming: false,
        isProcessing: true,
        isResponding: true,
        stopReason: "end_turn",
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            contentBlocks: [{ type: "text", text: "Done" }],
            timestamp: new Date().toISOString(),
            metadata: { stopReason: "end_turn" },
          },
        ],
      });

      const { dispatched } = await runSendMessageSaga();

      expect(mockQueueMessage).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(dispatched.find((a) => a.type === chatSendStarted.type)).toBeDefined();
    });

    it("continues queueing when canonical status still says the agent is responding", async () => {
      mockSelectAgentIsResponding.mockReturnValue(true);
      mockSelectAgentById.mockReturnValue({
        id: AGENT_ID,
        status: "responding",
        activationState: "active",
        isActive: true,
        isStreaming: false,
        isProcessing: true,
        isResponding: true,
        stopReason: "end_turn",
      });

      const { dispatched } = await runSendMessageSaga();

      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockQueueMessage).toHaveBeenCalledTimes(1);
      expect(dispatched.find((a) => a.type === chatSendStarted.type)).toBeUndefined();
    });

    it("sends directly when processing is a pending user-action wait", async () => {
      mockSelectAgentById.mockReturnValue({
        id: AGENT_ID,
        isStreaming: false,
        isProcessing: true,
      });
      mockSelectPendingCount.mockReturnValue(1);

      const { dispatched } = await runSendMessageSaga();

      expect(mockQueueMessage).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(dispatched.find((a) => a.type === chatSendStarted.type)).toBeDefined();
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

      // Agent-session send trigger should have been called exactly once (queued path uses queueMessage)
      expect(mockSendMessage).toHaveBeenCalledTimes(1);

      // The queueing info log should have been emitted
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        "Send already in flight, queueing message",
        expect.objectContaining({ agentId: AGENT_ID }),
      );

      // The queued message should have been routed to queueMessage
      expect(mockQueueMessage).toHaveBeenCalled();
      expect(mockQueueMessage).toHaveBeenCalledWith(
        AGENT_ID,
        'Second message',
        [],
        undefined,
        WS_ID,
      );

      // Resolve the pending send to clean up
      resolveSend();
      await vi.advanceTimersByTimeAsync(0);
    });

    it("bypasses a stale active send guard when the latest assistant turn ended", async () => {
      let resolveFirst!: () => void;
      let sendCalls = 0;
      mockSendMessage.mockImplementation(() => {
        sendCalls += 1;
        if (sendCalls === 1) {
          return new Promise<void>((resolve) => { resolveFirst = resolve; });
        }
        return Promise.resolve();
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

      channel.put(makeSendAction({ text: "First message" }));
      await vi.advanceTimersByTimeAsync(0);

      mockSelectAgentById.mockReturnValue({
        id: AGENT_ID,
        status: "idle",
        activationState: null,
        isActive: false,
        isStreaming: false,
        isProcessing: true,
        isResponding: true,
        stopReason: "end_turn",
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            contentBlocks: [{ type: "text", text: "Done" }],
            timestamp: new Date().toISOString(),
            metadata: { stopReason: "end_turn" },
          },
        ],
      });

      channel.put(makeSendAction({ text: "Follow-up message" }));
      await vi.advanceTimersByTimeAsync(0);

      expect(mockSendMessage).toHaveBeenCalledTimes(2);
      expect(mockQueueMessage).not.toHaveBeenCalled();
      expect(dispatched.filter((a) => a.type === chatSendStarted.type)).toHaveLength(2);
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        "Bypassing stale active send guard for ready agent",
        expect.objectContaining({
          agentId: AGENT_ID,
          isStoppedTurnReadyForInput: true,
        }),
      );

      resolveFirst();
      await vi.advanceTimersByTimeAsync(0);
    });

    it("bypasses the active send guard when a pending user-action wait expects input", async () => {
      let resolveFirst!: () => void;
      let sendCalls = 0;
      mockSendMessage.mockImplementation(() => {
        sendCalls += 1;
        if (sendCalls === 1) {
          return new Promise<void>((resolve) => { resolveFirst = resolve; });
        }
        return Promise.resolve();
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

      channel.put(makeSendAction({ text: "First message" }));
      await vi.advanceTimersByTimeAsync(0);

      mockSelectAgentById.mockReturnValue({
        id: AGENT_ID,
        isStreaming: true,
        isProcessing: true,
      });
      mockSelectPendingCount.mockReturnValue(1);

      channel.put(makeSendAction({ text: "Unblock waiting agent" }));
      await vi.advanceTimersByTimeAsync(0);

      expect(mockSendMessage).toHaveBeenCalledTimes(2);
      expect(mockQueueMessage).not.toHaveBeenCalled();
      expect(dispatched.filter((a) => a.type === chatSendStarted.type)).toHaveLength(2);
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        "Bypassing stale active send guard for ready agent",
        expect.objectContaining({ agentId: AGENT_ID, isUserActionWait: true }),
      );

      resolveFirst();
      await vi.advanceTimersByTimeAsync(0);
    });

    it("lets skipQueueCheck bypass the active send guard", async () => {
      let resolveFirst!: () => void;
      let sendCalls = 0;
      mockSendMessage.mockImplementation(() => {
        sendCalls += 1;
        if (sendCalls === 1) {
          return new Promise<void>((resolve) => { resolveFirst = resolve; });
        }
        return Promise.resolve();
      });

      const { watchSendMessage } = await import("./send-message-saga");

      const channel = stdChannel();
      runSaga(
        {
          channel,
          dispatch: (action: any) => channel.put(action),
          getState: () => ({}),
        },
        watchSendMessage,
      );

      channel.put(makeSendAction({ text: "First message" }));
      await vi.advanceTimersByTimeAsync(0);

      mockSelectAgentById.mockReturnValue({
        id: AGENT_ID,
        isStreaming: true,
        isProcessing: true,
      });

      channel.put(makeSendAction({ text: "Send now", skipQueueCheck: true }));
      await vi.advanceTimersByTimeAsync(0);

      expect(mockSendMessage).toHaveBeenCalledTimes(2);
      expect(mockQueueMessage).not.toHaveBeenCalled();

      resolveFirst();
      await vi.advanceTimersByTimeAsync(0);
    });
  });

  // ========================================================================
  // Test 8: Happy path dispatches chatSendStarted then completes
  // ========================================================================
  describe("happy path", () => {
    it("dispatches chatSendStarted, calls agent-session send trigger, dispatches clearChatDraft", async () => {
      const { dispatched } = await runSendMessageSaga();

      // chatSendStarted dispatched
      const sendStartedAction = dispatched.find(
        (a) => a.type === chatSendStarted.type,
      );
      expect(sendStartedAction).toBeDefined();

      // Agent-session send trigger was called
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
  // Test 9: Redux-owned rate limiting
  // ========================================================================
  describe("Redux-owned rate limiting", () => {
    it("blocks rapid duplicate sends using lastMessageTime from chat-state", async () => {
      vi.setSystemTime(new Date(1_000));
      mockSelectChatLastMessageTime.mockReturnValue(950);

      const { dispatched } = await runSendMessageSaga();

      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(dispatched.find((a) => a.type === chatSendStarted.type)).toBeUndefined();
      const sendFailed = dispatched.find((a) => a.type === chatSendFailed.type);
      expect(sendFailed).toBeDefined();
      expect(sendFailed.payload[1]).toBe('');
    });

    it("allows sends once the minimum interval has elapsed", async () => {
      vi.setSystemTime(new Date(1_101));
      mockSelectChatLastMessageTime.mockReturnValue(1_000);

      const { dispatched } = await runSendMessageSaga();

      expect(dispatched.find((a) => a.type === chatSendStarted.type)).toBeDefined();
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(dispatched.find((a) => a.type === chatSendFailed.type)).toBeUndefined();
    });
  });

  // ========================================================================
  // Test 10: MessageGuardError side effects live in the core send handler
  // ========================================================================
  describe("MessageGuardError handling (idempotency fix)", () => {
    it("does not duplicate chatSendFailed when sendMessage throws MessageGuardError", async () => {
      // Simulate the idempotency guard throwing
      mockSendMessage.mockRejectedValue(
        new MockMessageGuardError("Duplicate message detected"),
      );

      const { dispatched } = await runSendMessageSaga();
      await vi.advanceTimersByTimeAsync(0);

      // chatSendStarted should have been dispatched (before sendMessage)
      const sendStarted = dispatched.find(
        (a) => a.type === chatSendStarted.type,
      );
      expect(sendStarted).toBeDefined();

      const sendFailed = dispatched.find(
        (a) => a.type === chatSendFailed.type,
      );
      expect(sendFailed).toBeUndefined();
    });

    it("leaves real and guard send failures to the core send handler", async () => {
      mockSendMessage.mockRejectedValue(new Error("Network failure"));
      const { dispatched: d1 } = await runSendMessageSaga();
      await vi.advanceTimersByTimeAsync(0);
      const realFailed = d1.find((a) => a.type === chatSendFailed.type);
      expect(realFailed).toBeUndefined();

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
      expect(guardFailed).toBeUndefined();
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
      mockSelectAgentIsResponding.mockReturnValue(true);

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
      mockSelectAgentIsResponding.mockReturnValue(true);

      const { dispatched } = await runSendMessageSaga({ skipQueueCheck: true });

      // Should take the send path: chatSendStarted dispatched
      const sendStartedAction = dispatched.find(
        (a) => a.type === chatSendStarted.type,
      );
      expect(sendStartedAction).toBeDefined();

      // Should NOT have queued the message
      expect(mockQueueMessage).not.toHaveBeenCalled();

      // Agent-session send trigger should have been called (send path)
      expect(mockSendMessage).toHaveBeenCalled();
    });

    it("forceSubmit stops the active response before sending", async () => {
      mockSelectAgentIsResponding.mockReturnValue(true);

      const { dispatched } = await runSendMessageSaga({
        skipQueueCheck: true,
        forceSubmit: true,
      });
      await vi.advanceTimersByTimeAsync(0);

      const stopIdx = dispatched.findIndex((a) => a.type === "agentSessions/stopChatRequested");
      const sendStartedIdx = dispatched.findIndex((a) => a.type === chatSendStarted.type);
      expect(stopIdx).toBeGreaterThanOrEqual(0);
      expect(sendStartedIdx).toBeGreaterThan(stopIdx);
      expect(mockStopChat).toHaveBeenCalledWith(AGENT_ID);
      expect(mockSendMessage).toHaveBeenCalled();
    });
  });

  describe("send now with image blocks (regression)", () => {
    it("serializes raw context item files before dispatching agent-session send", async () => {
      const OriginalFileReader = globalThis.FileReader;
      (globalThis as any).FileReader = class {
        result = "data:image/png;base64,abc123";
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        readAsDataURL() {
          this.onload?.();
        }
      };

      try {
        await runSendMessageSaga({
          serializedContextItems: undefined,
          contextItems: [
            {
              id: "upload-1",
              type: "file",
              label: "upload.png",
              file: { type: "image/png" } as File,
            },
          ],
        });

        const options = mockSendMessage.mock.calls[0][3];
        expect(options.contextItems).toEqual([
          {
            id: "upload-1",
            type: "file",
            label: "upload.png",
            imageData: "abc123",
            imageMimeType: "image/png",
          },
        ]);
      } finally {
        (globalThis as any).FileReader = OriginalFileReader;
      }
    });

    it("removes a queued message in the saga before replaying it", async () => {
      const { dispatched } = await runSendMessageSaga({
        queuedMessageId: "queued-1",
        skipQueueCheck: true,
      });

      expect(mockRemoveQueuedMessage).toHaveBeenCalledWith(AGENT_ID, "queued-1");
      const removeIdx = dispatched.findIndex(
        (a) => a.type === removeQueuedMessageFromAgentQueue.type,
      );
      const sendStartedIdx = dispatched.findIndex((a) => a.type === chatSendStarted.type);
      expect(dispatched[removeIdx]).toEqual(
        removeQueuedMessageFromAgentQueue(AGENT_ID, "queued-1"),
      );
      expect(sendStartedIdx).toBeGreaterThan(removeIdx);
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
    });

    it("does not replay a queued message when saga-owned queue removal fails", async () => {
      mockRemoveQueuedMessage.mockResolvedValueOnce({ success: false, error: "remove failed" });

      const { dispatched } = await runSendMessageSaga({
        queuedMessageId: "queued-1",
        skipQueueCheck: true,
      });

      expect(mockRemoveQueuedMessage).toHaveBeenCalledWith(AGENT_ID, "queued-1");
      expect(dispatched).toContainEqual(setAgentQueueError(AGENT_ID, "remove failed"));
      expect(dispatched.find((a) => a.type === removeQueuedMessageFromAgentQueue.type)).toBeUndefined();
      expect(dispatched.find((a) => a.type === chatSendStarted.type)).toBeUndefined();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it("forwards imageBlocks as contextItems when sending a queued message via skipQueueCheck", async () => {
      const imageBlocks = [
        { type: "image" as const, data: "base64data1", mimeType: "image/png" },
        { type: "image" as const, data: "base64data2", mimeType: "image/jpeg" },
      ];

      await runSendMessageSaga({
        skipQueueCheck: true,
        imageBlocks,
      });

      // Agent-session send trigger should have been called with image data in contextItems
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

    it("image-only send: inline image context items never carry file/fileData to the core send effect (no stray file pill)", async () => {
      // Repro for the "stray File pill on image-only send" bug. An inline image
      // extracted from the TipTap editor is represented as a context item with
      // { type: 'file', imageData, imageMimeType } and MUST NOT carry a File
      // object or fileData — otherwise the core send effect would classify it as a
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
      // Must NOT have any of the fields that would cause the core send effect to
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
