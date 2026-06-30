import { afterEach, describe, expect, it, vi } from "vitest";

// FAKE transport only: the backend bridge is mocked so no request ever reaches
// the user's real daemon. Each test asserts the JSON-RPC method + params the
// client emits and how it maps the daemon result.
vi.mock("./backend-transport", () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(() => Promise.resolve({ subscriptionId: "sub-1" })),
  backendUnsubscribe: vi.fn(() => Promise.resolve()),
  onBackendNotification: vi.fn(() => () => {}),
}));

// Keep the REAL `runMutation` (so mutation tests assert the JSON-RPC method +
// params it forwards to the mocked transport) but stub the subscribe-only
// helpers. `git.agentCommit` does not take an idempotencyKey, so
// `newIdempotencyKey` is no longer used by the commit path.
vi.mock("./live-support", async (importActual) => {
  const actual = await importActual<typeof import("./live-support")>();
  return {
    ...actual,
    isEventInFamily: vi.fn(() => false),
    listWorkspaceIds: vi.fn(() => Promise.resolve([])),
  };
});

import { backendRequest } from "./backend-transport";
import { LiveGitClient } from "./live-git-client";

const mockedRequest = vi.mocked(backendRequest);

describe("LiveGitClient reads (fake transport)", () => {
  afterEach(() => vi.clearAllMocks());

  it("status maps the daemon git.status shape into GitStatus", async () => {
    mockedRequest.mockResolvedValueOnce({
      branch: "main",
      ahead: 1,
      behind: 2,
      diverged: true,
      files: [{ path: "a.ts", status: "M", staged: true }],
      hasUncommittedChanges: true,
      hasUntrackedFiles: false,
    });
    const client = new LiveGitClient();

    const status = await client.status("ws-1");

    expect(mockedRequest).toHaveBeenCalledWith("git.status", { workspaceId: "ws-1" });
    expect(status).toEqual({
      branch: "main",
      ahead: 1,
      behind: 2,
      diverged: true,
      files: [{ path: "a.ts", status: "M", staged: true }],
      hasUncommittedChanges: true,
      hasUntrackedFiles: false,
    });
  });

  it("prStatus forwards pr.status and maps prNumber/url/state", async () => {
    mockedRequest.mockResolvedValueOnce({
      prNumber: 42,
      title: "My PR",
      url: "https://example.test/pr/42",
      state: "open",
      mergeable: true,
      mergeableState: "clean",
      hasConflicts: false,
      isDraft: false,
      isMerged: false,
      isClosed: false,
      summary: "ready",
    });
    const client = new LiveGitClient();

    const result = await client.prStatus("ws-1");

    expect(mockedRequest).toHaveBeenCalledWith("pr.status", { workspaceId: "ws-1" });
    expect(result).toEqual({
      prNumber: 42,
      url: "https://example.test/pr/42",
      state: "open",
    });
  });

  it("prStatus resolves null when the daemon errors (no active PR)", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("no active PR"));
    const client = new LiveGitClient();

    expect(await client.prStatus("ws-1")).toBeNull();
  });

  it("diffs forwards git.diffs and maps path/hunks/lines into DiffChunk[]", async () => {
    mockedRequest.mockResolvedValueOnce([
      {
        path: "src/a.ts",
        hunks: [
          {
            oldStart: 1,
            oldLines: 2,
            newStart: 1,
            newLines: 3,
            lines: [
              { type: "Context", content: " keep", oldNumber: 1, newNumber: 1 },
              { type: "Addition", content: "+added", newNumber: 2 },
              { type: "Deletion", content: "-gone", oldNumber: 2 },
            ],
          },
        ],
      },
    ]);
    const client = new LiveGitClient();

    const diffs = await client.diffs("ws-1");

    expect(mockedRequest).toHaveBeenCalledWith("git.diffs", { workspaceId: "ws-1" });
    expect(diffs).toEqual([
      {
        file: "src/a.ts",
        chunks: [
          {
            oldStart: 1,
            oldLines: 2,
            newStart: 1,
            newLines: 3,
            lines: [
              { type: "Context", content: " keep", oldNumber: 1, newNumber: 1 },
              { type: "Addition", content: "+added", newNumber: 2 },
              { type: "Deletion", content: "-gone", oldNumber: 2 },
            ],
          },
        ],
      },
    ]);
  });

  it("diffs resolves [] when the daemon errors", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("diff boom"));
    const client = new LiveGitClient();

    expect(await client.diffs("ws-1")).toEqual([]);
  });

  it("diffs forwards optional commitHash + path for the per-commit read", async () => {
    mockedRequest.mockResolvedValueOnce([]);
    const client = new LiveGitClient();

    await client.diffs("ws-1", { commitHash: "abc123", path: "seed.txt" });

    expect(mockedRequest).toHaveBeenCalledWith("git.diffs", {
      workspaceId: "ws-1",
      path: "seed.txt",
      commitHash: "abc123",
    });
  });

  it("diffs forwards staged:true when no commitHash is set", async () => {
    mockedRequest.mockResolvedValueOnce([]);
    const client = new LiveGitClient();

    await client.diffs("ws-1", { staged: true });

    expect(mockedRequest).toHaveBeenCalledWith("git.diffs", {
      workspaceId: "ws-1",
      staged: true,
    });
  });

  it("commitDetails forwards git.commitDetails and normalizes the wire shape", async () => {
    mockedRequest.mockResolvedValueOnce({
      commitHash: "abc123",
      author: "Ada",
      authorEmail: "ada@example.test",
      date: "2025-01-02T03:04:05Z",
      message: "second",
      files: ["seed.txt", "new.txt"],
      fileDetails: [
        { path: "seed.txt", additions: 2, deletions: 1 },
        { path: "new.txt", additions: 1, deletions: 0 },
      ],
    });
    const client = new LiveGitClient();

    const details = await client.commitDetails("ws-1", "abc123");

    expect(mockedRequest).toHaveBeenCalledWith("git.commitDetails", {
      workspaceId: "ws-1",
      commitHash: "abc123",
    });
    expect(details).toEqual({
      commitHash: "abc123",
      author: "Ada",
      authorEmail: "ada@example.test",
      date: "2025-01-02T03:04:05Z",
      message: "second",
      files: ["seed.txt", "new.txt"],
      fileDetails: [
        { path: "seed.txt", additions: 2, deletions: 1 },
        { path: "new.txt", additions: 1, deletions: 0 },
      ],
    });
  });

  it("commitDetails normalizes a graceful-empty envelope from the daemon", async () => {
    // The daemon returns an empty envelope (same `commitHash`, empty arrays)
    // for non-repo / remote / unresolvable-hash workspaces (PROTOCOL §5.6).
    mockedRequest.mockResolvedValueOnce({
      commitHash: "missing",
      author: "",
      authorEmail: "",
      date: "",
      message: "",
      files: [],
      fileDetails: [],
    });
    const client = new LiveGitClient();

    const details = await client.commitDetails("ws-1", "missing");

    expect(details).toEqual({
      commitHash: "missing",
      author: "",
      authorEmail: "",
      date: "",
      message: "",
      files: [],
      fileDetails: [],
    });
  });

  it("commitDetails resolves null when the daemon errors", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("commit details boom"));
    const client = new LiveGitClient();

    expect(await client.commitDetails("ws-1", "abc123")).toBeNull();
  });

  it("commits forwards git.commits and maps items into CommitInfo[]", async () => {
    mockedRequest.mockResolvedValueOnce({
      items: [
        {
          hash: "abc123",
          sha: "abc1234",
          author: "Ada",
          email: "ada@example.test",
          date: "2025-01-02T03:04:05Z",
          message: "init",
          files: ["a.ts", "b.ts"],
          agentId: "agent-1",
          linkedNoteId: "note-1",
        },
      ],
      nextToken: null,
    });
    const client = new LiveGitClient();

    const commits = await client.commits("ws-1");

    expect(mockedRequest).toHaveBeenCalledWith("git.commits", { workspaceId: "ws-1" });
    expect(commits).toEqual([
      {
        hash: "abc123",
        message: "init",
        author: "Ada",
        authorEmail: "ada@example.test",
        timestamp: Date.parse("2025-01-02T03:04:05Z"),
        date: "2025-01-02T03:04:05Z",
        files: [{ path: "a.ts" }, { path: "b.ts" }],
        stage: "local",
        agentId: "agent-1",
        linkedNoteId: "note-1",
      },
    ]);
  });

  it("commits resolves [] when the daemon errors", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("log boom"));
    const client = new LiveGitClient();

    expect(await client.commits("ws-1")).toEqual([]);
  });

  it("trackedChanges forwards git.changes and maps files into TrackedChange[]", async () => {
    mockedRequest.mockResolvedValueOnce({
      files: [
        { path: "a.ts", status: "M", staged: true },
        { path: "b.ts", status: "?", staged: false },
        { path: "c.ts", status: "D", staged: false },
      ],
    });
    const client = new LiveGitClient();

    const tracked = await client.trackedChanges("ws-1");

    expect(mockedRequest).toHaveBeenCalledWith("git.changes", { workspaceId: "ws-1" });
    expect(tracked).toHaveLength(3);
    expect(tracked[0]).toMatchObject({
      id: "a.ts",
      file: "a.ts",
      relativePath: "a.ts",
      stage: "staged",
      status: "modified",
      stats: { additions: 0, deletions: 0 },
    });
    expect(tracked[1]).toMatchObject({
      id: "b.ts",
      stage: "unstaged",
      status: "added",
    });
    expect(tracked[2]).toMatchObject({
      id: "c.ts",
      stage: "unstaged",
      status: "deleted",
    });
  });

  it("trackedChanges resolves [] when the daemon errors", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("changes boom"));
    const client = new LiveGitClient();

    expect(await client.trackedChanges("ws-1")).toEqual([]);
  });
});

