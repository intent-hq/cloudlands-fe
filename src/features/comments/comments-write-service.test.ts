import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ContentType, NoteVisibility } from "$shared/types";
import type { Note } from "$shared/types";
import { NoteId, WorkspaceId } from "$shared/types/branded-ids";
import type { CommentV2 } from "./comment-types-v2";

// FAKE seam: appClient.comments.* are stubbed so no mutation reaches the daemon.
// The service runs against the REAL configured store so optimistic dispatch and
// rollback are exercised end to end. appClient.notes.* is stubbed too because
// `addComment` routes workspace-scoped adds through the notes-write-service
// mutation queue (rev bookkeeping) and the queue's neighbors call notes.*.
vi.mock("$lib/client", () => ({
  appClient: {
    comments: {
      add: vi.fn(() => Promise.resolve({ success: true })),
      respond: vi.fn(() => Promise.resolve({ success: true })),
      delete: vi.fn(() => Promise.resolve({ success: true })),
    },
    notes: {
      create: vi.fn(() => Promise.resolve({ success: true })),
      setContent: vi.fn(() => Promise.resolve({ success: true })),
      updateMetadata: vi.fn(() => Promise.resolve({ success: true })),
      delete: vi.fn(() => Promise.resolve({ success: true })),
      list: vi.fn(() => Promise.resolve([] as Note[])),
    },
  },
}));

