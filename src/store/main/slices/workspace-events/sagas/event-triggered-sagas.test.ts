import {
  describe,
  expect,
  it,
  vi,
  beforeEach,
} from "vitest";
import { expectSaga } from "redux-saga-test-plan";
import type { WorkspaceEvent } from "../../../../../features/events/types";
import { workspaceEventAccepted } from "../workspace-events-slice";

// ---------------------------------------------------------------------------
// Hoisted mocks for saga dependencies.
// ---------------------------------------------------------------------------

const {
  handleAgentIdleMock,
  getNotificationServiceMock,
  onAgentLifecycleChangedMock,
  restoreWorkspaceIdMock,
  LoggerMock,
  loggerErrorMock,
  loggerInfoMock,
  loggerWarnMock,
  mockAgentBackendHandler,
  mockMainDispatch,
} = vi.hoisted(() => {
  const handleAgentIdleMock = vi.fn();
  const getNotificationServiceMock = vi.fn(() => ({
    handleAgentIdle: handleAgentIdleMock,
  }));
  const onAgentLifecycleChangedMock = vi.fn();
  const restoreWorkspaceIdMock = vi.fn((id: string | undefined | null) =>
    id ? id : undefined,
  );
  const loggerErrorMock = vi.fn();
  const loggerInfoMock = vi.fn();
  const loggerWarnMock = vi.fn();
  const mockAgentBackendHandler = {
    getAgent: vi.fn(),
    getAgentResumability: vi.fn(),
    isAgentDeleted: vi.fn(),
    getActiveStreams: vi.fn(),
    sendBackendInitiatedMessage: vi.fn(),
    handleQueueMessage: vi.fn(),
    stopAgent: vi.fn(),
    clearInterruptedFlag: vi.fn(),
    interruptAgentWithMessage: vi.fn(),
  };
  const mockMainDispatch = vi.fn();
  const LoggerMock = vi.fn(function LoggerMock() {
    return { error: loggerErrorMock, info: loggerInfoMock, warn: loggerWarnMock };
  });

  return {
    handleAgentIdleMock,
    getNotificationServiceMock,
    onAgentLifecycleChangedMock,
    restoreWorkspaceIdMock,
    LoggerMock,
    loggerErrorMock,
    loggerInfoMock,
    loggerWarnMock,
    mockAgentBackendHandler,
    mockMainDispatch,
  };
});

vi.mock(
  "../../../../../features/notifications/main/notification.service",
  () => ({
    getNotificationService: (workspaceId: string) =>
      getNotificationServiceMock(workspaceId),
  }),
);

vi.mock(
  "../../../../../features/workspace/main/workspace.service",
  () => ({
    workspaceService: {
      onAgentLifecycleChanged: (...args: unknown[]) =>
        onAgentLifecycleChangedMock(...args),
    },
  }),
);

vi.mock("../../../../../shared/types/type-guards", () => ({
  restoreWorkspaceId: (id: string | undefined | null) =>
    restoreWorkspaceIdMock(id),
}));

vi.mock("../../../../../shared/logger", () => ({
  Logger: LoggerMock,
}));

vi.mock(
  "../../../../../features/agent/main/agent-backend-handler.service",
  () => ({
    AgentBackendHandler: {
      getInstance: () => mockAgentBackendHandler,
    },
  }),
);

vi.mock("../../../../../store/main/redux-store-bridge", () => ({
  mainDispatch: (...args: unknown[]) => mockMainDispatch(...args),
}));

import {
  handleMessageSentEvent,
  handleAgentIdleNotification,
  handleAgentLifecycleForSummary,
} from "./event-triggered-sagas";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const makeAgentIdleEvent = (workspaceId = "ws-1"): WorkspaceEvent =>
  ({
    id: "e-idle",
    type: "agent:idle",
    workspaceId,
    timestamp: new Date().toISOString(),
    actor: { type: "agent", id: "agent-1", name: "Agent One" },
    data: {
      agentId: "agent-1",
      agentName: "Agent One",
      reason: "stream_complete",
    },
  }) as unknown as WorkspaceEvent;

const makeOtherEvent = (type: string, workspaceId = "ws-1"): WorkspaceEvent =>
  ({
    id: "e-other",
    type,
    workspaceId,
    timestamp: new Date().toISOString(),
    actor: { type: "user", id: "user-1", name: "Test User" },
    data: { path: "/x.ts", relativePath: "x.ts", action: "modify" },
  }) as unknown as WorkspaceEvent;

