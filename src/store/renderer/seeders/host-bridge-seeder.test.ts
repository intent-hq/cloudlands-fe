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

  describe("system:check-rtk → daemon host.findBinary", () => {
    it("forwards { name:'rtk' } and folds a positive probe to {success:true, data:{available:true}}", async () => {
      // PROTOCOL host.findBinary: `{ available, path? }` — the daemon does the
      // `which` walk on the host where workspaces run.
      mockedRequest.mockResolvedValueOnce({ available: true, path: "/opt/homebrew/bin/rtk" });

      const response = await mockInvoke(IPC_CHANNELS.SYSTEM.CHECK_RTK);

      expect(mockedRequest).toHaveBeenCalledWith("host.findBinary", { name: "rtk" });
      expect(response).toEqual({ success: true, data: { available: true } });
    });

    it("folds a daemon-reported missing binary to {available:false}", async () => {
      mockedRequest.mockResolvedValueOnce({ available: false });

      const response = await mockInvoke(IPC_CHANNELS.SYSTEM.CHECK_RTK);

      expect(response).toEqual({ success: true, data: { available: false } });
    });

    it("folds an RPC failure to {available:false} so the toggle just stays disabled", async () => {
      mockedRequest.mockRejectedValueOnce(new Error("transport down"));

      const response = await mockInvoke(IPC_CHANNELS.SYSTEM.CHECK_RTK);

      expect(response).toEqual({ success: true, data: { available: false } });
    });
  });

  describe("editor-open intents → daemon host.openInEditor (PROTOCOL §5.14)", () => {
    it("vscode:open with a string path sends host.openInEditor {editorId:'vscode', path}", async () => {
      mockedRequest.mockResolvedValueOnce({ ok: true });

      const response = await mockInvoke("vscode:open", "/Users/alex/code/project");

      expect(mockedRequest).toHaveBeenCalledWith("host.openInEditor", {
        editorId: "vscode",
        path: "/Users/alex/code/project",
      });
      expect(response).toEqual({ success: true });
    });

    it("vscode:open with {folder, file} prefers the file (§5.14 takes one path)", async () => {
      mockedRequest.mockResolvedValueOnce({ ok: true });

      await mockInvoke("vscode:open", {
        folder: "/Users/alex/code/project",
        file: "/Users/alex/code/project/src/main.rs",
      });

      expect(mockedRequest).toHaveBeenCalledWith("host.openInEditor", {
        editorId: "vscode",
        path: "/Users/alex/code/project/src/main.rs",
      });
    });

    it("vscode:open-git-diff opens the workspace folder (falls back to the file path)", async () => {
      mockedRequest.mockResolvedValueOnce({ ok: true });

      await mockInvoke("vscode:open-git-diff", {
        filePath: "/repo/src/a.ts",
        workspacePath: "/repo",
      });

      expect(mockedRequest).toHaveBeenCalledWith("host.openInEditor", {
        editorId: "vscode",
        path: "/repo",
      });
    });

    it("external-editors:open forwards the caller's editorId verbatim", async () => {
      mockedRequest.mockResolvedValueOnce({ ok: true });

      await mockInvoke("external-editors:open", { editorId: "zed", path: "/repo" });

      expect(mockedRequest).toHaveBeenCalledWith("host.openInEditor", {
        editorId: "zed",
        path: "/repo",
      });
    });

    it("xcode:open with {folder, file} opens the project folder", async () => {
      mockedRequest.mockResolvedValueOnce({ ok: true });

      await mockInvoke("xcode:open", { folder: "/repo", file: "/repo/App.swift" });

      expect(mockedRequest).toHaveBeenCalledWith("host.openInEditor", {
        editorId: "xcode",
        path: "/repo",
      });
    });

    it("jetbrains:open resolves the first installed JetBrains id via host.listInstalledEditors", async () => {
      // PROTOCOL §5.14 listInstalledEditors entry: { id, installed, path?, source?, flatpakId? }.
      mockedRequest.mockResolvedValueOnce({
        editors: [
          { id: "vscode", installed: true, source: "macAppBundle" },
          { id: "intellij", installed: false },
          { id: "webstorm", installed: true, source: "macAppBundle" },
        ],
      });
      mockedRequest.mockResolvedValueOnce({ ok: true });

      await mockInvoke("jetbrains:open", "/repo");

      expect(mockedRequest).toHaveBeenNthCalledWith(1, "host.listInstalledEditors");
      expect(mockedRequest).toHaveBeenNthCalledWith(2, "host.openInEditor", {
        editorId: "webstorm",
        path: "/repo",
      });
    });

    it("jetbrains:open rejects visibly when no JetBrains IDE is installed", async () => {
      mockedRequest.mockResolvedValueOnce({
        editors: [{ id: "vscode", installed: true }],
      });

      await expect(mockInvoke("jetbrains:open", "/repo")).rejects.toThrow(
        /No JetBrains IDE found/,
      );
      expect(mockedRequest).toHaveBeenCalledTimes(1);
    });

    it("a daemon launch failure rejects so call sites' catch blocks surface it", async () => {
      mockedRequest.mockRejectedValueOnce(
        new Error("editor 'vscode' is not installed on the daemon host"),
      );

      await expect(mockInvoke("vscode:open", "/repo")).rejects.toThrow(
        "editor 'vscode' is not installed on the daemon host",
      );
    });

    it("vscode:open rejects when no path can be resolved (no daemon call)", async () => {
      await expect(mockInvoke("vscode:open", {})).rejects.toThrow(
        "Missing required parameter: path",
      );
      expect(mockedRequest).not.toHaveBeenCalled();
    });
  });

  describe("external-editors:detect-installed → daemon host.listInstalledEditors", () => {
    it("enriches daemon detection facts with EDITOR_REGISTRY display metadata", async () => {
      mockedRequest.mockResolvedValueOnce({
        editors: [
          { id: "vscode", installed: true, path: "/Applications/Visual Studio Code.app", source: "macAppBundle" },
          { id: "warp", installed: false },
          { id: "not-a-known-editor", installed: true },
        ],
      });

      const response = await mockInvoke<{
        success: boolean;
        data: Array<Record<string, unknown>>;
      }>(IPC_CHANNELS.EXTERNAL_EDITORS.DETECT_INSTALLED);

      expect(mockedRequest).toHaveBeenCalledWith("host.listInstalledEditors");
      expect(response.success).toBe(true);
      // Unknown ids are dropped; known ids carry registry metadata + the
      // daemon's installed flag.
      expect(response.data.map((e) => e.id)).toEqual(["vscode", "warp"]);
      const vscode = response.data[0];
      expect(vscode.installed).toBe(true);
      expect(vscode.name).toBe("VS Code");
      expect(vscode.handlerType).toBe("vscode");
      expect(vscode.category).toBe("ide");
      const warp = response.data[1];
      expect(warp.installed).toBe(false);
      expect(warp.category).toBe("terminal");
    });

    it("folds an RPC failure to {success:false, error} so fetchEditorsFailure carries the message", async () => {
      mockedRequest.mockRejectedValueOnce(new Error("transport down"));

      const response = await mockInvoke<{ success: boolean; error?: string }>(
        IPC_CHANNELS.EXTERNAL_EDITORS.DETECT_INSTALLED,
      );

      expect(response).toEqual({ success: false, error: "transport down" });
    });
  });
});
