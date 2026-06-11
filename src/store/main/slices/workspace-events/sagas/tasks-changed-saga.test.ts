import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { call } from "typed-redux-saga";
import type { WorkspaceEvent } from "../../../../../features/events/types";
import { workspaceEventAccepted } from "../workspace-events-slice";
import {
  TASKS_CHANGED_DEBOUNCE_MS,
  clearPendingTasksChangedTimers,
  handleTasksChangedEvent,
  scheduleTasksChangedBroadcast,
} from "./tasks-changed-saga";

const sendToWorkspaceWindowsMock = vi.fn();

vi.mock("../../../../../features/system/main/system.ipc", () => ({
  sendToWorkspaceWindows: (...args: unknown[]) => sendToWorkspaceWindowsMock(...args),
}));

const makeEvent = (
  id: string,
  type: string,
  workspaceId: string | undefined = "ws-1",
): WorkspaceEvent =>
  ({
    id,
    type,
    workspaceId,
    timestamp: new Date().toISOString(),
    actor: { type: "user", id: "user-1", name: "Test User" },
  }) as unknown as WorkspaceEvent;

describe("handleTasksChangedEvent", () => {
  const TASK_AFFECTING_TYPES = [
    "task:status-changed",
    "note:created",
    "note:updated",
    "note:deleted",
  ];

  for (const eventType of TASK_AFFECTING_TYPES) {
    it(`schedules a broadcast for ${eventType}`, () => {
      const action = workspaceEventAccepted(makeEvent("e1", eventType));
      const gen = handleTasksChangedEvent(action);

      expect(gen.next().value).toEqual(
        call(scheduleTasksChangedBroadcast, "ws-1").next().value,
      );
      expect(gen.next().done).toBe(true);
    });
  }

  it("ignores non-task-affecting events", () => {
    const action = workspaceEventAccepted(makeEvent("e1", "file:changed"));
    const gen = handleTasksChangedEvent(action);

    expect(gen.next().done).toBe(true);
  });

  it("ignores events without a workspaceId", () => {
    const event = makeEvent("e1", "task:status-changed");
    delete (event as { workspaceId?: string }).workspaceId;
    const action = workspaceEventAccepted(event);
    const gen = handleTasksChangedEvent(action);

    expect(gen.next().done).toBe(true);
  });
});

describe("scheduleTasksChangedBroadcast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sendToWorkspaceWindowsMock.mockClear();
  });

  afterEach(() => {
    clearPendingTasksChangedTimers();
    vi.useRealTimers();
  });

  it("broadcasts 'workspace:tasks-changed' to the workspace after the debounce window", async () => {
    scheduleTasksChangedBroadcast("ws-1");

    expect(sendToWorkspaceWindowsMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(TASKS_CHANGED_DEBOUNCE_MS + 1);

    expect(sendToWorkspaceWindowsMock).toHaveBeenCalledTimes(1);
    expect(sendToWorkspaceWindowsMock).toHaveBeenCalledWith(
      "ws-1",
      "workspace:tasks-changed",
      { workspaceId: "ws-1" },
    );
  });

  it("coalesces rapid events for the same workspace into one broadcast", async () => {
    scheduleTasksChangedBroadcast("ws-1");
    await vi.advanceTimersByTimeAsync(100);
    scheduleTasksChangedBroadcast("ws-1");
    await vi.advanceTimersByTimeAsync(100);
    scheduleTasksChangedBroadcast("ws-1");

    await vi.advanceTimersByTimeAsync(TASKS_CHANGED_DEBOUNCE_MS + 1);

    expect(sendToWorkspaceWindowsMock).toHaveBeenCalledTimes(1);
  });

  it("broadcasts separately per workspace", async () => {
    scheduleTasksChangedBroadcast("ws-1");
    scheduleTasksChangedBroadcast("ws-2");

    await vi.advanceTimersByTimeAsync(TASKS_CHANGED_DEBOUNCE_MS + 1);

    expect(sendToWorkspaceWindowsMock).toHaveBeenCalledTimes(2);
    const targets = sendToWorkspaceWindowsMock.mock.calls.map(([wsId]) => wsId);
    expect(targets).toContain("ws-1");
    expect(targets).toContain("ws-2");
  });

  it("clearPendingTasksChangedTimers cancels pending broadcasts", async () => {
    scheduleTasksChangedBroadcast("ws-1");
    clearPendingTasksChangedTimers();

    await vi.advanceTimersByTimeAsync(TASKS_CHANGED_DEBOUNCE_MS * 2);

    expect(sendToWorkspaceWindowsMock).not.toHaveBeenCalled();
  });
});