// FAKE the toast seam so failure surfacing is asserted without svelte-sonner.
vi.mock("svelte-sonner", () => ({
  toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

import { appClient } from "$lib/client";
import { toast } from "svelte-sonner";
import { store as appStore } from "$store/renderer/store";
import {
  clearCommentsAction,
  loadCommentsAction,
} from "$store/renderer/slices/comments/comments-slice";
import { selectCommentById } from "$store/renderer/slices/comments/comments-selectors";
import { loadWorkspaceNotesSucceeded } from "$store/renderer/slices/workspace-notes/workspace-notes-slice";
import { selectNoteById } from "$store/renderer/slices/workspace-notes/workspace-notes-selectors";
import {
  NOTE_CONTENT_SAVE_DEBOUNCE_MS,
  updateNoteContent,
} from "../notes/notes-write-service";
import { addComment, deleteComment, respondToComment } from "./comments-write-service";

const commentsApi = appClient.comments as unknown as Record<string, ReturnType<typeof vi.fn>>;
const notesApi = appClient.notes as unknown as Record<string, ReturnType<typeof vi.fn>>;

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

function makeNote(workspaceId: string, id: string, overrides: Partial<Note> = {}): Note {
  const now = new Date().toISOString();
  return {
    id: NoteId(id),
    workspaceId: WorkspaceId(workspaceId),
    title: "Title",
    content: "body",
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Workspace,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function seedNote(workspaceId: string, note: Note): void {
  appStore.dispatch(loadWorkspaceNotesSucceeded([workspaceId], { [workspaceId]: [note] }));
}

describe("commentsWriteService (fake seam, real store)", () => {
  beforeAll(() => appStore.init());
  afterEach(() => {
    appStore.dispatch(clearCommentsAction());
    vi.clearAllMocks();
    commentsApi.add.mockResolvedValue({ success: true } as never);
    commentsApi.respond.mockResolvedValue({ success: true } as never);
    commentsApi.delete.mockResolvedValue({ success: true } as never);
    Object.values(notesApi).forEach((fn) => fn.mockResolvedValue({ success: true } as never));
    notesApi.list.mockResolvedValue([] as never);
  });

  it("add applies optimistically and keeps the comment on success", async () => {
    const optimistic = makeComment("c-1");
    await addComment("note-1", optimistic, {
      searchContext: "the quick fox",
      commentTarget: "quick",
      comment: "body",
      authorType: "user",
    });

    expect(commentsApi.add).toHaveBeenCalledWith("note-1", {
      searchContext: "the quick fox",
      commentTarget: "quick",
      comment: "body",
      authorType: "user",
    });
    expect(selectCommentById.select(appStore.state, "c-1")?.content).toBe("body");
  });

  it("add rolls back the optimistic comment on failure, surfaces a toast, and reports !success", async () => {
    commentsApi.add.mockResolvedValueOnce({ success: false, error: "nope" } as never);

    const ok = await addComment("note-1", makeComment("c-2"), {
      searchContext: "a b",
      commentTarget: "a",
      comment: "body",
    });

    expect(ok).toBe(false);
    expect(selectCommentById.select(appStore.state, "c-2")).toBeUndefined();
    expect(toast.error).toHaveBeenCalledWith(
      "Failed to add comment",
      expect.objectContaining({ description: "nope" }),
    );
  });

  it("add toast description carries the folded daemon detail from MutationResult.error", async () => {
    commentsApi.add.mockResolvedValueOnce({
      success: false,
      error: "Internal error: Could not find the search context in the document.",
    } as never);

    const ok = await addComment("note-1", makeComment("c-detail"), {
      searchContext: "a b",
      commentTarget: "a",
      comment: "body",
    });

    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      "Failed to add comment",
      expect.objectContaining({
        description: "Internal error: Could not find the search context in the document.",
      }),
    );
  });

  it("add returns true on a successful persist", async () => {
    const ok = await addComment("note-1", makeComment("c-ok"), {
      searchContext: "x y",
      commentTarget: "x",
      comment: "body",
    });
    expect(ok).toBe(true);
  });

  // ---- Round 6b regression: comment.add rewrites the note markdown daemon-side
  // (anchor markers) and bumps the note `rev` WITHOUT a `note:updated` event or
  // a rev echo — so a workspace-scoped add must advance the stored rev through
  // the §11.4-D note mutation queue, or the anchor-insertion's debounced
  // content save sends a stale expectedVersion and trips the conflict toast.

  it("advances the stored note rev after a successful workspace-scoped add", async () => {
    const WS = "ws-rev-1";
    seedNote(WS, makeNote(WS, "note-rev", { rev: 4 }));

    const ok = await addComment("note-rev", makeComment("c-rev"), {
      workspaceId: WS,
      searchContext: "x y",
      commentTarget: "x",
      comment: "body",
    });

    expect(ok).toBe(true);
    expect(selectNoteById.select(appStore.state, WS, "note-rev")?.rev).toBe(5);
  });

  // FE side of monorepo#638: newer daemons echo the authoritative post-add
  // rev (`noteRev`) on the result — it must be applied verbatim (the daemon
  // may have advanced the rev by more than one), while its absence keeps the
  // rev+1 inference above for older daemons.
  it("uses the daemon's echoed noteRev verbatim over the rev+1 inference", async () => {
    const WS = "ws-rev-echo";
    seedNote(WS, makeNote(WS, "note-rev", { rev: 4 }));
    commentsApi.add.mockResolvedValueOnce({ success: true, noteRev: 9 } as never);

    const ok = await addComment("note-rev", makeComment("c-echo"), {
      workspaceId: WS,
      searchContext: "x y",
      commentTarget: "x",
      comment: "body",
    });

    expect(ok).toBe(true);
    expect(selectNoteById.select(appStore.state, WS, "note-rev")?.rev).toBe(9);
  });

  it("applies an echoed noteRev even when the store had no rev to infer from", async () => {
    const WS = "ws-rev-echo-2";
    seedNote(WS, makeNote(WS, "note-rev", { rev: undefined }));
    commentsApi.add.mockResolvedValueOnce({ success: true, noteRev: 3 } as never);

    const ok = await addComment("note-rev", makeComment("c-echo-2"), {
      workspaceId: WS,
      searchContext: "x y",
      commentTarget: "x",
      comment: "body",
    });

    expect(ok).toBe(true);
    expect(selectNoteById.select(appStore.state, WS, "note-rev")?.rev).toBe(3);
  });

  it("never regresses a newer stored rev with a stale echoed noteRev", async () => {
    const WS = "ws-rev-echo-3";
    seedNote(WS, makeNote(WS, "note-rev", { rev: 12 }));
    commentsApi.add.mockResolvedValueOnce({ success: true, noteRev: 5 } as never);

    const ok = await addComment("note-rev", makeComment("c-echo-3"), {
      workspaceId: WS,
      searchContext: "x y",
      commentTarget: "x",
      comment: "body",
    });

    expect(ok).toBe(true);
    expect(selectNoteById.select(appStore.state, WS, "note-rev")?.rev).toBe(12);
  });

  it("leaves the stored note rev untouched when the add fails", async () => {
    const WS = "ws-rev-2";
    seedNote(WS, makeNote(WS, "note-rev", { rev: 4 }));
    commentsApi.add.mockResolvedValueOnce({ success: false, error: "nope" } as never);

    const ok = await addComment("note-rev", makeComment("c-rev-fail"), {
      workspaceId: WS,
      searchContext: "x y",
      commentTarget: "x",
      comment: "body",
    });

    expect(ok).toBe(false);
    expect(selectNoteById.select(appStore.state, WS, "note-rev")?.rev).toBe(4);
  });

  it("add then debounced content save carries the post-add rev — no conflict toast", async () => {
    vi.useFakeTimers();
    try {
      const WS = "ws-rev-3";
      seedNote(WS, makeNote(WS, "note-rev", { rev: 3, content: "body" }));

      // Stateful daemon-conditional mocks (§11.4-D): comment.add bumps the
      // server rev (the daemon's anchor rewrite); setContent rejects with a
      // -32005-shaped conflict when expectedVersion mismatches.
      let serverRev = 3;
      commentsApi.add.mockImplementation(() => {
        serverRev += 1;
        return Promise.resolve({ success: true });
      });
      notesApi.setContent.mockImplementation(
        (_id: string, _c: string, expectedVersion?: number) => {
          if (expectedVersion !== serverRev) {
            return Promise.resolve({
              success: false,
              error: "conflict",
              conflict: { current: makeNote(WS, "note-rev", { rev: serverRev }) },
            });
          }
          serverRev += 1;
          return Promise.resolve({ success: true });
        },
      );

      // The editor's anchor insertion triggers the debounced save; the add is
      // still in flight when the debounce is armed (the race window).
      const adding = addComment("note-rev", makeComment("c-race"), {
        workspaceId: WS,
        searchContext: "bo dy",
        commentTarget: "bo",
        comment: "body",
      });
      updateNoteContent(WS, "note-rev", "body with anchors");
      await adding;
      await vi.advanceTimersByTimeAsync(NOTE_CONTENT_SAVE_DEBOUNCE_MS + 1);

      // The save read the post-add rev (4), not the stale seeded rev (3).
      expect(notesApi.setContent).toHaveBeenCalledWith("note-rev", "body with anchors", 4, WS);
      expect(toast.warning).not.toHaveBeenCalled();
      expect(selectNoteById.select(appStore.state, WS, "note-rev")?.rev).toBe(5);
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("debounced save flushed while the add is STILL in flight queues behind it and reads the post-add rev", async () => {
    // Pins the queue-serialization mechanism itself: the add is a deferred
    // promise that is still unresolved when the debounce fires, so
    // `flushContent` enqueues behind it on the note's mutation queue instead
    // of racing it with the stale rev.
    vi.useFakeTimers();
    try {
      const WS = "ws-rev-4";
      seedNote(WS, makeNote(WS, "note-rev", { rev: 3, content: "body" }));

      let serverRev = 3;
      let resolveAdd!: (r: { success: boolean }) => void;
      commentsApi.add.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveAdd = (r) => {
              serverRev += 1;
              resolve(r);
            };
          }),
      );
      notesApi.setContent.mockImplementation(
        (_id: string, _c: string, expectedVersion?: number) => {
          if (expectedVersion !== serverRev) {
            return Promise.resolve({
              success: false,
              error: "conflict",
              conflict: { current: makeNote(WS, "note-rev", { rev: serverRev }) },
            });
          }
          serverRev += 1;
          return Promise.resolve({ success: true });
        },
      );

      const adding = addComment("note-rev", makeComment("c-race-2"), {
        workspaceId: WS,
        searchContext: "bo dy",
        commentTarget: "bo",
        comment: "body",
      });
      updateNoteContent(WS, "note-rev", "body with anchors");
      // The debounce fires while comment.add is still unresolved — the flush
      // must wait on the queue rather than read the stale rev 3.
      await vi.advanceTimersByTimeAsync(NOTE_CONTENT_SAVE_DEBOUNCE_MS + 1);
      expect(notesApi.setContent).not.toHaveBeenCalled();

      resolveAdd({ success: true });
      await adding;
      await vi.advanceTimersByTimeAsync(1);

      expect(notesApi.setContent).toHaveBeenCalledTimes(1);
      expect(notesApi.setContent).toHaveBeenCalledWith("note-rev", "body with anchors", 4, WS);
      expect(toast.warning).not.toHaveBeenCalled();
      expect(selectNoteById.select(appStore.state, WS, "note-rev")?.rev).toBe(5);
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("respond applies the reply optimistically and keeps it on success", async () => {
    const reply = makeComment("r-1", { parentId: "p-1", threadId: "thread-p" });
    await respondToComment("note-1", reply, {
      commentId: "p-1",
      comment: "body",
      type: "comment",
      authorType: "user",
    });

    expect(commentsApi.respond).toHaveBeenCalledWith("note-1", {
      commentId: "p-1",
      comment: "body",
      type: "comment",
      authorType: "user",
    });
    expect(selectCommentById.select(appStore.state, "r-1")?.parentId).toBe("p-1");
  });

  it("respond rolls back the optimistic reply on failure, surfaces a toast, and reports !success", async () => {
    commentsApi.respond.mockResolvedValueOnce({ success: false, error: "nope" } as never);

    const ok = await respondToComment("note-1", makeComment("r-2", { parentId: "p-1" }), {
      commentId: "p-1",
      comment: "body",
    });

    expect(ok).toBe(false);
    expect(selectCommentById.select(appStore.state, "r-2")).toBeUndefined();
    expect(toast.error).toHaveBeenCalledWith(
      "Failed to reply",
      expect.objectContaining({ description: "nope" }),
    );
  });

  it("delete removes optimistically and reports prior existence + success", async () => {
    appStore.dispatch(loadCommentsAction([makeComment("c-3")]));

    const { existed, success } = await deleteComment("note-1", "c-3");

    expect(existed).toBe(true);
    expect(success).toBe(true);
    expect(commentsApi.delete).toHaveBeenCalledWith("note-1", "c-3", undefined);
    expect(selectCommentById.select(appStore.state, "c-3")).toBeUndefined();
  });

  it("delete restores the comment on failure, surfaces a toast, and reports !success", async () => {
    commentsApi.delete.mockResolvedValueOnce({ success: false, error: "nope" } as never);
    appStore.dispatch(loadCommentsAction([makeComment("c-4", { content: "keep" })]));

    const { existed, success } = await deleteComment("note-1", "c-4");

    expect(existed).toBe(true);
    expect(success).toBe(false);
    expect(selectCommentById.select(appStore.state, "c-4")?.content).toBe("keep");
    expect(toast.error).toHaveBeenCalledWith(
      "Failed to delete comment",
      expect.objectContaining({ description: "nope" }),
    );
  });
});
