import { afterEach, describe, expect, it, vi } from "vitest";

// FAKE transport only: the backend bridge is mocked so no request ever reaches
// the user's real daemon. Each test asserts the JSON-RPC method + params the
// client emits and how it maps the daemon result.
vi.mock("./backend-transport", () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(() => Promise.resolve({ subscriptionId: "sub-1" })),
  backendUnsubscribe: vi.fn(() => Promise.resolve()),
  onBackendNotification: vi.fn(() => () => {}),
  // RESUB-1: subscribe() installs a reconnect listener; these tests do not
  // exercise reconnect so the mock is a no-op disposer.
  onBackendReconnected: vi.fn(() => () => {}),
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

import { backendRequest, backendSubscribe, onBackendNotification } from "./backend-transport";
import { isEventInFamily, listWorkspaceIds } from "./live-support";
import { LiveGitClient } from "./live-git-client";

const mockedRequest = vi.mocked(backendRequest);
const mockedSubscribe = vi.mocked(backendSubscribe);
const mockedIsEventInFamily = vi.mocked(isEventInFamily);
const mockedListWorkspaceIds = vi.mocked(listWorkspaceIds);
const mockedOnBackendNotification = vi.mocked(onBackendNotification);

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

  // §5.19 `file-tracking.loadCommits` returns `{ commits: CommitWithAttribution[] }`
  // (hash/message/author/date/filesChanged/isPushed/files?/agentId?/linkedNoteId?).
  it("commits forwards file-tracking.loadCommits and maps CommitWithAttribution[] into CommitInfo[]", async () => {
    mockedRequest.mockResolvedValueOnce({
      commits: [
        {
          hash: "abc123",
          message: "init",
          author: "Ada",
          date: "2025-01-02T03:04:05Z",
          filesChanged: 2,
          isPushed: false,
          files: [
            { path: "a.ts", additions: 10, deletions: 2, status: "modified" },
            { path: "b.ts" },
          ],
          agentId: "agent-1",
          linkedNoteId: "note-1",
        },
        {
          hash: "def456",
          message: "pushed one",
          author: "Ada",
          date: "2025-01-01T00:00:00Z",
          filesChanged: 0,
          isPushed: true,
        },
      ],
    });
    const client = new LiveGitClient();

    const commits = await client.commits("ws-1");

    expect(mockedRequest).toHaveBeenCalledWith("file-tracking.loadCommits", {
      workspaceId: "ws-1",
    });
    expect(commits).toEqual([
      {
        hash: "abc123",
        message: "init",
        author: "Ada",
        timestamp: Date.parse("2025-01-02T03:04:05Z"),
        date: "2025-01-02T03:04:05Z",
        files: [
          { path: "a.ts", additions: 10, deletions: 2, status: "modified" },
          { path: "b.ts" },
        ],
        filesChanged: 2,
        stage: "local",
        isPushed: false,
        agentId: "agent-1",
        linkedNoteId: "note-1",
      },
      {
        hash: "def456",
        message: "pushed one",
        author: "Ada",
        timestamp: Date.parse("2025-01-01T00:00:00Z"),
        date: "2025-01-01T00:00:00Z",
        files: [],
        filesChanged: 0,
        stage: "pushed",
        isPushed: true,
      },
    ]);
  });

  it("commits resolves [] when the daemon errors", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("log boom"));
    const client = new LiveGitClient();

    expect(await client.commits("ws-1")).toEqual([]);
  });

  // §5.19 `file-tracking.getChanges` returns `{ changes, truncated, totalCount }`
  // where each change mirrors the renderer `TrackedChange` (stage/stats/attribution).
  it("trackedChanges forwards file-tracking.getChanges and carries the §5.19 TrackedChange fields through", async () => {
    mockedRequest.mockResolvedValueOnce({
      changes: [
        {
          id: "git-1-src/x.ts",
          file: "/ws/src/x.ts",
          relativePath: "src/x.ts",
          stage: "committed",
          status: "modified",
          stats: { additions: 10, deletions: 2 },
          attribution: {
            agent: {
              agentId: "agent-123",
              agentName: "Coordinator",
              sessionId: "sess-9",
              turnNumber: 4,
              timestamp: 1750000000000,
            },
            timestamp: 1750000000000,
          },
          commitHash: "abc123",
        },
        {
          id: "b.ts",
          file: "b.ts",
          relativePath: "b.ts",
          stage: "unstaged",
          status: "added",
          stats: { additions: 3, deletions: 0 },
          attribution: { manual: true, timestamp: 1750000001000 },
        },
      ],
      truncated: false,
      totalCount: 2,
    });
    const client = new LiveGitClient();

    const tracked = await client.trackedChanges("ws-1");

    expect(mockedRequest).toHaveBeenCalledWith("file-tracking.getChanges", {
      workspaceId: "ws-1",
    });
    expect(tracked).toHaveLength(2);
    expect(tracked[0]).toEqual({
      id: "git-1-src/x.ts",
      file: "/ws/src/x.ts",
      relativePath: "src/x.ts",
      stage: "committed",
      status: "modified",
      stats: { additions: 10, deletions: 2 },
      attribution: {
        agent: {
          agentId: "agent-123",
          agentName: "Coordinator",
          sessionId: "sess-9",
          turnNumber: 4,
          timestamp: 1750000000000,
        },
        timestamp: 1750000000000,
      },
      commitHash: "abc123",
    });
    expect(tracked[1]).toMatchObject({
      id: "b.ts",
      stage: "unstaged",
      status: "added",
      stats: { additions: 3, deletions: 0 },
      attribution: { manual: true, timestamp: 1750000001000 },
    });
  });

  it("trackedChanges resolves [] when the daemon errors", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("changes boom"));
    const client = new LiveGitClient();

    expect(await client.trackedChanges("ws-1")).toEqual([]);
  });

  // `git.getBranches` is path-based (not workspace-scoped) and is the new
  // wire that replaces the dead `invoke('git:getBranches')` legacy IPC in the
  // workspace initializer (P2 task). The contract asserts method + params
  // verbatim, and the renderer-shape mapping mirrors the daemon `GitBranches`
  // payload (snake_case → camelCase by serde).
  it("getBranches forwards git.getBranches with the documented params and maps the daemon payload", async () => {
    mockedRequest.mockResolvedValueOnce({
      branches: ["main", "feature/x"],
      remoteBranches: ["origin/release"],
      currentBranch: "feature/x",
      defaultBranch: "main",
    });
    const client = new LiveGitClient();

    const result = await client.getBranches("/Users/clement/src/intent", true);

    expect(mockedRequest).toHaveBeenCalledWith("git.getBranches", {
      repoPath: "/Users/clement/src/intent",
      includeRemote: true,
    });
    expect(result).toEqual({
      branches: ["main", "feature/x"],
      remoteBranches: ["origin/release"],
      currentBranch: "feature/x",
      defaultBranch: "main",
    });
  });

  it("getBranches resolves null when the daemon errors (e.g. known-repo gate rejection)", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("Unknown or unauthorized repository path"));
    const client = new LiveGitClient();

    expect(await client.getBranches("/tmp/not-a-repo", true)).toBeNull();
  });

  it("getBranches resolves null when the daemon returns undefined (no crash on missing payload)", async () => {
    mockedRequest.mockResolvedValueOnce(undefined as unknown as Record<string, unknown>);
    const client = new LiveGitClient();

    // Guard against the original BranchSelector crash: a missing payload
    // would have thrown "Cannot read properties of undefined (reading
    // 'success')" before this fix. Now it folds to null.
    expect(await client.getBranches("/repo", true)).toBeNull();
  });

  it("getBranches tolerates partial payloads by defaulting missing fields", async () => {
    mockedRequest.mockResolvedValueOnce({ branches: ["main"] });
    const client = new LiveGitClient();

    expect(await client.getBranches("/repo", false)).toEqual({
      branches: ["main"],
      remoteBranches: [],
      currentBranch: "",
      defaultBranch: "",
    });
    expect(mockedRequest).toHaveBeenCalledWith("git.getBranches", {
      repoPath: "/repo",
      includeRemote: false,
    });
  });

  // `git.branchStatus` is the path-based BranchSelector seam (PROTOCOL §5.6)
  // that replaces the legacy `invoke('git:getBranchStatus')` Electron IPC. The
  // contract asserts method + params verbatim and the renderer-shape mapping
  // mirrors the daemon `GitBranchStatus` payload (snake_case → camelCase).
  it("branchStatus forwards git.branchStatus with the documented params and maps the daemon payload", async () => {
    mockedRequest.mockResolvedValueOnce({
      branch: "feature/x",
      currentBranch: "main",
      isCurrentBranch: false,
      ahead: 0,
      behind: 3,
      hasUncommittedChanges: true,
    });
    const client = new LiveGitClient();

    const result = await client.branchStatus("/Users/clement/src/intent", "feature/x");

    expect(mockedRequest).toHaveBeenCalledWith("git.branchStatus", {
      repoPath: "/Users/clement/src/intent",
      branchName: "feature/x",
    });
    expect(result).toEqual({
      branch: "feature/x",
      currentBranch: "main",
      isCurrentBranch: false,
      ahead: 0,
      behind: 3,
      hasUncommittedChanges: true,
    });
  });

  it("branchStatus resolves null when the daemon errors (e.g. known-repo gate rejection)", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("Unknown or unauthorized repository path"));
    const client = new LiveGitClient();

    expect(await client.branchStatus("/tmp/not-a-repo", "main")).toBeNull();
  });

  it("branchStatus resolves null when the daemon returns undefined (no crash on missing payload)", async () => {
    mockedRequest.mockResolvedValueOnce(undefined as unknown as Record<string, unknown>);
    const client = new LiveGitClient();

    expect(await client.branchStatus("/repo", "main")).toBeNull();
  });

  it("branchStatus tolerates partial payloads by defaulting missing fields", async () => {
    mockedRequest.mockResolvedValueOnce({ behind: 2 });
    const client = new LiveGitClient();

    expect(await client.branchStatus("/repo", "main")).toEqual({
      branch: "main",
      currentBranch: "",
      isCurrentBranch: false,
      ahead: 0,
      behind: 2,
      hasUncommittedChanges: false,
    });
    expect(mockedRequest).toHaveBeenCalledWith("git.branchStatus", {
      repoPath: "/repo",
      branchName: "main",
    });
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

// `git.unstage` (PROTOCOL §5.6 extensions) is the inverse of `git.stage` and
// shares the explicit-paths contract (all-files globs rejected upstream).
describe("LiveGitClient.unstage (fake transport)", () => {
  afterEach(() => vi.clearAllMocks());

  it("forwards git.unstage with trimmed explicit paths and folds success", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true, paths: ["a.ts", "b.ts"] });
    const client = new LiveGitClient();

    const result = await client.unstage("ws-1", [" a.ts ", "b.ts", ""]);

    expect(mockedRequest).toHaveBeenCalledWith("git.unstage", {
      workspaceId: "ws-1",
      paths: ["a.ts", "b.ts"],
    });
    expect(result).toEqual({ success: true });
  });

  it("rejects all-files globs and empty lists upstream WITHOUT touching the daemon", async () => {
    const client = new LiveGitClient();

    for (const paths of [["."], ["*"], ["git reset --all"], ["   ", ""]]) {
      const result = await client.unstage("ws-1", paths);
      expect(result.success).toBe(false);
    }
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it("maps a daemon unstage error into a failed MutationResult", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("unstage boom"));
    const client = new LiveGitClient();

    expect(await client.unstage("ws-1", ["a.ts"])).toEqual({
      success: false,
      error: "unstage boom",
    });
  });
});

