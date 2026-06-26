import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CommentV2 } from "./comment-types-v2";

// FAKE seam: appClient.comments.* are stubbed so no mutation reaches the daemon.
// The service runs against the REAL configured store so optimistic dispatch and
// rollback are exercised end to end.
vi.mock("$lib/client", () => ({
  appClient: {
    comments: {
      add: vi.fn(() => Promise.resolve({ success: true })),
      respond: vi.fn(() => Promise.resolve({ success: true })),
      delete: vi.fn(() => Promise.resolve({ success: true })),
    },
  },
}));

import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import {
  clearCommentsAction,
  loadCommentsAction,
} from "$store/renderer/slices/comments/comments-slice";
import { selectCommentById } from "$store/renderer/slices/comments/comments-selectors";
import { addComment, deleteComment, respondToComment } from "./comments-write-service";

const commentsApi = appClient.comments as unknown as Record<string, ReturnType<typeof vi.fn>>;

function makeComment(id: string, overrides: Partial<CommentV2> = {}): CommentV2 {
  const now = new Date().toISOString();
  return {
    id,
    threadId: `thread-${id}`,
    type: "comment",
    content: "body",
    author: "User",
    authorType: "user",
    status: "open",
    anchor: { type: "point", pointId: `${id}:point` },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as CommentV2;
}

describe("commentsWriteService (fake seam, real store)", () => {
  beforeAll(() => appStore.init());
  afterEach(() => {
    appStore.dispatch(clearCommentsAction());
    vi.clearAllMocks();
    commentsApi.add.mockResolvedValue({ success: true } as never);
    commentsApi.respond.mockResolvedValue({ success: true } as never);
    commentsApi.delete.mockResolvedValue({ success: true } as never);
  });

  it("add applies optimistically and keeps the comment on success", async () => {
    const optimistic = makeComment("c-1");
    await addComment("note-1", optimistic, {
      searchContext: "the quick fox",
      commentTarget: "quick",
      comment: "body",
    });

    expect(commentsApi.add).toHaveBeenCalledWith("note-1", {
      searchContext: "the quick fox",
      commentTarget: "quick",
      comment: "body",
    });
    expect(selectCommentById.select(appStore.state, "c-1")?.content).toBe("body");
  });

  it("add rolls back the optimistic comment on failure", async () => {
    commentsApi.add.mockResolvedValueOnce({ success: false, error: "nope" } as never);

    await addComment("note-1", makeComment("c-2"), {
      searchContext: "a b",
      commentTarget: "a",
      comment: "body",
    });

    expect(selectCommentById.select(appStore.state, "c-2")).toBeUndefined();
  });

  it("respond applies the reply optimistically and keeps it on success", async () => {
    const reply = makeComment("r-1", { parentId: "p-1", threadId: "thread-p" });
    await respondToComment("note-1", reply, { commentId: "p-1", comment: "body", type: "comment" });

    expect(commentsApi.respond).toHaveBeenCalledWith("note-1", {
      commentId: "p-1",
      comment: "body",
      type: "comment",
    });
    expect(selectCommentById.select(appStore.state, "r-1")?.parentId).toBe("p-1");
  });

  it("respond rolls back the optimistic reply on failure", async () => {
    commentsApi.respond.mockResolvedValueOnce({ success: false, error: "nope" } as never);

    await respondToComment("note-1", makeComment("r-2", { parentId: "p-1" }), {
      commentId: "p-1",
      comment: "body",
    });

    expect(selectCommentById.select(appStore.state, "r-2")).toBeUndefined();
  });

  it("delete removes optimistically and reports prior existence", async () => {
    appStore.dispatch(loadCommentsAction([makeComment("c-3")]));

    const existed = await deleteComment("note-1", "c-3");

    expect(existed).toBe(true);
    expect(commentsApi.delete).toHaveBeenCalledWith("note-1", "c-3");
    expect(selectCommentById.select(appStore.state, "c-3")).toBeUndefined();
  });

  it("delete restores the comment from a snapshot on failure", async () => {
    commentsApi.delete.mockResolvedValueOnce({ success: false, error: "nope" } as never);
    appStore.dispatch(loadCommentsAction([makeComment("c-4", { content: "keep" })]));

    await deleteComment("note-1", "c-4");

    expect(selectCommentById.select(appStore.state, "c-4")?.content).toBe("keep");
  });
});
