import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommentV2 } from "$features/comments/comment-types-v2";

// FAKE seam: `appClient.comments.list` is stubbed so the read service
// exercises the refetch + per-comment diff/dispatch wire without a daemon
// round-trip. Only the read the boot seeder uses is stubbed — READ-ONLY.
const { commentsListMock } = vi.hoisted(() => ({
  commentsListMock: vi.fn<(noteId: string, workspaceId?: string) => Promise<CommentV2[]>>(),
}));
vi.mock("$lib/client", () => ({
  appClient: { comments: { list: commentsListMock } },
}));

import { store as appStore } from "$store/renderer/store";
import {
  addCommentAction,
  clearCommentsAction,
  loadCommentsAction,
} from "$store/renderer/slices/comments/comments-slice";
import {
  applyCommentFromEvent,
  __resetCommentsReadServiceForTests,
} from "./comments-read-service";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeComment(id: string, noteId: string, overrides: Partial<CommentV2> = {}): CommentV2 {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id,
    threadId: id,
    noteId,
    content: `body-${id}`,
    author: "u1",
    authorType: "user",
    status: "open",
    anchor: { type: "point" },
    type: "comment",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as CommentV2;
}

function readCommentsForNote(noteId: string): CommentV2[] {
  const state = appStore.state as { comments: { commentsById: { ids: string[]; map: Record<string, CommentV2> } } };
  return state.comments.commentsById.ids
    .map((id) => state.comments.commentsById.map[id])
    .filter((c): c is CommentV2 => c !== undefined && c.noteId === noteId);
}

describe("commentsReadService (fake seam, real store)", () => {
  beforeAll(() => appStore.init());

  beforeEach(() => {
    __resetCommentsReadServiceForTests();
    commentsListMock.mockReset();
    appStore.dispatch(clearCommentsAction());
  });

  afterEach(() => vi.clearAllMocks());

  it("adds newly-added comments to the affected note without touching other notes' comments", async () => {
    // Seed one comment on note-A and one on note-B via loadCommentsAction.
    const seededA = makeComment("c-a1", "note-a");
    const seededB = makeComment("c-b1", "note-b");
    appStore.dispatch(loadCommentsAction([seededA, seededB]));

    // Simulate comment:added by returning both the seeded a1 and a fresh a2.
    commentsListMock.mockResolvedValueOnce([seededA, makeComment("c-a2", "note-a")]);

    applyCommentFromEvent("ws-1", "note-a", "added");
    await flush();

    expect(commentsListMock).toHaveBeenCalledWith("note-a", "ws-1");
    const noteA = readCommentsForNote("note-a").map((c) => c.id).sort();
    const noteB = readCommentsForNote("note-b").map((c) => c.id).sort();
    expect(noteA).toEqual(["c-a1", "c-a2"]);
    expect(noteB).toEqual(["c-b1"]);
  });

  // Round-5 regression: note ids repeat across workspaces (every workspace
  // has a `spec` note), so the removal set must be scoped by workspaceId —
  // another workspace's same-id note's comments must not be treated as
  // "removed" when they are absent from this workspace's fresh fetch.
  it("does not remove another workspace's comments on a same-id note", async () => {
    const ws1Comment = makeComment("c-1", "spec", { workspaceId: "ws-1" });
    const ws2Comment = makeComment("c-2", "spec", { workspaceId: "ws-2" });
    appStore.dispatch(loadCommentsAction([ws1Comment, ws2Comment]));

    // ws-1's fresh fetch returns only its own comment.
    commentsListMock.mockResolvedValueOnce([ws1Comment]);

    applyCommentFromEvent("ws-1", "spec", "added");
    await flush();

    expect(readCommentsForNote("spec").map((c) => c.id).sort()).toEqual(["c-1", "c-2"]);
  });

  it("updates the resolved status of an existing comment via a fresh fetch", async () => {
    const initial = makeComment("c-a1", "note-a", { status: "open" });
    appStore.dispatch(loadCommentsAction([initial]));

    commentsListMock.mockResolvedValueOnce([
      makeComment("c-a1", "note-a", { status: "resolved", updatedAt: "2026-01-02T00:00:00.000Z" }),
    ]);

    applyCommentFromEvent("ws-1", "note-a", "resolved");
    await flush();

    const [refreshed] = readCommentsForNote("note-a");
    expect(refreshed.status).toBe("resolved");
    expect(refreshed.updatedAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("removes a comment from the affected note when the fresh fetch no longer includes it", async () => {
    const a1 = makeComment("c-a1", "note-a");
    const a2 = makeComment("c-a2", "note-a");
    appStore.dispatch(loadCommentsAction([a1, a2]));

    commentsListMock.mockResolvedValueOnce([a1]);

    applyCommentFromEvent("ws-1", "note-a", "resolved");
    await flush();

    expect(readCommentsForNote("note-a").map((c) => c.id)).toEqual(["c-a1"]);
  });

  it("coalesces concurrent refetches for the same note", async () => {
    // Deferred resolution so the second call is issued while the first is
    // still in flight.
    let resolveFirst!: (value: CommentV2[]) => void;
    commentsListMock.mockReturnValueOnce(
      new Promise<CommentV2[]>((r) => {
        resolveFirst = r;
      }),
    );

    applyCommentFromEvent("ws-1", "note-a", "added");
    applyCommentFromEvent("ws-1", "note-a", "added");

    // Second call must be coalesced — only one fetch is issued.
    expect(commentsListMock).toHaveBeenCalledTimes(1);

    resolveFirst([]);
    await flush();
  });

  it("no-ops when workspaceId or noteId are missing", () => {
    applyCommentFromEvent("", "note-a", "added");
    applyCommentFromEvent("ws-1", "", "added");
    expect(commentsListMock).not.toHaveBeenCalled();
  });

  it("does not dispatch add/update actions when the fetch throws (logs and moves on)", async () => {
    const seeded = makeComment("c-a1", "note-a");
    appStore.dispatch(loadCommentsAction([seeded]));
    commentsListMock.mockRejectedValueOnce(new Error("boom"));

    const spy = vi.spyOn(appStore, "dispatch");
    applyCommentFromEvent("ws-1", "note-a", "added");
    await flush();

    const addDispatches = spy.mock.calls.filter(
      (call) => (call[0] as { type?: string })?.type === addCommentAction.type,
    );
    expect(addDispatches).toHaveLength(0);
    spy.mockRestore();
  });
});