// `git.discard` (PROTOCOL §5.6 extensions) discards working-tree changes for
// explicit paths (DESTRUCTIVE); same params/validation family as git.stage.
describe("LiveGitClient.discard (fake transport)", () => {
  afterEach(() => vi.clearAllMocks());

  it("forwards git.discard with trimmed explicit paths and folds success", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true, paths: ["a.ts"] });
    const client = new LiveGitClient();

    const result = await client.discard("ws-1", [" a.ts ", ""]);

    expect(mockedRequest).toHaveBeenCalledWith("git.discard", {
      workspaceId: "ws-1",
      paths: ["a.ts"],
    });
    expect(result).toEqual({ success: true });
  });

  it("rejects all-files globs and empty lists upstream WITHOUT touching the daemon", async () => {
    const client = new LiveGitClient();

    for (const paths of [["."], ["*"], ["git checkout --all"], ["   ", ""]]) {
      const result = await client.discard("ws-1", paths);
      expect(result.success).toBe(false);
    }
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it("maps a daemon discard error into a failed MutationResult", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("discard boom"));
    const client = new LiveGitClient();

    expect(await client.discard("ws-1", ["a.ts"])).toEqual({
      success: false,
      error: "discard boom",
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

// `git.pull` (PROTOCOL §5.6) is path-based like `git.getBranches`: the
// workspace-create auto-pull runs before the repo is registered as a
// workspace. It replaces the dead legacy `invoke('git:pullBranch')` IPC.
// Ordinary pull failures are the structured `{ ok: false, error }` result,
// never a JSON-RPC error.
describe("LiveGitClient.pull (fake transport)", () => {
  afterEach(() => vi.clearAllMocks());

  it("forwards git.pull with the documented params and folds { ok: true } to success", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveGitClient();

    const result = await client.pull("/Users/clement/src/intent", "main");

    expect(mockedRequest).toHaveBeenCalledWith("git.pull", {
      repoPath: "/Users/clement/src/intent",
      branchName: "main",
    });
    expect(result).toEqual({ success: true });
  });

  it("maps the structured { ok: false, error } failure into a failed MutationResult", async () => {
    mockedRequest.mockResolvedValueOnce({
      ok: false,
      error: "Merge conflict detected. Please resolve conflicts manually.",
    });
    const client = new LiveGitClient();

    expect(await client.pull("/repo", "main")).toEqual({
      success: false,
      error: "Merge conflict detected. Please resolve conflicts manually.",
    });
  });

  it("falls back to a generic message when the structured failure carries no error text", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: false });
    const client = new LiveGitClient();

    expect(await client.pull("/repo", "main")).toEqual({
      success: false,
      error: "Failed to pull changes",
    });
  });

  it("maps a JSON-RPC error (e.g. repoPath validation) into a failed MutationResult", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("Repository path does not exist: /tmp/nope"));
    const client = new LiveGitClient();

    expect(await client.pull("/tmp/nope", "main")).toEqual({
      success: false,
      error: "Repository path does not exist: /tmp/nope",
    });
  });
});

