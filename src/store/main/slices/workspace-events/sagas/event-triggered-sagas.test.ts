import { describe, expect, it, vi, beforeEach } from "vitest";
import { expectSaga } from "redux-saga-test-plan";
import type { WorkspaceEvent } from "../../../../../features/events/types";
import { workspaceEventAccepted } from "../workspace-events-slice";
import { handleAgentIdleNotification } from "./event-triggered-sagas";

// ---------------------------------------------------------------------------
// Hoisted mocks for the dynamic import of the notification service.
// ---------------------------------------------------------------------------

const handleAgentIdleMock = vi.fn();
const getNotificationServiceMock = vi.fn(() => ({
  handleAgentIdle: handleAgentIdleMock,
}));

vi.mock(
  "../../../../../features/notifications/main/notification.service",
  () => ({
    getNotificationService: (workspaceId: string) =>
      getNotificationServiceMock(workspaceId),
  }),
);

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
