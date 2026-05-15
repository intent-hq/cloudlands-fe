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
  const LoggerMock = vi.fn(function LoggerMock() {
    return { error: loggerErrorMock };
  });

  return {
    handleAgentIdleMock,
    getNotificationServiceMock,
    onAgentLifecycleChangedMock,
    restoreWorkspaceIdMock,
    LoggerMock,
    loggerErrorMock,
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

import {
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
