import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreateNoteRequest } from "$shared/types";

// FAKE transport only: the backend bridge is mocked so no note mutation ever
// reaches the user's real daemon. `resolveNoteWorkspaceId` is stubbed so
// note-scoped mutations resolve deterministically without extra list calls;
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
import { LiveNotesClient, normalizeNote } from "./live-notes-client";

const mockedRequest = vi.mocked(backendRequest);
const mockedResolve = vi.mocked(resolveNoteWorkspaceId);

describe("LiveNotesClient mutations (fake transport)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockedResolve.mockResolvedValue("ws-1");
  });

  it("create forwards note.create with the request + an idempotencyKey", async () => {
    mockedRequest.mockResolvedValueOnce({ id: "note-1" });
    const client = new LiveNotesClient();

    const result = await client.create({
      workspaceId: "ws-1",
      title: "T",
      content: "C",
    } as CreateNoteRequest);

    expect(result).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith(
      "note.create",
      expect.objectContaining({
        workspaceId: "ws-1",
        title: "T",
        content: "C",
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it("create generates a distinct idempotencyKey per call", async () => {
    mockedRequest.mockResolvedValue({ id: "note-x" });
    const client = new LiveNotesClient();

    await client.create({ workspaceId: "ws-1", title: "A", content: "" } as CreateNoteRequest);
    await client.create({ workspaceId: "ws-1", title: "B", content: "" } as CreateNoteRequest);

    const first = (mockedRequest.mock.calls[0][1] as { idempotencyKey: string }).idempotencyKey;
    const second = (mockedRequest.mock.calls[1][1] as { idempotencyKey: string }).idempotencyKey;
    expect(first).not.toEqual(second);
  });

  it("setContent resolves the workspace and forwards note.setContent", async () => {
    mockedRequest.mockResolvedValueOnce({ id: "note-1" });
    const client = new LiveNotesClient();

    expect(await client.setContent("note-1", "hello")).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith("note.setContent", {
      workspaceId: "ws-1",
      noteId: "note-1",
      content: "hello",
    });
  });

  it("add forwards note.add with heading/position only when provided", async () => {
    mockedRequest.mockResolvedValue({ id: "note-1" });
    const client = new LiveNotesClient();

    await client.add("note-1", "body", { position: "end" });
    expect(mockedRequest).toHaveBeenLastCalledWith("note.add", {
      workspaceId: "ws-1",
      noteId: "note-1",
      content: "body",
      position: "end",
    });

    await client.add("note-1", "body");
    expect(mockedRequest).toHaveBeenLastCalledWith("note.add", {
      workspaceId: "ws-1",
      noteId: "note-1",
      content: "body",
    });
  });

  it("edit forwards note.edit with old/new", async () => {
    mockedRequest.mockResolvedValueOnce({ id: "note-1" });
    const client = new LiveNotesClient();

    await client.edit("note-1", "foo", "bar");
    expect(mockedRequest).toHaveBeenCalledWith("note.edit", {
      workspaceId: "ws-1",
      noteId: "note-1",
      old: "foo",
      new: "bar",
    });
  });

  it("editLines forwards note.editLines with the inclusive range", async () => {
    mockedRequest.mockResolvedValueOnce({ id: "note-1" });
    const client = new LiveNotesClient();

    await client.editLines("note-1", 2, 5, "x");
    expect(mockedRequest).toHaveBeenCalledWith("note.editLines", {
      workspaceId: "ws-1",
      noteId: "note-1",
      start: 2,
      end: 5,
      content: "x",
    });
  });

  it("delete forwards note.delete", async () => {
    mockedRequest.mockResolvedValueOnce({ id: "note-1" });
    const client = new LiveNotesClient();

    expect(await client.delete("note-1")).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith("note.delete", {
      workspaceId: "ws-1",
      noteId: "note-1",
    });
  });

  it("updateMetadata forwards note.updateMetadata with title/tags", async () => {
    mockedRequest.mockResolvedValueOnce({ id: "note-1" });
    const client = new LiveNotesClient();

    await client.updateMetadata("note-1", { title: "New", tags: ["a"] });
    expect(mockedRequest).toHaveBeenCalledWith("note.updateMetadata", {
      workspaceId: "ws-1",
      noteId: "note-1",
      title: "New",
      tags: ["a"],
    });
  });

  it("fails a note-scoped mutation when the workspace cannot be resolved", async () => {
    mockedResolve.mockResolvedValueOnce(null);
    const client = new LiveNotesClient();

    const result = await client.setContent("ghost", "x");
    expect(result.success).toBe(false);
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it("maps a daemon error to a failed MutationResult without throwing", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("boom"));
    const client = new LiveNotesClient();

    expect(await client.delete("note-1")).toEqual({ success: false, error: "boom" });
  });

  // ---- §11.4-D: rev normalization (inert; read-only carry-through) ----------

  it("normalizeNote carries a numeric rev when the daemon returns one", () => {
    const note = normalizeNote({ id: "note-1", title: "T", rev: 7 }, "ws-1");
    expect(note.rev).toBe(7);
  });

  it("normalizeNote leaves rev undefined when the daemon omits it", () => {
    const note = normalizeNote({ id: "note-1", title: "T" }, "ws-1");
    expect(note.rev).toBeUndefined();
  });

  it("normalizeNote ignores a non-numeric rev (preserves last-writer-wins)", () => {
    const note = normalizeNote({ id: "note-1", title: "T", rev: "9" }, "ws-1");
    expect(note.rev).toBeUndefined();
  });

  // ---- §11.4-D: expectedVersion forwarding (only when defined) --------------

  it("setContent forwards expectedVersion when provided", async () => {
    mockedRequest.mockResolvedValueOnce({ id: "note-1" });
    const client = new LiveNotesClient();

    await client.setContent("note-1", "hello", 4);
    expect(mockedRequest).toHaveBeenCalledWith("note.setContent", {
      workspaceId: "ws-1",
      noteId: "note-1",
      content: "hello",
      expectedVersion: 4,
    });
  });

  it("setContent omits expectedVersion when undefined (unchanged behavior)", async () => {
    mockedRequest.mockResolvedValueOnce({ id: "note-1" });
    const client = new LiveNotesClient();

    await client.setContent("note-1", "hello");
    const params = mockedRequest.mock.calls[0][1] as Record<string, unknown>;
    expect("expectedVersion" in params).toBe(false);
  });

  it("updateMetadata forwards expectedVersion when provided", async () => {
    mockedRequest.mockResolvedValueOnce({ id: "note-1" });
    const client = new LiveNotesClient();

    await client.updateMetadata("note-1", { title: "New" }, 2);
    expect(mockedRequest).toHaveBeenCalledWith("note.updateMetadata", {
      workspaceId: "ws-1",
      noteId: "note-1",
      title: "New",
      expectedVersion: 2,
    });
  });

  it("delete forwards expectedVersion when provided", async () => {
    mockedRequest.mockResolvedValueOnce({ id: "note-1" });
    const client = new LiveNotesClient();

    await client.delete("note-1", 5);
    expect(mockedRequest).toHaveBeenCalledWith("note.delete", {
      workspaceId: "ws-1",
      noteId: "note-1",
      expectedVersion: 5,
    });
  });

  // ---- §11.4-D: optimistic-concurrency conflict mapping --------------------
  // A simulated daemon conflict (-32005 + data.code "conflict") must surface a
  // structured conflict outcome carrying the NORMALIZED authoritative note —
  // NOT collapse into the generic error string.

  function rejectWith(extra: Record<string, unknown>, message = "conflict"): void {
    mockedRequest.mockRejectedValueOnce(Object.assign(new Error(message), extra));
  }

  it("maps a -32005 conflict to a structured outcome with the normalized current note", async () => {
    rejectWith({
      rpcCode: -32005,
      data: { code: "conflict", current: { id: "note-1", title: "Server", content: "srv", rev: 7 } },
    });
    const client = new LiveNotesClient();

    const result = await client.setContent("note-1", "mine", 3);
    expect(result.success).toBe(false);
    expect(result.error).toBe("conflict");
    expect(result.conflict?.current).toMatchObject({
      id: "note-1",
      title: "Server",
      content: "srv",
      rev: 7,
      workspaceId: "ws-1",
    });
  });

  it("does NOT set conflict for a generic (non -32005) daemon error", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("boom"));
    const client = new LiveNotesClient();

    const result = await client.setContent("note-1", "mine", 3);
    expect(result).toEqual({ success: false, error: "boom" });
  });

  it("does NOT set conflict when -32005 lacks data.code 'conflict'", async () => {
    rejectWith({ rpcCode: -32005, data: { code: "SERVER_ERROR" } }, "server error");
    const client = new LiveNotesClient();

    const result = await client.updateMetadata("note-1", { title: "X" }, 1);
    expect(result.success).toBe(false);
    expect(result.conflict).toBeUndefined();
  });
});
