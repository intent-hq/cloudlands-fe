import { afterEach, describe, expect, it, vi } from "vitest";

// FAKE transport only: the backend bridge is mocked so no comment mutation ever
// reaches the user's real daemon. `resolveNoteWorkspaceId` is stubbed so
// note-scoped mutations resolve deterministically; `runMutation` /
// `newIdempotencyKey` stay real so the asserted method + params and the
// success/error folding are the genuine code paths.
vi.mock("./backend-transport", () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(() => Promise.resolve({ subscriptionId: "sub-1" })),
  backendUnsubscribe: vi.fn(() => Promise.resolve()),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
  detectLiveStateCapability: vi.fn(() => Promise.resolve(false)),
}));

vi.mock("./live-support", async (importActual) => {
  const actual = await importActual<typeof import("./live-support")>();
  return { ...actual, resolveNoteWorkspaceId: vi.fn(() => Promise.resolve("ws-1")) };
});

import { backendRequest } from "./backend-transport";
import { resolveNoteWorkspaceId } from "./live-support";
import { LiveCommentsClient } from "./live-comments-client";

const mockedRequest = vi.mocked(backendRequest);
const mockedResolve = vi.mocked(resolveNoteWorkspaceId);

describe("LiveCommentsClient mutations (fake transport)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockedResolve.mockResolvedValue("ws-1");
  });

  it("add forwards comment.add with the params + an idempotencyKey", async () => {
    mockedRequest.mockResolvedValueOnce({ commentId: "c-1" });
    const client = new LiveCommentsClient();

    const result = await client.add("note-1", {
      searchContext: "the quick brown fox",
      commentTarget: "quick",
      comment: "hi",
      type: "comment",
      author: "User",
      authorType: "user",
    });

    expect(result).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith(
      "comment.add",
      expect.objectContaining({
        workspaceId: "ws-1",
        noteId: "note-1",
        searchContext: "the quick brown fox",
        commentTarget: "quick",
        comment: "hi",
        type: "comment",
        author: "User",
        authorType: "user",
        idempotencyKey: expect.any(String),
      }),
    );
  });

  // Round-5 regression (monorepo "comment-add" dogfood failure): note ids are
  // NOT globally unique — every workspace has a note literally named `spec` —
  // and `resolveNoteWorkspaceId`'s cache is last-writer-wins across workspaces
  // (any other workspace's note:updated refetch overwrites the entry). A
  // caller-supplied `workspaceId` must therefore win over the cache, otherwise
  // comment.add targets another workspace's same-id note and the daemon
  // correctly rejects with "Could not find the search context".
  it("add uses the caller's explicit workspaceId over the resolver cache", async () => {
    mockedRequest.mockResolvedValueOnce({ commentId: "c-1" });
    // Cache poisoned by another workspace that also has a "spec" note.
    mockedResolve.mockResolvedValue("other-workspace");
    const client = new LiveCommentsClient();

    await client.add("spec", {
      workspaceId: "comment-add",
      searchContext: "ctx",
      commentTarget: "target",
      comment: "hi",
    });

    expect(mockedResolve).not.toHaveBeenCalled();
    expect(mockedRequest).toHaveBeenCalledWith(
      "comment.add",
      expect.objectContaining({ workspaceId: "comment-add", noteId: "spec" }),
    );
  });

  it("respond and delete use the caller's explicit workspaceId over the resolver cache", async () => {
    mockedRequest.mockResolvedValue({ success: true });
    mockedResolve.mockResolvedValue("other-workspace");
    const client = new LiveCommentsClient();

    await client.respond("spec", {
      workspaceId: "comment-add",
      commentId: "c-1",
      comment: "reply",
    });
    await client.delete("spec", "c-1", "comment-add");

    expect(mockedResolve).not.toHaveBeenCalled();
    expect(mockedRequest).toHaveBeenNthCalledWith(
      1,
      "comment.respond",
      expect.objectContaining({ workspaceId: "comment-add", noteId: "spec" }),
    );
    expect(mockedRequest).toHaveBeenNthCalledWith(
      2,
      "comment.delete",
      expect.objectContaining({ workspaceId: "comment-add", noteId: "spec" }),
    );
  });

  it("list uses the caller's explicit workspaceId over the resolver cache", async () => {
    mockedRequest.mockResolvedValueOnce({ threads: [] });
    mockedResolve.mockResolvedValue("other-workspace");
    const client = new LiveCommentsClient();

    await client.list("spec", "comment-add");

    expect(mockedResolve).not.toHaveBeenCalled();
    expect(mockedRequest).toHaveBeenCalledWith(
      "comment.list",
      expect.objectContaining({ workspaceId: "comment-add", noteId: "spec" }),
    );
  });

  // monorepo#621 (Round 7d): `subscribe`'s refetch loop must pin to the
  // caller's workspaceId too — otherwise a poisoned resolver cache routes the
  // refetch at another workspace's same-id note (e.g. `spec`).
  it("subscribe's refetch uses the caller's explicit workspaceId over the resolver cache", async () => {
    mockedRequest.mockResolvedValue({ threads: [] });
    mockedResolve.mockResolvedValue("other-workspace");
    const client = new LiveCommentsClient();

    const unsubscribe = client.subscribe("spec", () => {}, "comment-add");
    // The initial one-shot refetch fires asynchronously on subscription setup.
    await vi.waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledWith(
        "comment.list",
        expect.objectContaining({ workspaceId: "comment-add", noteId: "spec" }),
      );
    });
    expect(mockedResolve).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("subscribe falls back to the resolver when no workspaceId is supplied", async () => {
    mockedRequest.mockResolvedValue({ threads: [] });
    const client = new LiveCommentsClient();

    const unsubscribe = client.subscribe("note-1", () => {});
    await vi.waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledWith(
        "comment.list",
        expect.objectContaining({ workspaceId: "ws-1", noteId: "note-1" }),
      );
    });
    expect(mockedResolve).toHaveBeenCalledWith("note-1");
    unsubscribe();
  });

  it("add omits authorType from the wire params when not provided", async () => {
    mockedRequest.mockResolvedValueOnce({ commentId: "c-1" });
    const client = new LiveCommentsClient();

    await client.add("note-1", { searchContext: "a b", commentTarget: "a", comment: "hi" });

    expect(mockedRequest.mock.calls[0][1]).not.toHaveProperty("authorType");
  });

  // intentd#514 / PROTOCOL §5.3: `comment.add` accepts an optional client
  // `commentId` (a UUID) used as the canonical id — comment row, threadId,
  // anchor ids, and the embedded note markers — so the FE's optimistic editor
  // anchors converge with the daemon's rewrite instead of ghosting under a
  // daemon-minted id (root cause A of the clobber/ghosting race).
  it("add forwards the caller's commentId on the wire when provided", async () => {
    mockedRequest.mockResolvedValueOnce({ commentId: "550e8400-e29b-41d4-a716-446655440000" });
    const client = new LiveCommentsClient();

    await client.add("note-1", {
      searchContext: "a b",
      commentTarget: "a",
      comment: "hi",
      commentId: "550e8400-e29b-41d4-a716-446655440000",
    });

    expect(mockedRequest).toHaveBeenCalledWith(
      "comment.add",
      expect.objectContaining({ commentId: "550e8400-e29b-41d4-a716-446655440000" }),
    );
  });

  it("add omits commentId from the wire params when not provided (older-daemon mint path)", async () => {
    mockedRequest.mockResolvedValueOnce({ commentId: "c-1" });
    const client = new LiveCommentsClient();

    await client.add("note-1", { searchContext: "a b", commentTarget: "a", comment: "hi" });

    expect(mockedRequest.mock.calls[0][1]).not.toHaveProperty("commentId");
  });

  // FE side of monorepo#638: the daemon echoes the authoritative post-add
  // note rev (`noteRev`) after its anchor rewrite; the seam surfaces it on the
  // MutationResult so rev bookkeeping can consume it instead of inferring +1.
  it("add surfaces the daemon's echoed noteRev on the MutationResult", async () => {
    mockedRequest.mockResolvedValueOnce({ commentId: "c-1", noteRev: 7 });
    const client = new LiveCommentsClient();

    const result = await client.add("note-1", {
      searchContext: "a b",
      commentTarget: "a",
      comment: "hi",
    });

    expect(result).toEqual({ success: true, noteRev: 7 });
  });

  it("add omits noteRev when the daemon does not echo one (older daemons)", async () => {
    mockedRequest.mockResolvedValueOnce({ commentId: "c-1" });
    const client = new LiveCommentsClient();

    const result = await client.add("note-1", {
      searchContext: "a b",
      commentTarget: "a",
      comment: "hi",
    });

    expect(result).toEqual({ success: true });
    expect(result).not.toHaveProperty("noteRev");
  });

  it("add generates a distinct idempotencyKey per call", async () => {
    mockedRequest.mockResolvedValue({ commentId: "c-x" });
    const client = new LiveCommentsClient();

    await client.add("note-1", { searchContext: "a b", commentTarget: "a", comment: "1" });
    await client.add("note-1", { searchContext: "a b", commentTarget: "a", comment: "2" });

    const first = (mockedRequest.mock.calls[0][1] as { idempotencyKey: string }).idempotencyKey;
    const second = (mockedRequest.mock.calls[1][1] as { idempotencyKey: string }).idempotencyKey;
    expect(first).not.toEqual(second);
  });

  it("respond forwards comment.respond with commentId + suggestion fields when provided", async () => {
    mockedRequest.mockResolvedValueOnce({ success: true });
    const client = new LiveCommentsClient();

    await client.respond("note-1", {
      commentId: "parent-1",
      comment: "see diff",
      type: "suggestion",
      suggestionOriginal: "old",
      suggestionProposed: "new",
    });

    expect(mockedRequest).toHaveBeenCalledWith("comment.respond", {
      workspaceId: "ws-1",
      noteId: "note-1",
      commentId: "parent-1",
      comment: "see diff",
      type: "suggestion",
      suggestionOriginal: "old",
      suggestionProposed: "new",
    });
  });

  it("respond forwards authorType when provided and omits it when absent", async () => {
    mockedRequest.mockResolvedValue({ success: true });
    const client = new LiveCommentsClient();

    await client.respond("note-1", {
      commentId: "parent-1",
      comment: "from the user",
      authorType: "user",
    });
    await client.respond("note-1", { commentId: "parent-1", comment: "from an agent" });

    expect(mockedRequest.mock.calls[0][1]).toMatchObject({ authorType: "user" });
    expect(mockedRequest.mock.calls[1][1]).not.toHaveProperty("authorType");
  });

  it("delete forwards comment.delete with the commentId", async () => {
    mockedRequest.mockResolvedValueOnce({ success: true });
    const client = new LiveCommentsClient();

    expect(await client.delete("note-1", "c-1")).toEqual({ success: true });
    expect(mockedRequest).toHaveBeenCalledWith("comment.delete", {
      workspaceId: "ws-1",
      noteId: "note-1",
      commentId: "c-1",
    });
  });

  it("fails a mutation when the workspace cannot be resolved", async () => {
    mockedResolve.mockResolvedValueOnce(null);
    const client = new LiveCommentsClient();

    const result = await client.delete("ghost", "c-1");
    expect(result.success).toBe(false);
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it("maps a daemon error to a failed MutationResult without throwing", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("boom"));
    const client = new LiveCommentsClient();

    expect(await client.delete("note-1", "c-1")).toEqual({ success: false, error: "boom" });
  });

  it("folds the BackendError.data detail into a generic 'Internal error'", async () => {
    // The daemon maps Error::Internal to -32603 with the hardcoded message
    // "Internal error" and the real cause as a string in `error.data`; the
    // main-process bridge (json-rpc-errors.ts) normalizes that string onto
    // `data.detail` before it crosses the IPC boundary, so this fixture mirrors
    // the post-normalization shape the renderer actually receives.
    mockedRequest.mockRejectedValueOnce(
      Object.assign(new Error("Internal error"), {
        data: { code: "INTERNAL_ERROR", detail: "Could not find the search context in the document." },
        rpcCode: -32603,
      }),
    );
    const client = new LiveCommentsClient();

    const result = await client.add("note-1", {
      searchContext: "a b",
      commentTarget: "a",
      comment: "hi",
    });

    expect(result).toEqual({
      success: false,
      error: "Internal error: Could not find the search context in the document.",
    });
  });

  it("folds a raw string data detail for transports that skip main-process normalization", async () => {
    mockedRequest.mockRejectedValueOnce(
      Object.assign(new Error("Internal error"), { data: "raw cause" }),
    );
    const client = new LiveCommentsClient();

    const result = await client.add("note-1", {
      searchContext: "a b",
      commentTarget: "a",
      comment: "hi",
    });

    expect(result).toEqual({ success: false, error: "Internal error: raw cause" });
  });

  it("leaves a generic 'Internal error' untouched when no data detail is present", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("Internal error"));
    const client = new LiveCommentsClient();

    const result = await client.add("note-1", {
      searchContext: "a b",
      commentTarget: "a",
      comment: "hi",
    });

    expect(result).toEqual({ success: false, error: "Internal error" });
  });

  it("does NOT fold data into a specific (non-generic) error message", async () => {
    mockedRequest.mockRejectedValueOnce(
      Object.assign(new Error("commentTarget must not be empty"), { data: "extra" }),
    );
    const client = new LiveCommentsClient();

    const result = await client.add("note-1", {
      searchContext: "a b",
      commentTarget: "",
      comment: "hi",
    });

    expect(result).toEqual({ success: false, error: "commentTarget must not be empty" });
  });
});