// `subscribe` refetches `git.status` on daemon notifications routed through
// `isEventInFamily`. Regression: when the matcher read a non-existent
// `params.type` on the wrapped `{event:{type,…}}` envelope, the "type absent"
// defensive branch fired for every events.event notification — including each
// `terminal:data` keystroke from the PTY work — producing a git-status storm.
// This suite swaps the mocked matcher for the REAL implementation and pins the
// routing end-to-end: terminal:data does NOT trigger `git.status`; git:* and
// changes:git-status do.
describe("LiveGitClient.subscribe event-family routing (fake transport)", () => {
  afterEach(() => vi.clearAllMocks());

  async function setupWithRealMatcher() {
    const real = await vi.importActual<typeof import("./live-support")>("./live-support");
    mockedIsEventInFamily.mockImplementation(real.isEventInFamily);
    mockedListWorkspaceIds.mockResolvedValue(["ws-1"]);
    let captured: ((n: { method: string; params: unknown }) => void) | undefined;
    mockedOnBackendNotification.mockImplementation((cb) => {
      captured = cb;
      return () => {};
    });
    mockedRequest.mockResolvedValue({
      branch: "main",
      ahead: 0,
      behind: 0,
      diverged: false,
      files: [],
      hasUncommittedChanges: false,
      hasUntrackedFiles: false,
    });
    return { getNotify: () => captured };
  }

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const gitStatusCalls = () =>
    mockedRequest.mock.calls.filter(([method]) => method === "git.status").length;

  it("does NOT refetch git.status on a wrapped terminal:data notification", async () => {
    const { getNotify } = await setupWithRealMatcher();
    const client = new LiveGitClient();

    const unsubscribe = client.subscribe(() => {});
    await flush();
    const initialCount = gitStatusCalls();

    getNotify()!({
      method: "events.event",
      params: { event: { type: "terminal:data", data: { chunk: "x" } } },
    });
    await flush();

    expect(gitStatusCalls()).toBe(initialCount);
    unsubscribe();
  });

  it("DOES refetch git.status on a wrapped git:commit notification", async () => {
    const { getNotify } = await setupWithRealMatcher();
    const client = new LiveGitClient();

    const unsubscribe = client.subscribe(() => {});
    await flush();
    const initialCount = gitStatusCalls();

    getNotify()!({
      method: "events.event",
      params: { event: { type: "git:commit" }, subscriptionId: "s-1" },
    });
    await flush();

    expect(gitStatusCalls()).toBe(initialCount + 1);
    expect(mockedRequest).toHaveBeenLastCalledWith("git.status", { workspaceId: "ws-1" });
    unsubscribe();
  });

  it("DOES refetch git.status on a wrapped changes:git-status notification", async () => {
    const { getNotify } = await setupWithRealMatcher();
    const client = new LiveGitClient();

    const unsubscribe = client.subscribe(() => {});
    await flush();
    const initialCount = gitStatusCalls();

    getNotify()!({
      method: "events.event",
      params: { event: { type: "changes:git-status" } },
    });
    await flush();

    expect(gitStatusCalls()).toBe(initialCount + 1);
    unsubscribe();
  });

  // §6.5: `changes:tracked` (daemon tracked-change writes) must refresh the
  // display like `changes:git-status` does — the local file-tracking store is
  // retired, so these events are the only signal that tracked changes moved.
  it("DOES refetch git.status on a wrapped changes:tracked notification", async () => {
    const { getNotify } = await setupWithRealMatcher();
    const client = new LiveGitClient();

    const unsubscribe = client.subscribe(() => {});
    await flush();
    const initialCount = gitStatusCalls();

    getNotify()!({
      method: "events.event",
      params: { event: { type: "changes:tracked" } },
    });
    await flush();

    expect(gitStatusCalls()).toBe(initialCount + 1);
    unsubscribe();
  });

  it("subscribes to the git:* family plus changes:tracked and changes:git-status (§6.5)", async () => {
    await setupWithRealMatcher();
    const client = new LiveGitClient();

    const unsubscribe = client.subscribe(() => {});
    await flush();

    expect(mockedSubscribe).toHaveBeenCalledWith({
      eventTypes: [
        "git:commit",
        "git:push",
        "git:pull",
        "git:branch",
        "git:merge",
        "changes:tracked",
        "changes:git-status",
      ],
    });
    unsubscribe();
  });
});
