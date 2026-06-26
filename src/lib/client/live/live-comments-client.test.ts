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
        idempotencyKey: expect.any(String),
      }),
    );
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
});

describe("LiveCommentsClient.normalizeComment (§8.7 subtype fields)", () => {
  afterEach(() => vi.clearAllMocks());

  it("populates anchorContext for a comment and suggestionDiff for a suggestion", async () => {
    mockedRequest.mockResolvedValueOnce([
      {
        id: "c-1",
        type: "comment",
        content: "hi",
        anchorContext: { before: "B", after: "A" },
      },
      {
        id: "s-1",
        type: "suggestion",
        content: "swap",
        anchorContext: { before: "x", after: "y" },
        suggestionDiff: { original: "foo", proposed: "bar" },
      },
    ]);

    const comments = await new LiveCommentsClient().list("note-1");

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
});
