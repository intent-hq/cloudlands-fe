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
// params it forwards to the mocked transport) but pin `newIdempotencyKey` to a
// deterministic value and stub the subscribe-only helpers.
vi.mock("./live-support", async (importActual) => {
  const actual = await importActual<typeof import("./live-support")>();
  return {
    ...actual,
    isEventInFamily: vi.fn(() => false),
    listWorkspaceIds: vi.fn(() => Promise.resolve([])),
    newIdempotencyKey: vi.fn(() => "idk-test"),
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

  it("keeps diff / commit / tracked-change reads degraded (daemon has no such methods)", async () => {
    const client = new LiveGitClient();

    expect(await client.diffs("ws-1")).toEqual([]);
    expect(await client.commits("ws-1")).toEqual([]);
    expect(await client.trackedChanges("ws-1")).toEqual([]);
    expect(mockedRequest).not.toHaveBeenCalled();
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

  it("forwards git.commit with userRequested + idempotencyKey and optional files/amend", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true, hash: "abc" });
    const client = new LiveGitClient();

    const result = await client.commit("ws-1", {
      message: "msg",
      files: ["a.ts"],
      amend: true,
      userRequested: true,
    });

    expect(mockedRequest).toHaveBeenCalledWith("git.commit", {
      workspaceId: "ws-1",
      message: "msg",
      files: ["a.ts"],
      amend: true,
      userRequested: true,
      idempotencyKey: "idk-test",
    });
    expect(result).toEqual({ success: true });
  });

  it("omits files/amend when not provided", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });
    const client = new LiveGitClient();

    await client.commit("ws-1", { message: "msg", userRequested: true });

    expect(mockedRequest).toHaveBeenCalledWith("git.commit", {
      workspaceId: "ws-1",
      message: "msg",
      userRequested: true,
      idempotencyKey: "idk-test",
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