describe("LiveGitClient.stage (fake transport)", () => {
  afterEach(() => vi.clearAllMocks());

  it("forwards git.stage with trimmed explicit paths and folds success", async () => {
    mockedRequest.mockResolvedValueOnce({ branch: "main", files: [] });
    const client = new LiveGitClient();

    const result = await client.stage("ws-1", [" a.ts ", "b.ts", ""]);

    expect(mockedRequest).toHaveBeenCalledWith("git.stage", {
      workspaceId: "ws-1",
      paths: ["a.ts", "b.ts"],
    });
    expect(result).toEqual({ success: true });
  });

  it("rejects all-files globs upstream WITHOUT touching the daemon", async () => {
    const client = new LiveGitClient();

    for (const glob of [".", "*", "git add --all"]) {
      const result = await client.stage("ws-1", [glob]);
      expect(result.success).toBe(false);
    }
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it("rejects an empty path list WITHOUT touching the daemon", async () => {
    const client = new LiveGitClient();

    const result = await client.stage("ws-1", ["   ", ""]);

    expect(result.success).toBe(false);
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it("maps a daemon stage error into a failed MutationResult", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("stage boom"));
    const client = new LiveGitClient();

    expect(await client.stage("ws-1", ["a.ts"])).toEqual({
      success: false,
      error: "stage boom",
    });
  });
});

describe("LiveGitClient.commit (fake transport)", () => {
  afterEach(() => vi.clearAllMocks());

  it("forwards git.agentCommit with message + userRequested and optional files", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true, hash: "abc", files: ["a.ts"], fileCount: 1 });
    const client = new LiveGitClient();

    const result = await client.commit("ws-1", {
      message: "msg",
      files: ["a.ts"],
      userRequested: true,
    });

    expect(mockedRequest).toHaveBeenCalledWith("git.agentCommit", {
      workspaceId: "ws-1",
      message: "msg",
      files: ["a.ts"],
      userRequested: true,
    });
    expect(result).toEqual({ success: true });
  });

  it("omits files when not provided and does NOT forward amend/idempotencyKey", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveGitClient();

    await client.commit("ws-1", { message: "msg", amend: true, userRequested: true });

    expect(mockedRequest).toHaveBeenCalledWith("git.agentCommit", {
      workspaceId: "ws-1",
      message: "msg",
      userRequested: true,
    });
  });

  it("refuses to commit (and never calls the daemon) when userRequested is false", async () => {
    const client = new LiveGitClient();

    const result = await client.commit("ws-1", { message: "msg", userRequested: false });

    expect(result.success).toBe(false);
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it("maps a daemon commit error into a failed MutationResult", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("commit boom"));
    const client = new LiveGitClient();

    expect(await client.commit("ws-1", { message: "msg", userRequested: true })).toEqual({
      success: false,
      error: "commit boom",
    });
  });
});
