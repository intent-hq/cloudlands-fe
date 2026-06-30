/**
 * Wire-contract tests for the host IPC bridge seeder.
 *
 * Asserts each legacy renderer→main host probe registers a mock IPC handler
 * that (a) forwards to the canonical daemon `host.*` JSON-RPC method with the
 * right params, and (b) wraps the daemon response in the `{success,data}`
 * envelope the existing call sites (CompactWorkspaceInitializer, RepoSelector,
 * LocalRepoTab, ProjectPickerMessage, workspace-validation) already consume.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// FAKE transport only: the daemon bridge is mocked so no IPC ever fires.
// Each test asserts the JSON-RPC method + params the handler emits and how
// it maps the daemon result back to the renderer envelope.
vi.mock("$lib/client/live/backend-transport", () => ({
  backendRequest: vi.fn(),
}));

import { backendRequest } from "$lib/client/live/backend-transport";
import { mockInvoke } from "$shared/ipc-mock-router";
import { IPC_CHANNELS } from "$shared/ipc-registry";

const mockedRequest = vi.mocked(backendRequest);

describe("host-bridge-seeder", () => {
  beforeAll(async () => {
    // Importing the seeder runs its `registerMockIpcHandler` side effects.
    await import("./host-bridge-seeder");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("system:check-git → daemon host.checkGit", () => {
    it("forwards no params and wraps a positive probe in {success:true, data:{available:true, version}}", async () => {
      // PROTOCOL host.checkGit: `{ available, version?, path? }`. A missing
      // binary returns `available:false` rather than erroring (host_ops.rs).
      mockedRequest.mockResolvedValueOnce({
        available: true,
        version: "git version 2.43.0",
        path: "/usr/bin/git",
      });

      const response = await mockInvoke(IPC_CHANNELS.SYSTEM.CHECK_GIT);

      expect(mockedRequest).toHaveBeenCalledWith("host.checkGit");
      expect(response).toEqual({
        success: true,
        data: { available: true, version: "git version 2.43.0" },
      });
    });

    it("folds a daemon-reported missing binary (available:false) to {available:false} so the banner is suppressed", async () => {
      // Daemon contract: `available:false` is a normal probe answer, never
      // an RPC error. The FE banner gates on `data.available === true`, so
      // we must drop the optional `version`/`path` fields when unavailable.
      mockedRequest.mockResolvedValueOnce({ available: false });

      const response = await mockInvoke<{ success: boolean; data: { available: boolean } }>(
        IPC_CHANNELS.SYSTEM.CHECK_GIT,
      );

      expect(response).toEqual({ success: true, data: { available: false } });
    });

    it("folds an RPC failure to {available:false} so the home-screen banner is suppressed", async () => {
      // The pre-existing main-process handler swallowed errors as
      // `{available:false}` (system.ipc.ts:2996). Preserve that contract so
      // the FE never flashes the "Git not installed" banner on a transient
      // transport hiccup.
      mockedRequest.mockRejectedValueOnce(new Error("transport down"));

      const response = await mockInvoke<{ success: boolean; data: { available: boolean } }>(
        IPC_CHANNELS.SYSTEM.CHECK_GIT,
      );

      expect(response).toEqual({ success: true, data: { available: false } });
    });
  });

  describe("file:getDirectoryStatus → daemon host.directoryStatus", () => {
    it("forwards `{ path }` and surfaces the daemon shape verbatim under `data`", async () => {
      // PROTOCOL host.directoryStatus: classifier walking parents for a
      // `.git` dir / worktree pointer. The FE consumes the full shape
      // (exists/isDirectory/isEmpty/isGitRepo/isSubdirectoryOfGitRepo/path
      // + optional parentGitRoot/relativePathFromGitRoot) — pass through
      // unchanged so RepoSelector's "is this a new repo?" branch decides
      // correctly.
      const daemonShape = {
        exists: true,
        isDirectory: true,
        isEmpty: false,
        isGitRepo: false,
        isSubdirectoryOfGitRepo: true,
        path: "/Users/alex/code/project/sub",
        parentGitRoot: "/Users/alex/code/project",
        relativePathFromGitRoot: "sub",
      };
      mockedRequest.mockResolvedValueOnce(daemonShape);

      const response = await mockInvoke(IPC_CHANNELS.FILE.GET_DIRECTORY_STATUS, {
        path: "/Users/alex/code/project/sub",
      });

      expect(mockedRequest).toHaveBeenCalledWith("host.directoryStatus", {
        path: "/Users/alex/code/project/sub",
      });
      expect(response).toEqual({ success: true, data: daemonShape });
    });

    it("returns {success:false} when `path` is missing (no daemon call)", async () => {
      const response = await mockInvoke<{ success: boolean; error?: string }>(
        IPC_CHANNELS.FILE.GET_DIRECTORY_STATUS,
        {},
      );
      expect(mockedRequest).not.toHaveBeenCalled();
      expect(response.success).toBe(false);
      expect(response.error).toBe("path is required");
    });

    it("surfaces a daemon failure as {success:false, error:<message>}", async () => {
      mockedRequest.mockRejectedValueOnce(new Error("path outside workspace"));

      const response = await mockInvoke<{ success: boolean; error?: string }>(
        IPC_CHANNELS.FILE.GET_DIRECTORY_STATUS,
        { path: "/etc/passwd" },
      );

      expect(response.success).toBe(false);
      expect(response.error).toBe("path outside workspace");
    });
  });
});
