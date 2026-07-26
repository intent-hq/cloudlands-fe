import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateNoteRequest } from "$shared/types";

// FAKE transport only: the backend bridge is mocked so no note mutation ever
// reaches the user's real daemon. `resolveNoteWorkspaceId` is stubbed so
// note-scoped mutations resolve deterministically without extra list calls;
// `runMutation` / `newIdempotencyKey` stay real so the asserted method + params
// and the success/error folding are the genuine code paths. Notification /
// reconnect handlers are captured as LISTS — `subscribe` registers two
// listeners (the delta subscription's and the workspace-id source's) — so the
// typed §6.9 channel tests can drive pushes and legacy events to both.
let notifyHandlers: Array<(n: { method: string; params?: unknown }) => void> = [];
let reconnectHandlers: Array<() => void> = [];
let liveStateCapability = false;

vi.mock("./backend-transport", () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(() => Promise.resolve({ subscriptionId: "sub-1" })),
  backendUnsubscribe: vi.fn(() => Promise.resolve()),
  onBackendNotification: vi.fn((handler: (n: { method: string; params?: unknown }) => void) => {
    notifyHandlers.push(handler);
    return () => {
      notifyHandlers = notifyHandlers.filter((h) => h !== handler);
    };
  }),
  onBackendReconnected: vi.fn((handler: () => void) => {
    reconnectHandlers.push(handler);
    return () => {
      reconnectHandlers = reconnectHandlers.filter((h) => h !== handler);
    };
  }),
  detectLiveStateCapability: vi.fn(() => Promise.resolve(liveStateCapability)),
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

  // Round-5 regression: note ids are not globally unique (every workspace has
  // a `spec` note) and the resolver cache is last-writer-wins across
  // workspaces, so a caller-supplied workspaceId must win over the cache —
  // otherwise a debounced save can target (and conflict against) another
  // workspace's same-id note.
  it("setContent uses the caller's explicit workspaceId over the resolver cache", async () => {
    mockedRequest.mockResolvedValueOnce({ id: "spec" });
    mockedResolve.mockResolvedValue("other-workspace");
    const client = new LiveNotesClient();

    await client.setContent("spec", "hello", 4, "comment-add");

    expect(mockedResolve).not.toHaveBeenCalled();
    expect(mockedRequest).toHaveBeenCalledWith("note.setContent", {
      workspaceId: "comment-add",
      noteId: "spec",
      content: "hello",
      expectedVersion: 4,
    });
  });

  it("updateMetadata and delete use the caller's explicit workspaceId over the resolver cache", async () => {
    mockedRequest.mockResolvedValue({ id: "spec" });
    mockedResolve.mockResolvedValue("other-workspace");
    const client = new LiveNotesClient();

    await client.updateMetadata("spec", { title: "T" }, undefined, "comment-add");
    await client.delete("spec", undefined, "comment-add");

    expect(mockedResolve).not.toHaveBeenCalled();
    expect(mockedRequest).toHaveBeenNthCalledWith(
      1,
      "note.updateMetadata",
      expect.objectContaining({ workspaceId: "comment-add", noteId: "spec" }),
    );
    expect(mockedRequest).toHaveBeenNthCalledWith(
      2,
      "note.delete",
      expect.objectContaining({ workspaceId: "comment-add", noteId: "spec" }),
    );
  });

  // monorepo#621 (Round 7d): the remaining note-scoped call sites — get, add,
  // edit, editLines — must also honor a caller-supplied workspaceId over the
  // poisoned last-writer-wins resolver cache.
  it("get uses the caller's explicit workspaceId over the resolver cache", async () => {
    mockedRequest.mockResolvedValueOnce({ note: { id: "spec", title: "T" } });
    mockedResolve.mockResolvedValue("other-workspace");
    const client = new LiveNotesClient();

    const note = await client.get("spec", "comment-add");

    expect(mockedResolve).not.toHaveBeenCalled();
    expect(mockedRequest).toHaveBeenCalledWith("note.get", {
      workspaceId: "comment-add",
      noteId: "spec",
    });
    expect(note?.workspaceId).toBe("comment-add");
  });

  it("add uses the caller's explicit workspaceId over the resolver cache", async () => {
    mockedRequest.mockResolvedValueOnce({ id: "spec" });
    mockedResolve.mockResolvedValue("other-workspace");
    const client = new LiveNotesClient();

    await client.add("spec", "body", { position: "end" }, 4, "comment-add");

    expect(mockedResolve).not.toHaveBeenCalled();
    expect(mockedRequest).toHaveBeenCalledWith("note.add", {
      workspaceId: "comment-add",
      noteId: "spec",
      content: "body",
      position: "end",
      expectedVersion: 4,
    });
  });

  it("edit uses the caller's explicit workspaceId over the resolver cache", async () => {
    mockedRequest.mockResolvedValueOnce({ id: "spec" });
    mockedResolve.mockResolvedValue("other-workspace");
    const client = new LiveNotesClient();

    await client.edit("spec", "foo", "bar", undefined, "comment-add");

    expect(mockedResolve).not.toHaveBeenCalled();
    expect(mockedRequest).toHaveBeenCalledWith("note.edit", {
      workspaceId: "comment-add",
      noteId: "spec",
      old: "foo",
      new: "bar",
    });
  });

  it("editLines uses the caller's explicit workspaceId over the resolver cache", async () => {
    mockedRequest.mockResolvedValueOnce({ id: "spec" });
    mockedResolve.mockResolvedValue("other-workspace");
    const client = new LiveNotesClient();

    await client.editLines("spec", 2, 5, "x", undefined, "comment-add");

    expect(mockedResolve).not.toHaveBeenCalled();
    expect(mockedRequest).toHaveBeenCalledWith("note.editLines", {
      workspaceId: "comment-add",
      noteId: "spec",
      start: 2,
      end: 5,
      content: "x",
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

  it("maps a -32005 conflict on updateMetadata to a structured outcome with the normalized current note", async () => {
    rejectWith({
      rpcCode: -32005,
      data: { code: "conflict", current: { id: "note-1", title: "Server", rev: 6 } },
    });
    const client = new LiveNotesClient();

    const result = await client.updateMetadata("note-1", { title: "Mine" }, 2);
    expect(result.success).toBe(false);
    expect(result.error).toBe("conflict");
    expect(result.conflict?.current).toMatchObject({
      id: "note-1",
      title: "Server",
      rev: 6,
      workspaceId: "ws-1",
    });
  });

  it("maps a -32005 conflict on delete to a structured outcome with the normalized current note", async () => {
    rejectWith({
      rpcCode: -32005,
      data: { code: "conflict", current: { id: "note-1", title: "Server", rev: 11 } },
    });
    const client = new LiveNotesClient();

    const result = await client.delete("note-1", 5);
    expect(result.success).toBe(false);
    expect(result.error).toBe("conflict");
    expect(result.conflict?.current).toMatchObject({
      id: "note-1",
      title: "Server",
      rev: 11,
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

  // ---- §5.2 version history: listVersions + restoreVersion ---------------

  it("listVersions calls note.listVersions then batches note.getVersion per entry (FE-shape)", async () => {
    // First call → summaries; the client then batches getVersion for each `v`.
    mockedRequest.mockImplementation(async (method: string, params: Record<string, unknown>) => {
      if (method === "note.listVersions") {
        return [
          { type: "snapshot", v: 1, date: "2026-01-01T00:00:00.000Z", author: { id: "u", name: "U", type: "user" }, title: "T1", contentLength: 4 },
          { type: "snapshot", v: 2, date: "2026-01-02T00:00:00.000Z", author: { id: "a", name: "A", type: "agent" }, title: "T2", contentLength: 6 },
        ];
      }
      if (method === "note.getVersion") {
        const v = (params.v as number);
        return { type: "snapshot", v, date: `2026-01-0${v}T00:00:00.000Z`, author: { id: "x", name: "X", type: v === 1 ? "user" : "agent" }, title: `T${v}`, content: v === 1 ? "body" : "body-2" };
      }
      throw new Error(`unexpected ${method}`);
    });
    const client = new LiveNotesClient();

    const versions = await client.listVersions("ws-1", "note-1");

    expect(mockedRequest).toHaveBeenCalledWith("note.listVersions", { workspaceId: "ws-1", noteId: "note-1" });
    expect(mockedRequest).toHaveBeenCalledWith("note.getVersion", { workspaceId: "ws-1", noteId: "note-1", v: 1 });
    expect(mockedRequest).toHaveBeenCalledWith("note.getVersion", { workspaceId: "ws-1", noteId: "note-1", v: 2 });
    expect(versions).toEqual([
      { versionId: "1", versionNumber: 1, content: "body", title: "T1", author: { id: "x", name: "X", type: "user" }, createdAt: "2026-01-01T00:00:00.000Z" },
      { versionId: "2", versionNumber: 2, content: "body-2", title: "T2", author: { id: "x", name: "X", type: "agent" }, createdAt: "2026-01-02T00:00:00.000Z" },
    ]);
  });

  it("listVersions returns [] when the daemon reports no versions", async () => {
    mockedRequest.mockResolvedValueOnce([]);
    const client = new LiveNotesClient();

    const versions = await client.listVersions("ws-1", "note-1");
    expect(versions).toEqual([]);
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });

  it("listVersions drops a per-version getVersion failure but keeps the rest", async () => {
    mockedRequest.mockImplementation(async (method: string, params: Record<string, unknown>) => {
      if (method === "note.listVersions") {
        return [
          { type: "snapshot", v: 1, date: "2026-01-01T00:00:00.000Z", author: { id: "u", name: "U", type: "user" }, title: "T1", contentLength: 1 },
          { type: "snapshot", v: 2, date: "2026-01-02T00:00:00.000Z", author: { id: "u", name: "U", type: "user" }, title: "T2", contentLength: 1 },
        ];
      }
      if ((params.v as number) === 1) throw new Error("boom");
      return { type: "snapshot", v: 2, date: "2026-01-02T00:00:00.000Z", author: { id: "u", name: "U", type: "user" }, title: "T2", content: "b" };
    });
    const client = new LiveNotesClient();

    const versions = await client.listVersions("ws-1", "note-1");
    expect(versions.map((v) => v.versionNumber)).toEqual([2]);
  });

  it("restoreVersion forwards note.restoreVersion with numeric v and returns the normalized note", async () => {
    mockedRequest.mockResolvedValueOnce({
      ok: true,
      noteId: "note-1",
      restoredFrom: 2,
      v: 5,
      note: { id: "note-1", workspaceId: "ws-1", title: "T", content: "restored", rev: 5 },
    });
    const client = new LiveNotesClient();

    const result = await client.restoreVersion("ws-1", "note-1", "2");

    expect(mockedRequest).toHaveBeenCalledWith("note.restoreVersion", {
      workspaceId: "ws-1",
      noteId: "note-1",
      v: 2,
    });
    expect(result.success).toBe(true);
    expect(result.note?.content).toBe("restored");
    expect(result.note?.workspaceId).toBe("ws-1");
    expect(result.note?.rev).toBe(5);
  });

  it("restoreVersion rejects a non-numeric versionId without a wire call", async () => {
    const client = new LiveNotesClient();

    const result = await client.restoreVersion("ws-1", "note-1", "not-a-number");
    expect(result.success).toBe(false);
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it("restoreVersion folds a daemon error into a failed result without throwing", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("nope"));
    const client = new LiveNotesClient();

    const result = await client.restoreVersion("ws-1", "note-1", "3");
    expect(result).toEqual({ success: false, error: "nope" });
  });

  // ---- Line attribution (PROTOCOL §5.2.1) -------------------------------
  // `note.lineAttribution.load` returns the bare `LineAttributionData | null`
  // payload; the client passes `workspaceId` + `noteId` through directly
  // (no `resolveNoteWorkspaceId`, the gutter carries the workspaceId as a prop).

  it("lineAttribution.load forwards note.lineAttribution.load and returns the payload", async () => {
    const payload = {
      noteId: "note-1",
      workspaceId: "ws-1",
      computedAt: "2026-07-05T12:34:56.000Z",
      attributions: {
        "1": {
          timestamp: 1720193696000,
          author: { id: "system", name: "intentd", type: "system" as const },
        },
      },
    };
    mockedRequest.mockResolvedValueOnce(payload);
    const client = new LiveNotesClient();

    const result = await client.lineAttribution.load("ws-1", "note-1");

    expect(mockedRequest).toHaveBeenCalledWith("note.lineAttribution.load", {
      workspaceId: "ws-1",
      noteId: "note-1",
    });
    expect(result).toEqual(payload);
  });

  it("lineAttribution.load returns null when the daemon has no attributions yet", async () => {
    mockedRequest.mockResolvedValueOnce(null);
    const client = new LiveNotesClient();

    expect(await client.lineAttribution.load("ws-1", "note-1")).toBeNull();
  });

  it("lineAttribution.computeNow forwards note.lineAttribution.computeNow and returns { ok }", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveNotesClient();

    const result = await client.lineAttribution.computeNow("ws-1", "note-1");

    expect(mockedRequest).toHaveBeenCalledWith("note.lineAttribution.computeNow", {
      workspaceId: "ws-1",
      noteId: "note-1",
    });
    expect(result).toEqual({ ok: true });
  });
});

// ---- Typed per-workspace note channel (PROTOCOL §6.9, monorepo#775) --------
// On liveState daemons `subscribe` registers ONE `note.subscribe` per
// workspace id (`{ workspaceId }`), sourced from the same `workspace.list`
// enumeration `fetchAll` flattens over. Snapshots/deltas reconcile per
// channel and merge; workspace add/delete re-reconciles the channel set. The
// subscription is live only while EVERY channel is push-confirmed — any gap
// keeps legacy refetches serving.
describe("LiveNotesClient.subscribe typed per-workspace note channel (PROTOCOL §6.9)", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const requestsFor = (method: string) =>
    mockedRequest.mock.calls.filter((c) => c[0] === method).map((c) => c[1]);

  // PROTOCOL §9.1-shaped wire Note as carried by the §6.9 channel (camelCase
  // serde; `workspaceId` always present).
  const wireNote = (id: string, workspaceId: string, title: string) => ({
    id,
    workspaceId,
    title,
    content: `${title} body`,
    contentType: "markdown",
    tags: [],
    isPinned: false,
    isArchived: false,
    isDefault: false,
    parentId: null,
    visibility: "workspace",
    createdAt: "2026-01-01T00:00:00Z",
    rev: 1,
    updatedAt: "2026-01-01T00:00:00Z",
  });

  const notify = (n: { method: string; params?: unknown }) => {
    for (const handler of [...notifyHandlers]) handler(n);
  };
  const pushSnapshot = (subscriptionId: string, seq: number, snapshot: unknown[]) =>
    notify({ method: "subscription.push", params: { subscriptionId, kind: "snapshot", seq, snapshot } });
  const pushDelta = (subscriptionId: string, seq: number, delta: Record<string, unknown>) =>
    notify({ method: "subscription.push", params: { subscriptionId, kind: "delta", seq, delta } });
  const fireLegacy = (type: string) =>
    notify({ method: "events.event", params: { event: { type } } });

  // Mutable daemon fixture the mock serves: the workspace set and each
  // workspace's `note.list` rows (the legacy/bridging refetch source).
  let workspaceIds: string[] = [];
  let notesByWorkspace: Record<string, unknown[]> = {};
  let chanSeq = 0;

  beforeEach(() => {
    liveStateCapability = true;
    chanSeq = 0;
    workspaceIds = ["ws-1", "ws-2"];
    notesByWorkspace = {};
    mockedRequest.mockImplementation((method: string, params?: unknown) => {
      if (method === "workspace.list") {
        return Promise.resolve({ workspaces: workspaceIds.map((id) => ({ id })) });
      }
      if (method === "note.subscribe") {
        chanSeq += 1;
        return Promise.resolve({ subscriptionId: `chan-${chanSeq}` });
      }
      if (method === "note.unsubscribe") return Promise.resolve({ success: true });
      if (method === "note.list") {
        const wsId = (params as { workspaceId?: string })?.workspaceId ?? "";
        return Promise.resolve({ notes: notesByWorkspace[wsId] ?? [] });
      }
      return Promise.resolve({ success: true });
    });
  });

  afterEach(() => {
    liveStateCapability = false;
    notifyHandlers = [];
    reconnectHandlers = [];
    mockedRequest.mockReset();
    vi.clearAllMocks();
    mockedResolve.mockResolvedValue("ws-1");
  });

  it("registers one note.subscribe per workspace with { workspaceId } params", async () => {
    const client = new LiveNotesClient();
    const unsubscribe = client.subscribe(() => {});

    await vi.waitFor(() => {
      expect(requestsFor("note.subscribe")).toEqual([
        { workspaceId: "ws-1" },
        { workspaceId: "ws-2" },
      ]);
    });
    unsubscribe();
  });

  it("does not register channels on a daemon without liveState — legacy refetches keep serving", async () => {
    liveStateCapability = false;
    notesByWorkspace = { "ws-1": [wireNote("a", "ws-1", "A")] };
    workspaceIds = ["ws-1"];
    const handler = vi.fn();
    const client = new LiveNotesClient();
    const unsubscribe = client.subscribe(handler);

    // Initial one-shot refetch aggregates across workspaces as before.
    await vi.waitFor(() => expect(handler).toHaveBeenCalled());
    expect((handler.mock.calls.at(-1)?.[0] as Array<{ id: string }>).map((n) => n.id)).toEqual(["a"]);
    expect(requestsFor("note.subscribe")).toEqual([]);

    // A legacy note event still refetches.
    const listCallsBefore = requestsFor("note.list").length;
    fireLegacy("note:updated");
    await flush();
    expect(requestsFor("note.list").length).toBeGreaterThan(listCallsBefore);
    unsubscribe();
  });

  it("goes live only when every workspace channel is snapshot-confirmed, merging their notes", async () => {
    const handler = vi.fn();
    const client = new LiveNotesClient();
    const unsubscribe = client.subscribe(handler);
    await vi.waitFor(() => expect(requestsFor("note.subscribe")).toHaveLength(2));
    await flush();

    // Only chan-1 (ws-1) confirmed: not live yet — legacy events still refetch.
    pushSnapshot("chan-1", 0, [wireNote("a", "ws-1", "A")]);
    const listCallsBefore = requestsFor("note.list").length;
    fireLegacy("note:updated");
    await flush();
    expect(requestsFor("note.list").length).toBeGreaterThan(listCallsBefore);

    // chan-2 (ws-2) confirms: live — the merged cross-workspace collection emits.
    pushSnapshot("chan-2", 0, [wireNote("b", "ws-2", "B")]);
    const merged = handler.mock.calls.at(-1)?.[0] as Array<Record<string, unknown>>;
    expect(merged.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(merged.find((n) => n.id === "a")).toMatchObject({ workspaceId: "ws-1" });
    expect(merged.find((n) => n.id === "b")).toMatchObject({ workspaceId: "ws-2" });

    // Deltas reconcile per channel; legacy note events no longer refetch.
    pushDelta("chan-2", 1, { added: [wireNote("c", "ws-2", "C")] });
    const afterDelta = handler.mock.calls.at(-1)?.[0] as Array<{ id: string }>;
    expect(afterDelta.map((n) => n.id).sort()).toEqual(["a", "b", "c"]);
    const listCallsLive = requestsFor("note.list").length;
    fireLegacy("note:updated");
    await flush();
    expect(requestsFor("note.list")).toHaveLength(listCallsLive);
    unsubscribe();
  });

  it("a created workspace registers a new channel and merges its snapshot", async () => {
    workspaceIds = ["ws-1"];
    const handler = vi.fn();
    const client = new LiveNotesClient();
    const unsubscribe = client.subscribe(handler);
    await vi.waitFor(() => expect(requestsFor("note.subscribe")).toEqual([{ workspaceId: "ws-1" }]));
    await flush();
    pushSnapshot("chan-1", 0, [wireNote("a", "ws-1", "A")]);

    workspaceIds = ["ws-1", "ws-2"];
    fireLegacy("workspace:created");
    await vi.waitFor(() => {
      expect(requestsFor("note.subscribe")).toEqual([
        { workspaceId: "ws-1" },
        { workspaceId: "ws-2" },
      ]);
    });
    await flush();

    pushSnapshot("chan-2", 0, [wireNote("b", "ws-2", "B")]);
    const merged = handler.mock.calls.at(-1)?.[0] as Array<{ id: string }>;
    expect(merged.map((n) => n.id).sort()).toEqual(["a", "b"]);
    unsubscribe();
  });

  it("a deleted workspace unsubscribes its channel and evicts its notes", async () => {
    const handler = vi.fn();
    const client = new LiveNotesClient();
    const unsubscribe = client.subscribe(handler);
    await vi.waitFor(() => expect(requestsFor("note.subscribe")).toHaveLength(2));
    await flush();
    pushSnapshot("chan-1", 0, [wireNote("a", "ws-1", "A")]);
    pushSnapshot("chan-2", 0, [wireNote("b", "ws-2", "B")]);

    workspaceIds = ["ws-1"];
    fireLegacy("workspace:deleted");
    await vi.waitFor(() => {
      expect(requestsFor("note.unsubscribe")).toEqual([{ subscriptionId: "chan-2" }]);
    });
    const evicted = handler.mock.calls.at(-1)?.[0] as Array<{ id: string }>;
    expect(evicted.map((n) => n.id)).toEqual(["a"]);
    unsubscribe();
  });

  it("stays legacy while any channel registration fails — refetches keep serving", async () => {
    notesByWorkspace = {
      "ws-1": [wireNote("a", "ws-1", "A")],
      "ws-2": [wireNote("b", "ws-2", "B")],
    };
    mockedRequest.mockImplementation((method: string, params?: unknown) => {
      if (method === "workspace.list") {
        return Promise.resolve({ workspaces: workspaceIds.map((id) => ({ id })) });
      }
      if (method === "note.subscribe") {
        const wsId = (params as { workspaceId?: string })?.workspaceId;
        if (wsId === "ws-2") return Promise.reject(new Error("boom"));
        chanSeq += 1;
        return Promise.resolve({ subscriptionId: `chan-${chanSeq}` });
      }
      if (method === "note.unsubscribe") return Promise.resolve({ success: true });
      if (method === "note.list") {
        const wsId = (params as { workspaceId?: string })?.workspaceId ?? "";
        return Promise.resolve({ notes: notesByWorkspace[wsId] ?? [] });
      }
      return Promise.resolve({ success: true });
    });
    const handler = vi.fn();
    const client = new LiveNotesClient();
    const unsubscribe = client.subscribe(handler);
    await vi.waitFor(() => expect(requestsFor("note.subscribe")).toHaveLength(2));
    await flush();

    // chan-1 confirms but ws-2's registration failed: never live.
    pushSnapshot("chan-1", 0, [wireNote("a", "ws-1", "A")]);
    const listCallsBefore = requestsFor("note.list").length;
    fireLegacy("note:updated");
    await flush();
    expect(requestsFor("note.list").length).toBeGreaterThan(listCallsBefore);
    // The refetch (not the lone snapshot) serves the full cross-workspace set.
    const served = handler.mock.calls.at(-1)?.[0] as Array<{ id: string }>;
    expect(served.map((n) => n.id).sort()).toEqual(["a", "b"]);
    unsubscribe();
  });

  it("reconnect re-enumerates workspaces and re-registers only the surviving channels", async () => {
    const handler = vi.fn();
    const client = new LiveNotesClient();
    const unsubscribe = client.subscribe(handler);
    await vi.waitFor(() => expect(requestsFor("note.subscribe")).toHaveLength(2));
    await flush();
    pushSnapshot("chan-1", 0, [wireNote("a", "ws-1", "A")]);
    pushSnapshot("chan-2", 0, [wireNote("b", "ws-2", "B")]);

    // ws-2 disappeared during the outage. The reconnect handler re-registers
    // both surviving channel states synchronously (ws-1 → chan-3, ws-2 →
    // chan-4); the id source's reconnect refresh then re-enumerates and
    // reconciles ws-2 away — its dead channel is unsubscribed instead of
    // pinning the subscription in legacy mode.
    workspaceIds = ["ws-1"];
    for (const handler of [...reconnectHandlers]) handler();
    await vi.waitFor(() => {
      expect(requestsFor("note.subscribe").slice(2)).toEqual([
        { workspaceId: "ws-1" },
        { workspaceId: "ws-2" },
      ]);
      expect(requestsFor("note.unsubscribe")).toEqual([{ subscriptionId: "chan-4" }]);
    });

    // The surviving ws-1 channel's recovery snapshot re-enters live mode with
    // only ws-1's notes.
    pushSnapshot("chan-3", 0, [wireNote("a", "ws-1", "A")]);
    await flush();
    const recovered = handler.mock.calls.at(-1)?.[0] as Array<{ id: string }>;
    expect(recovered.map((n) => n.id)).toEqual(["a"]);
    unsubscribe();
  });

  it("unsubscribes every workspace channel on dispose", async () => {
    const client = new LiveNotesClient();
    const unsubscribe = client.subscribe(() => {});
    await vi.waitFor(() => expect(requestsFor("note.subscribe")).toHaveLength(2));
    await flush();

    unsubscribe();
    expect(requestsFor("note.unsubscribe")).toEqual([
      { subscriptionId: "chan-1" },
      { subscriptionId: "chan-2" },
    ]);
  });
});
