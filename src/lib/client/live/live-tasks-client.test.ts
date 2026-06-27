import { afterEach, describe, expect, it, vi } from "vitest";

// FAKE transport only: the backend bridge is mocked so no task mutation ever
// reaches the user's real daemon. `resolveNoteWorkspaceId` is stubbed so
// note-scoped task mutations resolve deterministically without extra list calls;
// `runMutation` / `newIdempotencyKey` stay real so the asserted method + params
// and the success/error folding are the genuine code paths.
vi.mock("./backend-transport", () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(() => Promise.resolve({ subscriptionId: "sub-1" })),
  backendUnsubscribe: vi.fn(() => Promise.resolve()),
  onBackendNotification: vi.fn(() => () => {}),
}));

vi.mock("./live-support", async (importActual) => {
  const actual = await importActual<typeof import("./live-support")>();
  return { ...actual, resolveNoteWorkspaceId: vi.fn(() => Promise.resolve("ws-1")) };
});

import { backendRequest } from "./backend-transport";
import { resolveNoteWorkspaceId } from "./live-support";
import { LiveTasksClient } from "./live-tasks-client";

const mockedRequest = vi.mocked(backendRequest);
const mockedResolve = vi.mocked(resolveNoteWorkspaceId);

describe("LiveTasksClient mutations (fake transport)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockedResolve.mockResolvedValue("ws-1");
  });

  it("updateStatus resolves the workspace and forwards task.updateStatus", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveTasksClient();

    expect(await client.updateStatus("note-1", "Do the thing", "done")).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith("task.updateStatus", {
      workspaceId: "ws-1",
      noteId: "note-1",
      taskText: "Do the thing",
      status: "done",
    });
  });

  it("update forwards task.update with line and only the provided patch fields", async () => {
    mockedRequest.mockResolvedValue({ ok: true });
    const client = new LiveTasksClient();

    await client.update("note-1", 3, { status: "in-progress" });
    expect(mockedRequest).toHaveBeenLastCalledWith("task.update", {
      workspaceId: "ws-1",
      noteId: "note-1",
      line: 3,
      status: "in-progress",
    });

    await client.update("note-1", 4, { text: "new text", expected: "old text" });
    expect(mockedRequest).toHaveBeenLastCalledWith("task.update", {
      workspaceId: "ws-1",
      noteId: "note-1",
      line: 4,
      text: "new text",
      expected: "old text",
    });
  });

  it("updateNoteStatus forwards task.updateNoteStatus with the TaskStatus enum", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveTasksClient();

    expect(await client.updateNoteStatus("note-1", "in_progress")).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith("task.updateNoteStatus", {
      workspaceId: "ws-1",
      noteId: "note-1",
      status: "in_progress",
    });
  });

  it("markAsTask forwards task.markAsTask with acceptanceCriteria/effort only when provided", async () => {
    mockedRequest.mockResolvedValue({ ok: true });
    const client = new LiveTasksClient();

    await client.markAsTask("note-1", "not_started", {
      acceptanceCriteria: ["a", "b"],
      effort: "M",
    });
    expect(mockedRequest).toHaveBeenLastCalledWith("task.markAsTask", {
      workspaceId: "ws-1",
      noteId: "note-1",
      status: "not_started",
      acceptanceCriteria: ["a", "b"],
      effort: "M",
    });

    await client.markAsTask("note-1", "not_started");
    expect(mockedRequest).toHaveBeenLastCalledWith("task.markAsTask", {
      workspaceId: "ws-1",
      noteId: "note-1",
      status: "not_started",
    });
  });

  it("assignAgent forwards task.assignAgent with the agentId", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveTasksClient();

    await client.assignAgent("note-1", "agent-123");
    expect(mockedRequest).toHaveBeenCalledWith("task.assignAgent", {
      workspaceId: "ws-1",
      noteId: "note-1",
      agentId: "agent-123",
    });
  });

  it("createPrerequisite forwards task.createPrerequisite with an idempotencyKey", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveTasksClient();

    const result = await client.createPrerequisite("dep-1", "Prereq title", {
      content: "body",
      status: "not_started",
    });

    expect(result).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith(
      "task.createPrerequisite",
      expect.objectContaining({
        workspaceId: "ws-1",
        dependentNoteId: "dep-1",
        title: "Prereq title",
        content: "body",
        status: "not_started",
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it("createPrerequisite generates a distinct idempotencyKey per call", async () => {
    mockedRequest.mockResolvedValue({ ok: true });
    const client = new LiveTasksClient();

    await client.createPrerequisite("dep-1", "A");
    await client.createPrerequisite("dep-1", "B");

    const first = (mockedRequest.mock.calls[0][1] as { idempotencyKey: string }).idempotencyKey;
    const second = (mockedRequest.mock.calls[1][1] as { idempotencyKey: string }).idempotencyKey;
    expect(first).not.toEqual(second);
  });

  it("createPrerequisite surfaces the WorkspaceTask id from the daemon response", async () => {
    mockedRequest.mockResolvedValueOnce({ id: "task-77", title: "Prereq", status: "not_started" });
    const client = new LiveTasksClient();

    expect(await client.createPrerequisite("dep-1", "Prereq")).toEqual({
      success: true,
      id: "task-77",
    });
  });

  it("note-scoped mutations surface the returned WorkspaceTask id", async () => {
    mockedRequest.mockResolvedValueOnce({ id: "note-1", title: "T", status: "not_started" });
    const client = new LiveTasksClient();

    expect(await client.markAsTask("note-1", "not_started")).toEqual({
      success: true,
      id: "note-1",
    });
  });

  it("fails a task mutation when the workspace cannot be resolved", async () => {
    mockedResolve.mockResolvedValueOnce(null);
    const client = new LiveTasksClient();

    const result = await client.updateNoteStatus("ghost", "complete");
    expect(result.success).toBe(false);
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it("maps a daemon error to a failed MutationResult without throwing", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("boom"));
    const client = new LiveTasksClient();

    expect(await client.updateNoteStatus("note-1", "complete")).toEqual({
      success: false,
      error: "boom",
    });
  });

  // ---- §11.4-D: rev normalization (inert; read-only carry-through) ----------

  it("list carries a numeric rev from the daemon note onto the WorkspaceTask", async () => {
    mockedRequest.mockResolvedValueOnce({
      notes: [{ id: "note-1", title: "T", metadata: { task: { status: "not_started" } }, rev: 3 }],
    });
    const client = new LiveTasksClient();

    const [task] = await client.list("ws-1");
    expect(task.rev).toBe(3);
  });

  it("list leaves rev undefined when the daemon omits it", async () => {
    mockedRequest.mockResolvedValueOnce({
      notes: [{ id: "note-1", title: "T", metadata: { task: { status: "not_started" } } }],
    });
    const client = new LiveTasksClient();

    const [task] = await client.list("ws-1");
    expect(task.rev).toBeUndefined();
  });

  // ---- §11.4-D: expectedVersion forwarding (only when defined) --------------

  it("updateStatus forwards expectedVersion when provided", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveTasksClient();

    await client.updateStatus("note-1", "Do the thing", "done", 6);
    expect(mockedRequest).toHaveBeenCalledWith("task.updateStatus", {
      workspaceId: "ws-1",
      noteId: "note-1",
      taskText: "Do the thing",
      status: "done",
      expectedVersion: 6,
    });
  });

  it("updateNoteStatus forwards expectedVersion when provided", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveTasksClient();

    await client.updateNoteStatus("note-1", "in_progress", 2);
    expect(mockedRequest).toHaveBeenCalledWith("task.updateNoteStatus", {
      workspaceId: "ws-1",
      noteId: "note-1",
      status: "in_progress",
      expectedVersion: 2,
    });
  });

  it("updateNoteStatus omits expectedVersion when undefined (unchanged behavior)", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveTasksClient();

    await client.updateNoteStatus("note-1", "in_progress");
    const params = mockedRequest.mock.calls[0][1] as Record<string, unknown>;
    expect("expectedVersion" in params).toBe(false);
  });
});