describe("LiveCommentsClient.list (PROTOCOL §5.3 {threads} envelope)", () => {
  afterEach(() => vi.clearAllMocks());

  it("flattens threads[].comments and normalizes §8.7 subtype fields", async () => {
    mockedRequest.mockResolvedValueOnce({
      threads: [
        {
          threadId: "t-1",
          comments: [
            {
              id: "c-1",
              threadId: "t-1",
              type: "comment",
              content: "hi",
              anchorContext: { before: "B", after: "A" },
            },
          ],
        },
        {
          threadId: "t-2",
          comments: [
            {
              id: "s-1",
              threadId: "t-2",
              type: "suggestion",
              content: "swap",
              anchorContext: { before: "x", after: "y" },
              suggestionDiff: { original: "foo", proposed: "bar" },
            },
          ],
        },
      ],
      totalThreads: 2,
      totalComments: 2,
    });

    const comments = await new LiveCommentsClient().list("note-1");

    expect(mockedRequest).toHaveBeenCalledWith(
      "comment.list",
      expect.objectContaining({ workspaceId: "ws-1", noteId: "note-1", includeComments: true }),
    );

    expect(comments).toHaveLength(2);

    const comment = comments.find((c) => c.id === "c-1")!;
    expect(comment.type).toBe("comment");
    expect(comment.anchorContext).toEqual({ before: "B", after: "A" });

    const suggestion = comments.find((c) => c.id === "s-1")!;
    expect(suggestion.type).toBe("suggestion");
    expect(suggestion.anchorContext).toEqual({ before: "x", after: "y" });
    expect((suggestion as { suggestionDiff: unknown }).suggestionDiff).toEqual({
      original: "foo",
      proposed: "bar",
    });
  });

  // monorepo#749: post-#729 replies carry no anchor/anchorText on the wire
  // (PROTOCOL §5.3 "Reply anchoring") — normalizeComment must not synthesize
  // a `{ type: "point" }` anchor for them, or downstream anchor-health checks
  // treat the reply as a point comment with no anchor node and orphan it.
  it("does not synthesize a point anchor for anchorless replies (monorepo#749)", async () => {
    mockedRequest.mockResolvedValueOnce({
      threads: [
        {
          threadId: "t-1",
          comments: [
            {
              id: "root-1",
              threadId: "t-1",
              type: "comment",
              content: "root",
              anchor: { type: "range", startId: "root-1:start", endId: "root-1:end" },
              anchorText: "hello",
            },
            {
              id: "reply-1",
              threadId: "t-1",
              parentId: "root-1",
              type: "comment",
              content: "reply",
            },
          ],
        },
      ],
      totalThreads: 1,
      totalComments: 2,
    });

    const comments = await new LiveCommentsClient().list("note-1");

    const root = comments.find((c) => c.id === "root-1")!;
    expect(root.anchor).toEqual({ type: "range", startId: "root-1:start", endId: "root-1:end" });

    const reply = comments.find((c) => c.id === "reply-1")!;
    expect(reply.parentId).toBe("root-1");
    expect(reply).not.toHaveProperty("anchor");
  });

  it("keeps the point-anchor fallback for anchorless roots (thread-summary proxies)", async () => {
    mockedRequest.mockResolvedValueOnce({
      threads: [
        {
          threadId: "t-1",
          comments: [{ id: "root-1", threadId: "t-1", type: "comment", content: "root" }],
        },
      ],
      totalThreads: 1,
      totalComments: 1,
    });

    const comments = await new LiveCommentsClient().list("note-1");
    expect(comments[0].anchor).toEqual({ type: "point" });
  });

  it("falls back to the thread summary when comments are absent (no includeComments)", async () => {
    mockedRequest.mockResolvedValueOnce({
      threads: [
        {
          threadId: "t-1",
          noteId: "note-1",
          status: "open",
          createdAt: "2026-01-01T00:00:00Z",
          lastActivity: "2026-01-01T00:00:00Z",
          latestCommentAuthor: "User",
          latestCommentAuthorType: "user",
          latestCommentAt: "2026-01-01T00:00:00Z",
          commentCount: 1,
        },
      ],
      totalThreads: 1,
      totalComments: 1,
    });

    const comments = await new LiveCommentsClient().list("note-1");
    expect(comments).toHaveLength(1);
    expect(comments[0].threadId).toBe("t-1");
  });
});
