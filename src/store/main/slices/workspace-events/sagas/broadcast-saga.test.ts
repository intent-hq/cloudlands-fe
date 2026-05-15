import {
  describe,
  expect,
  it,
  vi,
  beforeEach,
} from "vitest";
import type { WorkspaceEvent } from "../../../../../features/events/types";

// ---------------------------------------------------------------------------
// Shared mock — hoisted so broadcastEvent's dynamic import always gets it
// ---------------------------------------------------------------------------

const sendToWorkspaceWindowsMock = vi.fn();

vi.mock("../../../../../features/system/main/system.ipc", () => ({
  sendToWorkspaceWindows: (...args: unknown[]) => sendToWorkspaceWindowsMock(...args),
}));
vi.mock("../../../../../features/events/main/stdio-connection", () => ({
  getStdioConnection: () => null,
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const makeEvent = (
  id: string,
  type = "file:changed",
  workspaceId: string | undefined = "ws-1",
): WorkspaceEvent =>
  ({
    id,
    type,
    workspaceId,
    timestamp: new Date().toISOString(),
    actor: { type: "user", id: "user-1", name: "Test User" },
    data: { path: "/test.ts", relativePath: "test.ts", action: "modify" },
  }) as unknown as WorkspaceEvent;

// ---------------------------------------------------------------------------
// broadcastEvent — global vs workspace-scoped routing
// ---------------------------------------------------------------------------

describe("broadcastEvent global routing", () => {
  beforeEach(() => {
    sendToWorkspaceWindowsMock.mockClear();
  });

  const GLOBAL_EVENT_TYPES = [
    "agent:subscribed",
    "agent:unsubscribed",
    "agent:subscriptions-changed",
    "agent:status-changed",
  ];

  for (const eventType of GLOBAL_EVENT_TYPES) {
    it(`broadcasts ${eventType} globally (workspaceId=undefined)`, async () => {
      const { broadcastEvent } = await import("./broadcast-saga");
      const event = makeEvent("e1", eventType);
      await broadcastEvent(event);

      // Both calls (events:new + specific channel) should use undefined workspaceId
      expect(sendToWorkspaceWindowsMock).toHaveBeenCalledTimes(2);

      const [firstCallWsId] = sendToWorkspaceWindowsMock.mock.calls[0];
      const [secondCallWsId] = sendToWorkspaceWindowsMock.mock.calls[1];
      expect(firstCallWsId).toBeUndefined();
      expect(secondCallWsId).toBeUndefined();
    });
  }

  const WORKSPACE_SCOPED_EVENT_TYPES = [
    "file:changed",
    "agent:started",
    "agent:completed",
    "note:created",
    "task:status-changed",
  ];

  for (const eventType of WORKSPACE_SCOPED_EVENT_TYPES) {
    it(`broadcasts ${eventType} workspace-scoped (workspaceId="ws-1")`, async () => {
      const { broadcastEvent } = await import("./broadcast-saga");
      const event = makeEvent("e1", eventType);
      await broadcastEvent(event);

      expect(sendToWorkspaceWindowsMock).toHaveBeenCalledTimes(2);

      const [firstCallWsId] = sendToWorkspaceWindowsMock.mock.calls[0];
      const [secondCallWsId] = sendToWorkspaceWindowsMock.mock.calls[1];
      expect(firstCallWsId).toBe("ws-1");
      expect(secondCallWsId).toBe("ws-1");
    });
  }

  it("sends on both events:new and specific type channels", async () => {
    const { broadcastEvent } = await import("./broadcast-saga");
    const event = makeEvent("e1", "file:changed", "ws-1");
    await broadcastEvent(event);

    expect(sendToWorkspaceWindowsMock).toHaveBeenCalledTimes(2);

    const [, firstChannel, firstData] = sendToWorkspaceWindowsMock.mock.calls[0];
    expect(firstChannel).toBe("events:new");
    expect(firstData).toEqual({ workspaceId: "ws-1", event });

    const [, secondChannel, secondData] = sendToWorkspaceWindowsMock.mock.calls[1];
    expect(secondChannel).toBe("file:changed");
    expect(secondData).toBe(event);
  });

  it("handles events with no workspaceId gracefully", async () => {
    const { broadcastEvent } = await import("./broadcast-saga");
    const event = {
      ...makeEvent("e1", "file:changed"),
      workspaceId: undefined,
    } as unknown as WorkspaceEvent;
    await broadcastEvent(event);

    // Should not throw, and should broadcast with undefined workspaceId
    expect(sendToWorkspaceWindowsMock).toHaveBeenCalledTimes(2);
    const [firstCallWsId] = sendToWorkspaceWindowsMock.mock.calls[0];
    expect(firstCallWsId).toBeUndefined();
  });

  it("global events preserve workspaceId in the payload even though routing is global", async () => {
    const { broadcastEvent } = await import("./broadcast-saga");
    const event = makeEvent("e1", "agent:subscribed", "ws-42");
    await broadcastEvent(event);

    // Routing is global (undefined), but payload still has workspaceId
    const [routeWsId, , payload] = sendToWorkspaceWindowsMock.mock.calls[0];
    expect(routeWsId).toBeUndefined();
    expect(payload.workspaceId).toBe("ws-42");
    expect(payload.event.workspaceId).toBe("ws-42");
  });
});
