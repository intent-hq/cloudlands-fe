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

vi.mock("./live-support", () => ({
  isEventInFamily: vi.fn(() => false),
  listWorkspaceIds: vi.fn(() => Promise.resolve([])),
}));

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