const makeAgentMessageSentEvent = (workspaceId = "ws-1"): WorkspaceEvent =>
  ({
    id: "e-message",
    type: "agent:message:sent",
    workspaceId,
    timestamp: new Date().toISOString(),
    actor: { type: "agent", id: "sender-agent", name: "Sender Agent" },
    data: {
      fromAgentId: "sender-agent",
      fromAgentName: "Sender Agent",
      toAgentId: "target-agent",
      message: "Please continue.",
      priority: "high",
    },
  }) as unknown as WorkspaceEvent;

// ---------------------------------------------------------------------------
// handleMessageSentEvent
// ---------------------------------------------------------------------------

describe("handleMessageSentEvent", () => {
  beforeEach(() => {
    mockAgentBackendHandler.getAgent.mockReset();
    mockAgentBackendHandler.getAgentResumability.mockReset();
    mockAgentBackendHandler.isAgentDeleted.mockReset();
    mockAgentBackendHandler.getActiveStreams.mockReset();
    mockAgentBackendHandler.sendBackendInitiatedMessage.mockReset();
    mockAgentBackendHandler.handleQueueMessage.mockReset();
    mockAgentBackendHandler.stopAgent.mockReset();
    mockAgentBackendHandler.clearInterruptedFlag.mockReset();
    mockAgentBackendHandler.interruptAgentWithMessage.mockReset();
    mockMainDispatch.mockReset();
    loggerInfoMock.mockClear();
    loggerWarnMock.mockClear();
    loggerErrorMock.mockClear();

    mockAgentBackendHandler.isAgentDeleted.mockReturnValue(false);
    mockAgentBackendHandler.getActiveStreams.mockReturnValue([]);
    mockAgentBackendHandler.sendBackendInitiatedMessage.mockResolvedValue({ success: true });
    mockAgentBackendHandler.interruptAgentWithMessage.mockResolvedValue({ success: true });
  });

  it("wakes persisted-only target agents instead of silently dropping the message", async () => {
    mockAgentBackendHandler.getAgent.mockResolvedValue(null);
    mockAgentBackendHandler.getAgentResumability.mockResolvedValue({
      canWake: true,
      status: "resumable",
      agentData: { id: "target-agent", name: "Target", status: "idle" },
    });

    await expectSaga(handleMessageSentEvent, workspaceEventAccepted(makeAgentMessageSentEvent())).run();

    expect(mockAgentBackendHandler.getAgentResumability).toHaveBeenCalledWith("target-agent", "ws-1");
    expect(mockAgentBackendHandler.sendBackendInitiatedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "target-agent",
        workspaceId: "ws-1",
        message: expect.stringContaining("Please continue."),
      }),
    );
    expect(mockMainDispatch).not.toHaveBeenCalled();
  });

  it("emits delivery failure when the target is neither active nor resumable", async () => {
    mockAgentBackendHandler.getAgent.mockResolvedValue(null);
    mockAgentBackendHandler.getAgentResumability.mockResolvedValue({
      canWake: false,
      status: "not_found",
    });

    await expectSaga(handleMessageSentEvent, workspaceEventAccepted(makeAgentMessageSentEvent())).run();

    expect(mockAgentBackendHandler.sendBackendInitiatedMessage).not.toHaveBeenCalled();
    expect(mockMainDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.arrayContaining([
          expect.objectContaining({
            type: "agent:message:delivery-failed",
            data: expect.objectContaining({ toAgentId: "target-agent" }),
          }),
        ]),
      }),
    );
  });

  it("emits delivery failure and skips wake checks for deleted target agents", async () => {
    mockAgentBackendHandler.isAgentDeleted.mockReturnValue(true);
    mockAgentBackendHandler.getAgent.mockResolvedValue({ id: "target-agent", name: "Target", status: "idle" });

    await expectSaga(handleMessageSentEvent, workspaceEventAccepted(makeAgentMessageSentEvent())).run();

    expect(mockAgentBackendHandler.getAgent).not.toHaveBeenCalled();
    expect(mockAgentBackendHandler.getAgentResumability).not.toHaveBeenCalled();
    expect(mockAgentBackendHandler.sendBackendInitiatedMessage).not.toHaveBeenCalled();
    expect(mockMainDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.arrayContaining([
          expect.objectContaining({
            type: "agent:message:delivery-failed",
            data: expect.objectContaining({
              toAgentId: "target-agent",
              error: expect.stringContaining("deleted"),
            }),
          }),
        ]),
      }),
    );
  });

  it("sends directly to active idle target agents", async () => {
    mockAgentBackendHandler.getAgent.mockResolvedValue({ id: "target-agent", name: "Target", status: "idle" });

    await expectSaga(handleMessageSentEvent, workspaceEventAccepted(makeAgentMessageSentEvent())).run();

    expect(mockAgentBackendHandler.getAgentResumability).not.toHaveBeenCalled();
    expect(mockAgentBackendHandler.sendBackendInitiatedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "target-agent",
        workspaceId: "ws-1",
        message: expect.stringContaining("Please continue."),
        messageMetadata: expect.objectContaining({ priority: "high" }),
      }),
    );
    expect(mockMainDispatch).not.toHaveBeenCalled();
  });

  it("queues messages for active streaming targets", async () => {
    mockAgentBackendHandler.getAgent.mockResolvedValue({ id: "target-agent", name: "Target", status: "responding" });
    mockAgentBackendHandler.getActiveStreams.mockReturnValue([{ agentId: "target-agent", workspaceId: "ws-1" }]);
    mockAgentBackendHandler.handleQueueMessage.mockResolvedValue({ success: true });

    await expectSaga(handleMessageSentEvent, workspaceEventAccepted(makeAgentMessageSentEvent())).run();

    expect(mockAgentBackendHandler.sendBackendInitiatedMessage).not.toHaveBeenCalled();
    expect(mockAgentBackendHandler.handleQueueMessage).toHaveBeenCalledWith(null, {
      agentId: "target-agent",
      content: expect.stringContaining("Please continue."),
      workspaceId: "ws-1",
    });
    expect(mockMainDispatch).not.toHaveBeenCalled();
  });

  it("does not treat an active stream in another workspace as blocking delivery", async () => {
    mockAgentBackendHandler.getAgent.mockResolvedValue({ id: "target-agent", name: "Target", status: "idle" });
    mockAgentBackendHandler.getActiveStreams.mockReturnValue([{ agentId: "target-agent", workspaceId: "ws-other" }]);

    await expectSaga(handleMessageSentEvent, workspaceEventAccepted(makeAgentMessageSentEvent("ws-1"))).run();

    expect(mockAgentBackendHandler.handleQueueMessage).not.toHaveBeenCalled();
    expect(mockAgentBackendHandler.sendBackendInitiatedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "target-agent",
        workspaceId: "ws-1",
        message: expect.stringContaining("Please continue."),
      }),
    );
  });

  it("emits delivery failure when active streaming queue fallback fails", async () => {
    mockAgentBackendHandler.getAgent.mockResolvedValue({ id: "target-agent", name: "Target", status: "responding" });
    mockAgentBackendHandler.getActiveStreams.mockReturnValue([{ agentId: "target-agent", workspaceId: "ws-1" }]);
    mockAgentBackendHandler.handleQueueMessage.mockResolvedValue({ success: false, error: "queue exploded" });

    await expectSaga(handleMessageSentEvent, workspaceEventAccepted(makeAgentMessageSentEvent())).run();

    expect(mockMainDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.arrayContaining([
          expect.objectContaining({
            type: "agent:message:delivery-failed",
            data: expect.objectContaining({ toAgentId: "target-agent", error: "queue exploded" }),
          }),
        ]),
      }),
    );
  });

  it("queues when direct send reports an already-busy target", async () => {
    mockAgentBackendHandler.getAgent.mockResolvedValue({ id: "target-agent", name: "Target", status: "idle" });
    mockAgentBackendHandler.sendBackendInitiatedMessage.mockResolvedValue({
      success: false,
      errorCode: "ALREADY_STREAMING",
      error: "busy",
    });
    mockAgentBackendHandler.handleQueueMessage.mockResolvedValue({ success: true });

    await expectSaga(handleMessageSentEvent, workspaceEventAccepted(makeAgentMessageSentEvent())).run();

    expect(mockAgentBackendHandler.handleQueueMessage).toHaveBeenCalledWith(null, {
      agentId: "target-agent",
      content: expect.stringContaining("Please continue."),
      workspaceId: "ws-1",
    });
    expect(mockMainDispatch).not.toHaveBeenCalled();
  });

  it("emits delivery failure when direct send fails with a terminal error", async () => {
    mockAgentBackendHandler.getAgent.mockResolvedValue({ id: "target-agent", name: "Target", status: "idle" });
    mockAgentBackendHandler.sendBackendInitiatedMessage.mockResolvedValue({
      success: false,
      errorCode: "NOT_FOUND",
      error: "lost session",
    });

    await expectSaga(handleMessageSentEvent, workspaceEventAccepted(makeAgentMessageSentEvent())).run();

    expect(mockAgentBackendHandler.handleQueueMessage).not.toHaveBeenCalled();
    expect(mockMainDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.arrayContaining([
          expect.objectContaining({
            type: "agent:message:delivery-failed",
            data: expect.objectContaining({ toAgentId: "target-agent", error: "lost session" }),
          }),
        ]),
      }),
    );
  });

  it("directly interrupts and delivers interrupt messages to active streaming targets", async () => {
    const event = makeAgentMessageSentEvent() as any;
    event.data = { ...event.data, priority: "interrupt" };
    mockAgentBackendHandler.getAgent.mockResolvedValue({ id: "target-agent", name: "Target", status: "responding" });
    mockAgentBackendHandler.getActiveStreams.mockReturnValue([{ agentId: "target-agent", workspaceId: "ws-1" }]);

    await expectSaga(handleMessageSentEvent, workspaceEventAccepted(event)).run();

    expect(mockAgentBackendHandler.interruptAgentWithMessage).toHaveBeenCalledWith({
      agentId: "target-agent",
      message: expect.stringContaining("(INTERRUPT)"),
      workspaceId: "ws-1",
      messageMetadata: expect.objectContaining({
        type: "agent_message",
        fromAgentId: "sender-agent",
        priority: "interrupt",
      }),
    });
    expect(mockAgentBackendHandler.stopAgent).not.toHaveBeenCalled();
    expect(mockAgentBackendHandler.sendBackendInitiatedMessage).not.toHaveBeenCalled();
    expect(mockAgentBackendHandler.handleQueueMessage).not.toHaveBeenCalled();
    expect(mockMainDispatch).not.toHaveBeenCalled();
  });

  it("queues interrupt messages with workspace targeting when direct interrupt delivery fails", async () => {
    const event = makeAgentMessageSentEvent() as any;
    event.data = { ...event.data, priority: "interrupt" };
    mockAgentBackendHandler.getAgent.mockResolvedValue({ id: "target-agent", name: "Target", status: "responding" });
    mockAgentBackendHandler.getActiveStreams.mockReturnValue([{ agentId: "target-agent", workspaceId: "ws-1" }]);
    mockAgentBackendHandler.interruptAgentWithMessage.mockResolvedValue({
      success: false,
      error: "interrupt stream failed",
    });
    mockAgentBackendHandler.handleQueueMessage.mockResolvedValue({ success: true });

    await expectSaga(handleMessageSentEvent, workspaceEventAccepted(event)).run();

    expect(mockAgentBackendHandler.handleQueueMessage).toHaveBeenCalledWith(null, {
      agentId: "target-agent",
      content: expect.stringContaining("(INTERRUPT)"),
      workspaceId: "ws-1",
    });
    expect(mockAgentBackendHandler.clearInterruptedFlag).toHaveBeenCalledWith("target-agent");
    expect(mockMainDispatch).not.toHaveBeenCalled();
  });

  it("queues interrupt messages and clears interrupted flag when direct interrupt delivery throws", async () => {
    const event = makeAgentMessageSentEvent() as any;
    event.data = { ...event.data, priority: "interrupt" };
    mockAgentBackendHandler.getAgent.mockResolvedValue({ id: "target-agent", name: "Target", status: "responding" });
    mockAgentBackendHandler.getActiveStreams.mockReturnValue([{ agentId: "target-agent", workspaceId: "ws-1" }]);
    mockAgentBackendHandler.interruptAgentWithMessage.mockRejectedValue(new Error("interrupt exploded"));
    mockAgentBackendHandler.handleQueueMessage.mockResolvedValue({ success: true });

    await expectSaga(handleMessageSentEvent, workspaceEventAccepted(event)).run();

    expect(mockAgentBackendHandler.handleQueueMessage).toHaveBeenCalledWith(null, {
      agentId: "target-agent",
      content: expect.stringContaining("(INTERRUPT)"),
      workspaceId: "ws-1",
    });
    expect(mockAgentBackendHandler.clearInterruptedFlag).toHaveBeenCalledWith("target-agent");
    expect(mockMainDispatch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleAgentIdleNotification
// ---------------------------------------------------------------------------

describe("handleAgentIdleNotification", () => {
  beforeEach(() => {
    handleAgentIdleMock.mockReset();
    handleAgentIdleMock.mockResolvedValue(undefined);
    getNotificationServiceMock.mockClear();
    LoggerMock.mockClear();
    loggerErrorMock.mockClear();
  });

  it("invokes NotificationService.handleAgentIdle for agent:idle events", async () => {
    const event = makeAgentIdleEvent("ws-42");
    const action = workspaceEventAccepted(event);

    await expectSaga(handleAgentIdleNotification, action).run();

    expect(getNotificationServiceMock).toHaveBeenCalledWith("ws-42");
    expect(handleAgentIdleMock).toHaveBeenCalledTimes(1);
    expect(handleAgentIdleMock).toHaveBeenCalledWith(event);
  });

  it("does not invoke NotificationService for non-agent:idle events", async () => {
    const eventTypes = [
      "file:changed",
      "agent:message:sent",
      "agent:status-changed",
      "agent:created",
      "note:created",
    ];

    for (const type of eventTypes) {
      const action = workspaceEventAccepted(makeOtherEvent(type));
      await expectSaga(handleAgentIdleNotification, action).run();
    }

    expect(handleAgentIdleMock).not.toHaveBeenCalled();
    expect(getNotificationServiceMock).not.toHaveBeenCalled();
  });

  it("swallows errors thrown by handleAgentIdle so the saga never crashes", async () => {
    handleAgentIdleMock.mockRejectedValueOnce(new Error("boom"));

    const action = workspaceEventAccepted(makeAgentIdleEvent("ws-err"));

    // Should not throw, saga should complete cleanly
    await expect(
      expectSaga(handleAgentIdleNotification, action).run(),
    ).resolves.toBeDefined();

    expect(handleAgentIdleMock).toHaveBeenCalledTimes(1);
  });
});
// ---------------------------------------------------------------------------
// handleAgentLifecycleForSummary
// ---------------------------------------------------------------------------

describe("handleAgentLifecycleForSummary", () => {
  beforeEach(() => {
    onAgentLifecycleChangedMock.mockReset();
    onAgentLifecycleChangedMock.mockReturnValue(undefined);
    restoreWorkspaceIdMock.mockReset();
    restoreWorkspaceIdMock.mockImplementation((id: string | undefined | null) =>
      id ? id : undefined,
    );
    LoggerMock.mockClear();
    loggerErrorMock.mockClear();
  });

  const SUMMARY_INVALIDATING_TYPES = [
    "agent:created",
    "agent:deleted",
    "agent:idle",
    "agent:status-changed",
    "agent:completed",
    "agent:failed",
  ];

  it.each(SUMMARY_INVALIDATING_TYPES)(
    "invalidates the workspace summary for %s events",
    async (type) => {
      const event = makeOtherEvent(type, "ws-77");
      const action = workspaceEventAccepted(event);

      await expectSaga(handleAgentLifecycleForSummary, action).run();

      expect(onAgentLifecycleChangedMock).toHaveBeenCalledTimes(1);
      expect(onAgentLifecycleChangedMock).toHaveBeenCalledWith({
        workspaceId: "ws-77",
      });
    },
  );

  it("does not invalidate for unrelated events", async () => {
    const eventTypes = [
      "file:changed",
      "agent:message:sent",
      "note:created",
      "git:status-changed",
    ];

    for (const type of eventTypes) {
      const action = workspaceEventAccepted(makeOtherEvent(type));
      await expectSaga(handleAgentLifecycleForSummary, action).run();
    }

    expect(onAgentLifecycleChangedMock).not.toHaveBeenCalled();
  });

  it("ignores events without a workspaceId", async () => {
    const event = makeOtherEvent("agent:idle", "");
    const action = workspaceEventAccepted(event);

    await expectSaga(handleAgentLifecycleForSummary, action).run();

    expect(onAgentLifecycleChangedMock).not.toHaveBeenCalled();
  });

  it("ignores events when the workspaceId cannot be restored", async () => {
    restoreWorkspaceIdMock.mockReturnValueOnce(undefined);

    const action = workspaceEventAccepted(
      makeOtherEvent("agent:status-changed", "invalid-workspace"),
    );

    await expectSaga(handleAgentLifecycleForSummary, action).run();

    expect(restoreWorkspaceIdMock).toHaveBeenCalledWith("invalid-workspace");
    expect(onAgentLifecycleChangedMock).not.toHaveBeenCalled();
  });

  it("swallows errors thrown by onAgentLifecycleChanged", async () => {
    onAgentLifecycleChangedMock.mockImplementationOnce(() => {
      throw new Error("boom");
    });

    const action = workspaceEventAccepted(
      makeOtherEvent("agent:status-changed", "ws-err"),
    );

    await expect(
      expectSaga(handleAgentLifecycleForSummary, action).run(),
    ).resolves.toBeDefined();

    expect(onAgentLifecycleChangedMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      "[SUMMARY-INVALIDATION] Error invalidating workspace summary for agent event",
      expect.any(Error),
      { workspaceId: "ws-err", eventType: "agent:status-changed" },
    );
  });
});
