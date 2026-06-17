/**
 * Tests for watchQueueProcessingSaga retry and fallback behavior.
 *
 * Verifies:
 * 1. Session retry logic (3 attempts, 200ms apart)
 * 2. Uses session.workspaceId instead of selectActiveWorkspaceId
 * 3. Always sends agent:handler-ready even when session is missing
 * 4. Normal flow works with session present on first try
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  runSaga,
  stdChannel,
} from "redux-saga";
import * as sagaEffects from "redux-saga/effects";
import {
  AgentStatus,
  type AgentMessage,
  type AgentSession,
} from "$shared/types";

const {
  sendMock,
  saveSessionMock,
  deleteAgentMock,
  ensureStreamHandlerMock,
  invokeMock,
  clearKeysForAgentMock,
  toastWarningMock,
  toastDismissMock,
  storeDispatchMock,
  trackMock,
  eventCollectorTrackMock,
  selectState,
  streamingSessionsState,
  diskCountState,
  capturedElectronHandlers,
} = vi.hoisted(() => ({
  sendMock: vi.fn(),
  saveSessionMock: vi.fn(async () => {}),
  deleteAgentMock: vi.fn(async () => {}),
  ensureStreamHandlerMock: vi.fn(async () => ({ created: false })),
  invokeMock: vi.fn(async () => ({ success: true })),
  clearKeysForAgentMock: vi.fn(async () => {}),
  toastWarningMock: vi.fn(() => "toast-1"),
  toastDismissMock: vi.fn(),
  storeDispatchMock: vi.fn(),
  trackMock: vi.fn(),
  eventCollectorTrackMock: vi.fn(),
  selectState: { results: [] as any[], index: 0, useRealStore: false, realGetState: null as null | (() => any) },
  streamingSessionsState: { results: [] as any[] },
  diskCountState: { value: 0 },
  capturedElectronHandlers: {} as Record<string, GeneratorFunction>,
}));

// Mock window + electronAPI
vi.stubGlobal("window", {
  electronAPI: { send: sendMock },
  dispatchEvent: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
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

vi.mock("$features/agent/agent-stream-lifecycle", () => ({
  ensureStreamHandler: ensureStreamHandlerMock,
  isSendMessageSettingUpStream: vi.fn(async () => false),
  hasActiveStreamHandler: vi.fn(async () => false),
  clearPendingStreamRegistration: vi.fn(async () => {}),
}));

vi.mock("$features/agent/browser", () => ({
  agentIpcProxy: {
    deleteAgent: deleteAgentMock,
  },
  persistenceService: {
    loadSession: vi.fn(async () => null),
    saveSession: saveSessionMock,
  },
}));

vi.mock("$features/agent/browser/services/request-deduplicator.service", () => ({
  requestDeduplicator: {
    clearKeysForAgent: clearKeysForAgentMock,
  },
}));

vi.mock("$lib/electron-bridge", () => ({
  invoke: invokeMock,
}));

vi.mock("$store/renderer/store", () => ({
  store: {
    dispatch: storeDispatchMock,
  },
}));

vi.mock("svelte-sonner", () => ({
  toast: {
    warning: toastWarningMock,
    dismiss: toastDismissMock,
  },
}));

vi.mock("$lib/services/analytics", () => ({
  track: trackMock,
}));

vi.mock("$features/observability/event-collector-client", () => ({
  eventCollector: { track: eventCollectorTrackMock },
  AgentEventType: { SESSION_DELETED: "SESSION_DELETED" },
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
  const selectAgentSessionImpl = (_state: any, _agentId: string) => {
    const result = selectState.results[selectState.index] ?? undefined;
    selectState.index++;
    return result;
  };
  return {
    selectAgentSession: {
      select: selectAgentSessionImpl,
      effect: function* (agentId: string) {
        return yield sagaEffects.select(selectAgentSessionImpl, agentId);
      },
    },
    selectDiskMessageCount: {
      select: () => diskCountState.value,
      effect: function* () {
        return yield sagaEffects.select(() => diskCountState.value);
      },
    },
    selectRecentAgentCreatedEvent: {
      select: () => undefined,
      effect: function* () {
        return yield sagaEffects.select(() => undefined);
      },
    },
    selectRecentAgentCreatedEventsCount: {
      select: () => 0,
      effect: function* () {
        return yield sagaEffects.select(() => 0);
      },
    },
  };
});

vi.mock("../../agent-session/agent-session-selectors", () => {
  const readSession = (_state: any, agentId: string) => {
    if (selectState.useRealStore) {
      const realState = selectState.realGetState?.() ?? _state;
      return realState?.agentSessions?.byAgentId?.[agentId] ?? undefined;
    }
    const result = selectState.results[selectState.index] ?? undefined;
    selectState.index++;
    return result;
  };
  return {
  selectAgentSession: {
    select: (state: any, agentId: string) => readSession(state, agentId),
    effect: function* (agentId: string) {
      return yield sagaEffects.select((state: any) => readSession(state, agentId));
    },
  },
  selectAllStreamingAgents: {
    select: () => streamingSessionsState.results,
    effect: function* () {
      return yield sagaEffects.select(() => streamingSessionsState.results);
    },
  },
  };
});

vi.mock("../../chat-state/chat-state-selectors", () => {
  const readSuppressed = (state: any, agentId: string) =>
    state?.chatState?.byAgentId?.[agentId]?.idleReconcileSuppressed === true;
  return {
    selectChatIdleReconcileSuppressed: {
      select: (state: any, agentId: string) => readSuppressed(state, agentId),
      effect: function* (agentId: string) {
        return yield sagaEffects.select((state: any) => readSuppressed(state, agentId));
      },
    },
  };
});

vi.mock("../../workspace/workspace-selectors", () => {
  const selectActiveWorkspaceIdImpl = (state: any) => {
    // If state has workspace.activeWorkspaceId, use it; otherwise fallback
    return state?.workspace?.activeWorkspaceId ?? "active-ws-id";
  };
  return {
    selectActiveWorkspaceId: {
      select: selectActiveWorkspaceIdImpl,
      effect: function* () {
        return yield sagaEffects.select(selectActiveWorkspaceIdImpl);
      },
    },
  };
});

vi.mock("../../agent-session/agent-session-slice", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    addMessage: vi.fn((agentId: string, msg: any) => ({ type: "agentSessions/addMessage", payload: [agentId, msg] })),
    removeMessage: vi.fn((agentId: string, msgId: string) => ({ type: "agentSessions/removeMessage", payload: [agentId, msgId] })),
    replaceMessageById: vi.fn((agentId: string, oldId: string, newMsg: any) => ({ type: "agentSessions/replaceMessageById", payload: [agentId, oldId, newMsg] })),
  };
});

vi.mock("$store/renderer/utils/ipc-channel", () => ({
  takeEveryFromElectronChannel: vi.fn(function* (channelName: string, handler: GeneratorFunction) {
    capturedElectronHandlers[channelName] = handler;
  }),
  takeEveryFromWindowEvent: vi.fn(function* () {}),
}));

// Import after mocks
import {
  agentIpcSaga,
  handleAgentCreated,
  handleAgentIdle,
  handleCommitPendingAgentDeletionRequested,
  handleDeleteAgentSessionRequested,
  handleDeleteAgentWithUndoRequested,
  handleExistingSessionUpdate,
  handleFlushPendingAgentDeletionsRequested,
  handleQueueCancelled,
  handleQueueProcessing,
  handleRenameAgentSessionRequested,
  handleSaveAgentSessionRequested,
  handleStopAgentSessionRequested,
  handleUndoAgentDeletionRequested,
  watchAgentCreatedIpcSaga,
  watchAgentIdleSaga,
  watchBackendStreamReconnectSaga,
  watchBeforeUnloadSaga,
  watchPagehideSaga,
  watchPrepareHandlerSaga,
  watchQueueCancelledSaga,
  watchQueueProcessingSaga,
  watchStreamStartingSaga,
} from "./agent-ipc-saga";
import {
  agentSessionReducer,
  bulkUpsertSessions,
  setAgentStreaming,
  updateMessage,
  upsertSession,
} from "../../agent-session/agent-session-slice";
import {
  chatIdleReconcileSuppressionSet,
  chatSendStarted,
  chatStateReducer,
  streamCompleted,
} from "../../chat-state/chat-state-slice";
import { clearAgentUnread } from "../../unread-tracking/unread-tracking-slice";
import {
  commitPendingAgentDeletionRequested,
  backendStreamsReconnectResultReceived,
  deleteAgentSessionRequested,
  deleteAgentWithUndoRequested,
  flushPendingAgentDeletionsRequested,
  removeAgent,
  renameAgentSessionRequested,
  saveAgentSessionRequested,
  stopAgentSessionRequested,
  triggerStreamingSafetyCheck,
  triggerBackendStreamReconnect,
  undoAgentDeletionRequested,
} from "../workspace-agents-slice";
import {
  AGENT_BACKEND_CHANNELS,
  AGENT_CHANNELS,
} from "$shared/ipc/channels";

const makeQueueSession = (overrides: Partial<AgentSession> = {}): AgentSession => ({
  id: "agent-1",
  name: "Test Agent",
  workspaceId: "ws-agent-1",
  messages: [],
  isStreaming: false,
  ...overrides,
} as AgentSession);

const makeSession = makeQueueSession;

async function waitForDeleteWithUndoPending(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await Promise.resolve();
}

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
    expect(upsert?.payload?.[0].workspaceId).toBe("ws-blank");
    expect(upsert?.payload?.[0]).toMatchObject({
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

function captureWindowListeners() {
  const listeners: Record<string, (event?: any) => void> = {};
  (window as any).addEventListener = vi.fn((eventName: string, handler: (event?: any) => void) => {
    listeners[eventName] = handler;
  });
  (window as any).removeEventListener = vi.fn((eventName: string) => {
    delete listeners[eventName];
  });
  return listeners;
}

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
    const sendStartedAction = dispatched.find((a) => a.type === chatSendStarted.type);
    expect(sendStartedAction?.payload).toMatchObject({
      agentId: "agent-1",
      wsId: "ws-agent-1",
    });
    const streamingAction = dispatched.find((a) => a.type === setAgentStreaming.type);
    expect(streamingAction?.payload).toEqual(["agent-1", true]);
  });

  // Wave 10 (Cause 1): after starting the queued turn, the saga must arm the
  // idle-reconcile suppression marker so the prior turn's stale agent:idle does
  // not clear the freshly-started flags.
  it("arms idle-reconcile suppression after chatSendStarted", async () => {
    const session = makeSession();
    selectState.results = [session];

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleQueueProcessing,
      queueData,
    ).toPromise();

    const sendStartedIndex = dispatched.findIndex((a) => a.type === chatSendStarted.type);
    const suppressIndex = dispatched.findIndex(
      (a) => a.type === chatIdleReconcileSuppressionSet.type,
    );
    expect(suppressIndex).toBeGreaterThan(sendStartedIndex);
    expect(dispatched[suppressIndex].payload).toEqual(["agent-1", true]);
  });

  it("starts a new queued turn from completed waiting-for-user-action state", async () => {
    const session = makeSession({
      status: AgentStatus.Idle,
      isStreaming: false,
      isProcessing: false,
      isResponding: false,
      stopReason: "end_turn",
    } as Partial<AgentSession>);
    selectState.results = [session];

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleQueueProcessing,
      queueData,
    ).toPromise();

    const sendStartedIndex = dispatched.findIndex((a) => a.type === chatSendStarted.type);
    const userMessageIndex = dispatched.findIndex((a) => a.type === "agentSessions/addMessage");
    const streamingIndex = dispatched.findIndex((a) => a.type === setAgentStreaming.type);

    expect(sendStartedIndex).toBeGreaterThanOrEqual(0);
    expect(userMessageIndex).toBeGreaterThan(sendStartedIndex);
    expect(streamingIndex).toBeGreaterThan(userMessageIndex);
    expect(dispatched[sendStartedIndex].payload).toMatchObject({
      agentId: "agent-1",
      wsId: "ws-agent-1",
    });
    expect(dispatched[userMessageIndex].payload[1]).toMatchObject({
      id: queueData.messageId,
      role: "user",
    });
  });

  it("preserves queued user app ID and passes assistant app ID to stream handler", async () => {
    const session = makeQueueSession();
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
    expect(userMessageAction?.type).toBe("agentSessions/addMessage");
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

    expect(selectState.index).toBe(3); // Retry lookup plus persistence lookup
    expect(sendMock).toHaveBeenCalledWith("agent:handler-ready", { agentId: "agent-1" });
    const streamingAction = dispatched.find((a) => a.type === setAgentStreaming.type);
    expect(streamingAction?.payload).toEqual(["agent-1", true]);
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
    selectState.results = [session, session];

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleQueueProcessing,
      queueData,
    ).toPromise();

    // Workspace-scoped persistence should use "different-ws", not "active-ws-id".
    const addActions = dispatched.filter((a) => a.payload?.[1]?.id === queueData.messageId);
    expect(addActions.map((a) => a.type)).toEqual(["agentSessions/addMessage"]);
    const streamingAction = dispatched.find((a) => a.type === setAgentStreaming.type);
    expect(streamingAction?.payload).toEqual(["agent-1", true]);
    expect(saveSessionMock).toHaveBeenCalledWith(session, "different-ws", {
      immediate: true,
      allowTruncation: undefined,
    });
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
    selectState.results = [session, session];

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleQueueCancelled,
      cancelData,
    ).toPromise();

    const removeAction = dispatched.find((a) => a.type === "agentSessions/removeMessage");
    expect(removeAction).toBeDefined();
    expect(removeAction?.payload).toEqual(["agent-1", "msg-cancel-1"]);

    // saveSession should use session.workspaceId
    expect(saveSessionMock).toHaveBeenCalledWith(session, "ws-agent-1", {
      immediate: true,
      allowTruncation: undefined,
    });
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

    // saveSession should not fall back to the active workspace.
    expect(saveSessionMock).not.toHaveBeenCalled();
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

    // saveSession should not fall back to the active workspace.
    expect(saveSessionMock).not.toHaveBeenCalled();
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

  it("dispatches a single canonical workspace-aware upsert for session field updates", async () => {
    const session = makeSession({ id: "agent-1", workspaceId: "ws-1", name: "Before" });
    const agent = { name: "After" };

    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleExistingSessionUpdate as any,
      session,
      agent,
      "agent-1",
      "ws-1",
    ).toPromise();

    const canonicalUpserts = dispatched.filter((a) => a.type === upsertSession.type);
    expect(canonicalUpserts).toHaveLength(1);
    expect(canonicalUpserts[0].payload[0].workspaceId).toBe("ws-1");
    expect(canonicalUpserts[0].payload[0]).toMatchObject({ id: "agent-1", name: "After" });
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
// is "responding". When stream sagas miss the per-stream `complete` event
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

    const updates = dispatched.filter((a) => a.type === updateMessage.type);
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toEqual([
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

    const updates = dispatched.filter((a) => a.type === updateMessage.type);
    expect(updates).toHaveLength(1);
    expect(updates[0].payload[2]).toEqual({ isStreaming: false, streamingComplete: true });
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

    const updates = dispatched.filter((a) => a.type === updateMessage.type);
    expect(updates).toHaveLength(0);
  });

  it("uses the canonical message update when the event workspaceId is stale", async () => {
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

    const updates = dispatched.filter((a) => a.type === updateMessage.type);
    expect(updates[0].payload).toEqual([
      "agent-1",
      "msg-asst-1",
      { isStreaming: false, streamingComplete: true },
    ]);
  });

  it("uses the canonical message update when falling back to the event workspaceId", async () => {
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

    const updates = dispatched.filter((a) => a.type === updateMessage.type);
    expect(updates[0].payload).toEqual([
      "agent-1",
      "msg-asst-1",
      { isStreaming: false, streamingComplete: true },
    ]);
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
  // path (where stream sagas have already cleared the flags) or with a
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
    const updates = dispatched.filter((a) => a.type === updateMessage.type);
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

// ============================================================================
// Wave 10 — queue-drain UI state desync (integration: both sagas + real store)
//
// Reproduces the user-reported race: after a queued message starts processing
// (chatSendStarted sets isStreaming/isProcessing true), the prior turn's
// agent:idle must NOT clear those flags. We drive both sagas against a real
// reducer-backed store so the assertion is on the resulting session state.
// ============================================================================
describe("Wave 10: queue-drain idle race", () => {
  function makeRealStore() {
    let state = {
      agentSessions: agentSessionReducer(undefined as any, { type: "@@init" } as any),
      chatState: chatStateReducer(undefined as any, { type: "@@init" } as any),
    };
    return {
      getState: () => state,
      dispatch: (action: any) => {
        state = {
          agentSessions: agentSessionReducer(state.agentSessions, action),
          chatState: chatStateReducer(state.chatState, action),
        };
        return action;
      },
    };
  }

  beforeEach(() => {
    sendMock.mockClear();
    saveSessionMock.mockClear();
    ensureStreamHandlerMock.mockClear();
    selectState.index = 0;
    selectState.results = [];
    selectState.useRealStore = true;
  });

  afterEach(() => {
    selectState.useRealStore = false;
    selectState.realGetState = null;
  });

  // Test A — ordering X: queue:processing handled before agent:idle.
  it("Test A: keeps flags true when agent:idle is processed AFTER queue:processing", async () => {
    const store = makeRealStore();
    selectState.realGetState = store.getState;
    store.dispatch(
      bulkUpsertSessions([
        makeSession({ isStreaming: false, isProcessing: false } as any),
      ]),
    );

    await runSaga(
      { dispatch: store.dispatch, getState: store.getState },
      handleQueueProcessing,
      queueData,
    ).toPromise();

    await runSaga(
      { dispatch: store.dispatch, getState: store.getState },
      handleAgentIdle,
      { agentId: "agent-1", workspaceId: "ws-agent-1" },
    ).toPromise();

    const session = store.getState().agentSessions.byAgentId["agent-1"];
    expect(session.isStreaming).toBe(true);
    expect(session.isProcessing).toBe(true);
  });

  // Test B — ordering Y: agent:idle handled before queue:processing.
  it("Test B: keeps flags true when agent:idle is processed BEFORE queue:processing", async () => {
    const store = makeRealStore();
    selectState.realGetState = store.getState;
    store.dispatch(
      bulkUpsertSessions([
        makeSession({ isStreaming: true, isProcessing: true } as any),
      ]),
    );

    await runSaga(
      { dispatch: store.dispatch, getState: store.getState },
      handleAgentIdle,
      { agentId: "agent-1", workspaceId: "ws-agent-1" },
    ).toPromise();

    await runSaga(
      { dispatch: store.dispatch, getState: store.getState },
      handleQueueProcessing,
      queueData,
    ).toPromise();

    const session = store.getState().agentSessions.byAgentId["agent-1"];
    expect(session.isStreaming).toBe(true);
    expect(session.isProcessing).toBe(true);
  });

  // Guard: a genuinely stuck stream (no fresh queued turn) is still reconciled.
  it("still clears genuinely-stuck flags when no queued turn started", async () => {
    const store = makeRealStore();
    selectState.realGetState = store.getState;
    store.dispatch(
      bulkUpsertSessions([
        makeSession({ isStreaming: true, isProcessing: true } as any),
      ]),
    );

    await runSaga(
      { dispatch: store.dispatch, getState: store.getState },
      handleAgentIdle,
      { agentId: "agent-1", workspaceId: "ws-agent-1" },
    ).toPromise();

    const session = store.getState().agentSessions.byAgentId["agent-1"];
    expect(session.isStreaming).toBe(false);
    expect(session.isProcessing).toBe(false);
  });
});

describe("agentIpcSaga lifecycle registrations", () => {
  it("registers migrated lifecycle action handlers and watcher flows", () => {
    const saga = agentIpcSaga();

    expect(saga.next().value).toEqual(
      sagaEffects.takeEvery(saveAgentSessionRequested, handleSaveAgentSessionRequested),
    );
    expect(saga.next().value).toEqual(
      sagaEffects.takeEvery(renameAgentSessionRequested, handleRenameAgentSessionRequested),
    );
    expect(saga.next().value).toEqual(
      sagaEffects.takeEvery(stopAgentSessionRequested, handleStopAgentSessionRequested),
    );
    expect(saga.next().value).toEqual(
      sagaEffects.takeEvery(deleteAgentSessionRequested, handleDeleteAgentSessionRequested),
    );
    expect(saga.next().value).toEqual(
      sagaEffects.takeEvery(deleteAgentWithUndoRequested, handleDeleteAgentWithUndoRequested),
    );
    expect(saga.next().value).toEqual(
      sagaEffects.takeEvery(undoAgentDeletionRequested, handleUndoAgentDeletionRequested),
    );
    expect(saga.next().value).toEqual(
      sagaEffects.takeEvery(commitPendingAgentDeletionRequested, handleCommitPendingAgentDeletionRequested),
    );
    expect(saga.next().value).toEqual(
      sagaEffects.takeEvery(flushPendingAgentDeletionsRequested, handleFlushPendingAgentDeletionsRequested),
    );
    expect(saga.next().value).toEqual(sagaEffects.fork(watchAgentIdleSaga));
    expect(saga.next().value).toEqual(sagaEffects.fork(watchStreamStartingSaga));
    expect(saga.next().value).toEqual(sagaEffects.fork(watchPrepareHandlerSaga));
    expect(saga.next().value).toEqual(sagaEffects.fork(watchAgentCreatedIpcSaga));
    expect(saga.next().value).toEqual(sagaEffects.fork(watchQueueProcessingSaga));
    expect(saga.next().value).toEqual(sagaEffects.fork(watchQueueCancelledSaga));
    expect(saga.next().value).toEqual(sagaEffects.fork(watchBeforeUnloadSaga));
    expect(saga.next().value).toEqual(sagaEffects.fork(watchPagehideSaga));
    expect(saga.next().value).toEqual(sagaEffects.fork(watchBackendStreamReconnectSaga));
    expect(saga.next().done).toBe(true);
  });

  it("watches backend stream reconnect request actions", () => {
    const saga = watchBackendStreamReconnectSaga();

    const reconnectEffect: any = saga.next().value;
    expect(reconnectEffect.payload.args[0]).toBe(triggerBackendStreamReconnect);
    expect(typeof reconnectEffect.payload.args[1]).toBe("function");
    expect(saga.next().done).toBe(true);
  });
});

describe("migrated agent IPC lifecycle handlers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    invokeMock.mockResolvedValue({ success: true });
    deleteAgentMock.mockResolvedValue(undefined);
    saveSessionMock.mockResolvedValue(undefined);
    ensureStreamHandlerMock.mockResolvedValue({ created: false });
    selectState.index = 0;
    selectState.results = [];
    streamingSessionsState.results = [];
    diskCountState.value = 0;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("saves the selected agent session and resolves the request", async () => {
    const session = makeSession({ workspaceId: "ws-A" as any });
    selectState.results = [session];
    const action = saveAgentSessionRequested("ws-A", "agent-1", true, { allowTruncation: true });
    const dispatched: any[] = [];

    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleSaveAgentSessionRequested,
      action,
    ).toPromise();

    expect(saveSessionMock).toHaveBeenCalledWith(session, "ws-A", {
      immediate: true,
      allowTruncation: true,
    });
    expect(dispatched.find((a) => a.type === saveAgentSessionRequested.success.type)?.payload).toEqual({
      request: ["ws-A", "agent-1", true, { allowTruncation: true }],
      response: undefined,
    });
  });

  it("renames an agent session with a trimmed name", async () => {
    const action = renameAgentSessionRequested("ws-A", "agent-1", "  New Name  ");
    const dispatched: any[] = [];

    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleRenameAgentSessionRequested,
      action,
    ).toPromise();

    expect(invokeMock).toHaveBeenCalledWith(AGENT_CHANNELS.RENAME, {
      agentId: "agent-1",
      workspaceId: "ws-A",
      name: "New Name",
    });
    expect(dispatched.find((a) => a.type === renameAgentSessionRequested.success.type)).toBeDefined();
  });

  it("stops an agent session through runtime cleanup and backend stop", async () => {
    const session = makeSession({ workspaceId: "ws-A" as any, isStreaming: true });
    selectState.results = [session];
    const action = stopAgentSessionRequested("ws-A", "agent-1");
    const dispatched: any[] = [];

    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleStopAgentSessionRequested,
      action,
    ).toPromise();

    expect(clearKeysForAgentMock).toHaveBeenCalledWith("agent-1");
    expect(dispatched.find((a) => a.type === setAgentStreaming.type)?.payload).toEqual([
      "agent-1",
      false,
    ]);
    expect(invokeMock).toHaveBeenCalledWith(AGENT_BACKEND_CHANNELS.STOP, {
      agentId: "agent-1",
      sessionId: "agent-1",
    });
    expect(trackMock).toHaveBeenCalledWith("Stopped Agent", expect.objectContaining({
      agent_id: "agent-1",
      workspace_id: "ws-A",
    }));
    expect(dispatched.find((a) => a.type === stopAgentSessionRequested.success.type)).toBeDefined();
  });

  it("permanently deletes an agent session and clears local state", async () => {
    const session = makeSession({ workspaceId: "ws-A" as any, isStreaming: true });
    selectState.results = [session, session];
    const action = deleteAgentSessionRequested("ws-A", "agent-1");
    const dispatched: any[] = [];

    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleDeleteAgentSessionRequested,
      action,
    ).toPromise();

    expect(deleteAgentMock).toHaveBeenCalledWith("agent-1", expect.objectContaining({ id: "ws-A" }));
    expect(dispatched.find((a) => a.type === removeAgent.type)?.payload).toEqual(["ws-A", "agent-1"]);
    expect(dispatched.find((a) => a.type === clearAgentUnread.type)?.payload).toEqual(["agent-1"]);
    expect(eventCollectorTrackMock).toHaveBeenCalledWith("SESSION_DELETED", {
      agentId: "agent-1",
      workspaceId: "ws-A",
    });
    expect(dispatched.find((a) => a.type === deleteAgentSessionRequested.success.type)).toBeDefined();
  });

  it("soft-deletes with undo and restores the pending session", async () => {
    const session = makeSession({ workspaceId: "ws-A" as any, name: "Undo Me" });
    selectState.results = [session, session];
    const deleteAction = deleteAgentWithUndoRequested("ws-A", "agent-1", "Undo Me");
    const deleteDispatched: any[] = [];

    const deleteTask = runSaga(
      { dispatch: (a: any) => deleteDispatched.push(a), getState: () => ({}) },
      handleDeleteAgentWithUndoRequested,
      deleteAction,
    );
    await waitForDeleteWithUndoPending();

    expect(deleteDispatched.find((a) => a.type === removeAgent.type)?.payload).toEqual(["ws-A", "agent-1"]);
    expect(toastWarningMock).toHaveBeenCalledWith("Deleted \"Undo Me\"", expect.any(Object));
    expect(deleteDispatched.find((a) => a.type === deleteAgentWithUndoRequested.success.type)?.payload.response).toBe(session);

    const undoAction = undoAgentDeletionRequested("ws-A", "agent-1");
    const undoDispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => undoDispatched.push(a), getState: () => ({}) },
      handleUndoAgentDeletionRequested,
      undoAction,
    ).toPromise();

    expect(undoDispatched.find((a) => a.type === upsertSession.type)?.payload).toEqual([
      { ...session, workspaceId: "ws-A" },
    ]);
    expect(toastDismissMock).toHaveBeenCalledWith("toast-1");
    expect(undoDispatched.find((a) => a.type === undoAgentDeletionRequested.success.type)?.payload.response).toBe(true);
    await deleteTask.toPromise();

    await vi.advanceTimersByTimeAsync(15_000);
    expect(deleteDispatched).not.toContainEqual(commitPendingAgentDeletionRequested("ws-A", "agent-1"));
  });

  it("dispatches delete undo toast callbacks directly", async () => {
    const session = makeSession({ workspaceId: "ws-A" as any, name: "Undo Me" });
    selectState.results = [session, session];

    const deleteTask = runSaga(
      { dispatch: vi.fn(), getState: () => ({}) },
      handleDeleteAgentWithUndoRequested,
      deleteAgentWithUndoRequested("ws-A", "agent-1", "Undo Me"),
    );
    await waitForDeleteWithUndoPending();

    const toastOptions = toastWarningMock.mock.calls[0]?.[1] as { action?: { onClick?: () => void } };
    toastOptions.action?.onClick?.();

    expect(storeDispatchMock).toHaveBeenCalledWith(expect.objectContaining({
      type: undoAgentDeletionRequested.type,
      payload: ["ws-A", "agent-1"],
    }));
    await runSaga(
      { dispatch: vi.fn(), getState: () => ({}) },
      handleUndoAgentDeletionRequested,
      undoAgentDeletionRequested("ws-A", "agent-1"),
    ).toPromise();
    await deleteTask.toPromise();
  });

  it("forks a delayed task that dispatches pending deletion commit", async () => {
    const session = makeSession({ workspaceId: "ws-A" as any, name: "Commit Me" });
    selectState.results = [session, session];
    const dispatched: any[] = [];

    const deleteTask = runSaga(
      { dispatch: (action: any) => dispatched.push(action), getState: () => ({}) },
      handleDeleteAgentWithUndoRequested,
      deleteAgentWithUndoRequested("ws-A", "agent-1", "Commit Me"),
    );
    await waitForDeleteWithUndoPending();

    await vi.advanceTimersByTimeAsync(15_000);
    await deleteTask.toPromise();

    expect(dispatched).toContainEqual(commitPendingAgentDeletionRequested("ws-A", "agent-1"));
    selectState.index = 0;
    selectState.results = [undefined];
    await runSaga(
      { dispatch: vi.fn(), getState: () => ({}) },
      handleCommitPendingAgentDeletionRequested,
      commitPendingAgentDeletionRequested("ws-A", "agent-1"),
    ).toPromise();
  });

  it("flushes pending agent deletions", async () => {
    const session = makeSession({ workspaceId: "ws-A" as any });
    selectState.results = [session, session];
    const deleteTask = runSaga(
      { dispatch: vi.fn(), getState: () => ({}) },
      handleDeleteAgentWithUndoRequested,
      deleteAgentWithUndoRequested("ws-A", "agent-1", "Flush Me"),
    );
    await waitForDeleteWithUndoPending();

    deleteAgentMock.mockClear();
    selectState.index = 0;
    selectState.results = [undefined];
    const action = flushPendingAgentDeletionsRequested("ws-A");
    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleFlushPendingAgentDeletionsRequested,
      action,
    ).toPromise();

    expect(deleteAgentMock).toHaveBeenCalledWith("agent-1", expect.objectContaining({ id: "ws-A" }));
    expect(dispatched.find((a) => a.type === flushPendingAgentDeletionsRequested.success.type)).toBeDefined();
    await deleteTask.toPromise();
  });

  it("beforeunload saves streaming sessions and flushes pending deletions", async () => {
    const pending = makeSession({ id: "agent-pending" as any, workspaceId: "ws-A" as any });
    selectState.results = [pending, pending];
    const deleteTask = runSaga(
      { dispatch: vi.fn(), getState: () => ({}) },
      handleDeleteAgentWithUndoRequested,
      deleteAgentWithUndoRequested("ws-A", "agent-pending", "Pending"),
    );
    await waitForDeleteWithUndoPending();

    const streaming = makeSession({
      id: "agent-streaming" as any,
      workspaceId: "ws-stream" as any,
      isStreaming: true,
      messages: [{ id: "msg-streaming", role: "assistant", contentBlocks: [], timestamp: "", isStreaming: true } as any],
    });
    streamingSessionsState.results = [streaming];
    saveSessionMock.mockClear();
    deleteAgentMock.mockClear();
    const listeners = captureWindowListeners();
    const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, watchBeforeUnloadSaga);

    listeners.beforeunload();
    await Promise.resolve();

    expect(saveSessionMock).toHaveBeenCalledWith(streaming, "ws-stream", { immediate: true });
    expect(deleteAgentMock).toHaveBeenCalledWith("agent-pending", expect.objectContaining({ id: "ws-A" }));
    await deleteTask.toPromise();
    task.cancel();
    await task.toPromise();
  });

  it("beforeunload skips saving a streaming session that has fewer messages than restored state", async () => {
    const streaming = makeSession({
      id: "agent-streaming" as any,
      workspaceId: "ws-stream" as any,
      isStreaming: true,
      messages: [{ id: "msg-streaming", role: "assistant", contentBlocks: [], timestamp: "", isStreaming: true } as any],
    });
    streamingSessionsState.results = [streaming];
    diskCountState.value = 2;
    const listeners = captureWindowListeners();
    const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, watchBeforeUnloadSaga);

    listeners.beforeunload();
    await Promise.resolve();

    expect(saveSessionMock).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });

  it("pagehide without bfcache clears pending deletion runtime state", async () => {
    const session = makeSession({ workspaceId: "ws-A" as any });
    selectState.results = [session, session];
    const deleteTask = runSaga(
      { dispatch: vi.fn(), getState: () => ({}) },
      handleDeleteAgentWithUndoRequested,
      deleteAgentWithUndoRequested("ws-A", "agent-1", "Pagehide Me"),
    );
    await waitForDeleteWithUndoPending();

    const listeners = captureWindowListeners();
    const task = runSaga({ dispatch: vi.fn(), getState: () => ({}) }, watchPagehideSaga);
    listeners.pagehide({ persisted: false });
    await Promise.resolve();
    task.cancel();
    await task.toPromise();
    await deleteTask.toPromise();

    const undoAction = undoAgentDeletionRequested("ws-A", "agent-1");
    const dispatched: any[] = [];
    await runSaga(
      { dispatch: (a: any) => dispatched.push(a), getState: () => ({}) },
      handleUndoAgentDeletionRequested,
      undoAction,
    ).toPromise();

    expect(dispatched.find((a) => a.type === undoAgentDeletionRequested.success.type)?.payload.response).toBe(false);
  });

  it("debounces backend stream reconnect requests and dispatches active stream results", async () => {
    const activeStreams = [
      { agentId: "agent-active-1", workspaceId: "ws-A", assistantAppMessageId: "app-1" },
      { agentId: "agent-active-2", workspaceId: "ws-B" },
    ];
    invokeMock.mockResolvedValue({ success: true, data: activeStreams });
    const channel = stdChannel();
    const dispatched: any[] = [];
    const task = runSaga(
      { channel, dispatch: (action: any) => dispatched.push(action), getState: () => ({}) },
      watchBackendStreamReconnectSaga,
    );

    channel.put(triggerBackendStreamReconnect());
    await vi.advanceTimersByTimeAsync(501);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0]?.[0]).toBe("agent:get-active-streams");
    expect(dispatched).toContainEqual(backendStreamsReconnectResultReceived(activeStreams));
    expect(dispatched).toContainEqual(triggerStreamingSafetyCheck(["agent-active-1", "agent-active-2"]));
    task.cancel();
    await task.toPromise();
  });

  it("dispatches an empty reconnect result without a safety check when backend has no active streams", async () => {
    invokeMock.mockResolvedValue({ success: true, data: [] });
    const channel = stdChannel();
    const dispatched: any[] = [];
    const task = runSaga(
      { channel, dispatch: (action: any) => dispatched.push(action), getState: () => ({}) },
      watchBackendStreamReconnectSaga,
    );

    channel.put(triggerBackendStreamReconnect());
    await vi.advanceTimersByTimeAsync(501);

    expect(invokeMock.mock.calls[0]?.[0]).toBe("agent:get-active-streams");
    expect(dispatched).toContainEqual(backendStreamsReconnectResultReceived([]));
    expect(dispatched.some((action) => action.type === triggerStreamingSafetyCheck.type)).toBe(false);
    task.cancel();
    await task.toPromise();
  });

  it("treats unsuccessful backend reconnect responses as empty results", async () => {
    invokeMock.mockResolvedValue({ success: false, data: [{ agentId: "ignored" }] });
    const channel = stdChannel();
    const dispatched: any[] = [];
    const task = runSaga(
      { channel, dispatch: (action: any) => dispatched.push(action), getState: () => ({}) },
      watchBackendStreamReconnectSaga,
    );

    channel.put(triggerBackendStreamReconnect());
    await vi.advanceTimersByTimeAsync(501);

    expect(invokeMock.mock.calls[0]?.[0]).toBe("agent:get-active-streams");
    expect(dispatched).toContainEqual(backendStreamsReconnectResultReceived([]));
    expect(dispatched.some((action) => action.type === triggerStreamingSafetyCheck.type)).toBe(false);
    task.cancel();
    await task.toPromise();
  });

  it("handles backend reconnect IPC errors without throwing", async () => {
    invokeMock.mockRejectedValue(new Error("backend unavailable"));
    const channel = stdChannel();
    const dispatched: any[] = [];
    const task = runSaga(
      { channel, dispatch: (action: any) => dispatched.push(action), getState: () => ({}) },
      watchBackendStreamReconnectSaga,
    );

    channel.put(triggerBackendStreamReconnect());
    await vi.advanceTimersByTimeAsync(501);

    expect(invokeMock.mock.calls[0]?.[0]).toBe("agent:get-active-streams");
    expect(dispatched).toEqual([]);
    task.cancel();
    await task.toPromise();
  });
});
