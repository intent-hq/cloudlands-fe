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

  describe("system:check-node → daemon host.findBinary", () => {
    it("forwards { name:'node' } and folds a meeting version to {available:true, versionOk:true, version}", async () => {
      // PROTOCOL host.findBinary: `{ available, path?, version? }` — the
      // version is best-effort. Node reports `v22.1.0`; the bridge strips the
      // leading `v` and compares against MINIMUM_NODE_VERSION (22.0.0).
      mockedRequest.mockResolvedValueOnce({
        available: true,
        path: "/usr/local/bin/node",
        version: "v22.1.0",
      });

      const response = await mockInvoke(IPC_CHANNELS.SYSTEM.CHECK_NODE);

      expect(mockedRequest).toHaveBeenCalledWith("host.findBinary", { name: "node" });
      expect(response).toEqual({
        success: true,
        data: { available: true, version: "22.1.0", versionOk: true },
      });
    });

    it("marks a too-old node versionOk:false while keeping the version for messaging", async () => {
      mockedRequest.mockResolvedValueOnce({
        available: true,
        path: "/usr/bin/node",
        version: "v18.19.0",
      });

      const response = await mockInvoke(IPC_CHANNELS.SYSTEM.CHECK_NODE);

      expect(response).toEqual({
        success: true,
        data: { available: true, version: "18.19.0", versionOk: false },
      });
    });

    it("folds a version-less probe (binary resolves, --version failed) to versionOk:false", async () => {
      // host_ops.rs: a binary that resolves but does not answer `--version`
      // is still available:true with no `version` field.
      mockedRequest.mockResolvedValueOnce({ available: true, path: "/usr/bin/node" });

      const response = await mockInvoke(IPC_CHANNELS.SYSTEM.CHECK_NODE);

      expect(response).toEqual({
        success: true,
        data: { available: true, version: undefined, versionOk: false },
      });
    });

    it("folds a daemon-reported missing binary to {available:false, versionOk:false}", async () => {
      mockedRequest.mockResolvedValueOnce({ available: false });

      const response = await mockInvoke(IPC_CHANNELS.SYSTEM.CHECK_NODE);

      expect(response).toEqual({
        success: true,
        data: { available: false, versionOk: false },
      });
    });

    it("folds an RPC failure to {available:false, versionOk:false} — never an error", async () => {
      mockedRequest.mockRejectedValueOnce(new Error("transport down"));

      const response = await mockInvoke(IPC_CHANNELS.SYSTEM.CHECK_NODE);

      expect(response).toEqual({
        success: true,
        data: { available: false, versionOk: false },
      });
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

  describe("vscode:openFile → daemon host.openInEditor", () => {
    it("opens the file in VS Code on the daemon host", async () => {
      mockedRequest.mockResolvedValueOnce({});

      const response = await mockInvoke("vscode:openFile", { file: "/repo/src/main.ts" });

      expect(mockedRequest).toHaveBeenCalledWith("host.openInEditor", {
        editorId: "vscode",
        path: "/repo/src/main.ts",
      });
      expect(response).toEqual({ success: true });
    });

    it("rejects a missing file path without touching the wire (caller catch surfaces it)", async () => {
      await expect(mockInvoke("vscode:openFile", {})).rejects.toThrow(
        "Missing required parameter: path",
      );
      expect(mockedRequest).not.toHaveBeenCalled();
    });
  });

  describe("external-editors:open-with-other → real Electron preload bridge (FE-served, PROTOCOL §5.14 host.pickApplication locus)", () => {
    // Same window.electronAPI stash/restore pattern as shell:openExternal
    // below — the seeder handler prefers the preload bridge when present and
    // folds to the not-available failure when it is not.
    let stashedElectronApi: unknown;

    const removeElectronApi = () => {
      stashedElectronApi = (window as any).electronAPI;
      delete (window as any).electronAPI;
    };
    const restoreElectronApi = () => {
      (window as any).electronAPI = stashedElectronApi;
    };

    it("forwards { path } to window.electronAPI.invoke and returns the bridge response verbatim when a preload bridge exists", async () => {
      const bridgeInvoke = vi
        .fn()
        .mockResolvedValue({ success: true, appName: "Sublime Text" });
      stashedElectronApi = (window as any).electronAPI;
      (window as any).electronAPI = { invoke: bridgeInvoke };

      const response = await mockInvoke("external-editors:open-with-other", {
        path: "/repo/src/main.ts",
      });

      expect(bridgeInvoke).toHaveBeenCalledWith("external-editors:open-with-other", {
        path: "/repo/src/main.ts",
      });
      // Daemon `backendRequest` is never touched — the chooser is CLIENT-owned.
      expect(mockedRequest).not.toHaveBeenCalled();
      expect(response).toEqual({ success: true, appName: "Sublime Text" });
      restoreElectronApi();
    });

    it("folds to the documented not-available failure when no preload bridge exists (bridge-less build)", async () => {
      removeElectronApi();

      const response = await mockInvoke("external-editors:open-with-other", {
        path: "/repo",
      });

      expect(mockedRequest).not.toHaveBeenCalled();
      expect(response).toEqual({
        success: false,
        error: "Opening with another application is not available in this build",
      });
      restoreElectronApi();
    });

    it("rejects a missing path without touching the preload bridge (mirrors external-editors:open editorId guard)", async () => {
      const bridgeInvoke = vi.fn();
      stashedElectronApi = (window as any).electronAPI;
      (window as any).electronAPI = { invoke: bridgeInvoke };

      await expect(mockInvoke("external-editors:open-with-other", {})).rejects.toThrow(
        "Missing required parameter: path",
      );
      expect(bridgeInvoke).not.toHaveBeenCalled();
      expect(mockedRequest).not.toHaveBeenCalled();
      restoreElectronApi();
    });
  });

  describe("shell:openExternal → openExternalUrl (FE-served, PROTOCOL §5.14 reverse-RPC locus)", () => {
    // src/test-setup.ts installs a global window.electronAPI mock whose
    // invoke() resolves { success: true } for any channel; stash it so the
    // no-preload fallback paths (window.open / anchor click) are reachable.
    let stashedElectronApi: unknown;

    const removeElectronApi = () => {
      stashedElectronApi = (window as any).electronAPI;
      delete (window as any).electronAPI;
    };
    const restoreElectronApi = () => {
      (window as any).electronAPI = stashedElectronApi;
    };

    it("prefers the real Electron preload bridge when window.electronAPI exists", async () => {
      const bridgeInvoke = vi.fn().mockResolvedValue({ success: true });
      stashedElectronApi = (window as any).electronAPI;
      (window as any).electronAPI = { invoke: bridgeInvoke };
      const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

      const response = await mockInvoke("shell:openExternal", { url: "https://example.com" });

      expect(bridgeInvoke).toHaveBeenCalledWith("shell:openExternal", {
        url: "https://example.com",
      });
      expect(openSpy).not.toHaveBeenCalled();
      expect(response).toEqual({ success: true });
      openSpy.mockRestore();
      restoreElectronApi();
    });

    it("opens the URL via window.open and severs the opener when no preload bridge exists", async () => {
      removeElectronApi();
      const fakeWindow = { opener: {} } as unknown as Window;
      const openSpy = vi.spyOn(window, "open").mockReturnValue(fakeWindow);

      const response = await mockInvoke("shell:openExternal", { url: "https://example.com" });

      expect(openSpy).toHaveBeenCalledWith("https://example.com", "_blank");
      expect(fakeWindow.opener).toBeNull();
      expect(response).toEqual({ success: true });
      openSpy.mockRestore();
      restoreElectronApi();
    });

    it("falls back to an anchor click instead of throwing when window.open is refused (regression: 'Unable to open external URL in this build')", async () => {
      // Electron hosts deny window.open from their window-open handler after
      // routing the URL to the system browser themselves — a null handle must
      // not reject, or every docs link in the packaged build shows an error.
      removeElectronApi();
      const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

      const response = await mockInvoke("shell:openExternal", { url: "https://example.com/docs" });

      expect(openSpy).toHaveBeenCalledWith("https://example.com/docs", "_blank");
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(response).toEqual({ success: true });
      clickSpy.mockRestore();
      openSpy.mockRestore();
      restoreElectronApi();
    });

    it("rejects a missing url or a non-http(s) scheme without opening anything", async () => {
      removeElectronApi();
      const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

      await expect(mockInvoke("shell:openExternal", {})).rejects.toThrow(
        "Missing required parameter: url",
      );
      await expect(
        mockInvoke("shell:openExternal", { url: "javascript:alert(1)" }),
      ).rejects.toThrow("Refusing to open non-http(s) URL externally: javascript:");
      await expect(
        mockInvoke("shell:openExternal", { url: "file:///etc/passwd" }),
      ).rejects.toThrow("Refusing to open non-http(s) URL externally: file:");
      await expect(mockInvoke("shell:openExternal", { url: "not a url" })).rejects.toThrow(
        "Invalid external URL: not a url",
      );
      expect(openSpy).not.toHaveBeenCalled();
      openSpy.mockRestore();
      restoreElectronApi();
    });
  });

  describe("system:execute-command → daemon host.exec (PROTOCOL §5.14)", () => {
    // Route the two daemon methods the handler touches: `system.status` for
    // the host-OS shell pick and `host.exec` for the one-shot run. Payloads
    // mirror PROTOCOL §5.7 / §5.14.
    function routeDaemon(responses: Record<string, unknown>): void {
      mockedRequest.mockImplementation(async (method: string) => {
        if (!(method in responses)) throw new Error(`unexpected daemon method: ${method}`);
        return responses[method];
      });
    }

    const localHost = (os: string) => ({
      running: true,
      host: { os, arch: "arm64", hasDisplay: true, locality: "local" },
    });

    /** All params of every `host.exec` call the handler emitted. */
    const hostExecCalls = () =>
      mockedRequest.mock.calls.filter(([method]) => method === "host.exec");

    it("passes cwd + workspaceId wire-native (no cd wrapper) so the daemon containment guard runs (monorepo#537)", async () => {
      routeDaemon({
        "system.status": localHost("macos"),
        "host.exec": { stdout: "[main abc1234] amended\n", stderr: "", exitCode: 0 },
      });

      const response = await mockInvoke(IPC_CHANNELS.SYSTEM.EXECUTE_COMMAND, {
        command: 'git commit --amend -m "fix: typo"',
        cwd: "/Users/alex/code/project",
        workspaceId: "ws-1",
      });

      expect(hostExecCalls()).toEqual([
        [
          "host.exec",
          {
            command: "/bin/sh",
            args: ["-c", 'git commit --amend -m "fix: typo"'],
            cwd: "/Users/alex/code/project",
            workspaceId: "ws-1",
            timeoutMs: 30_000,
          },
          { timeoutMs: 35_000 },
        ],
      ]);
      expect(response).toEqual({
        success: true,
        data: { stdout: "[main abc1234] amended\n", stderr: "", code: 0 },
      });
    });

    it("rejects a cwd-only payload with the schema-validation envelope before any daemon dispatch (monorepo#578)", async () => {
      const response = await mockInvoke(IPC_CHANNELS.SYSTEM.EXECUTE_COMMAND, {
        command: "git status",
        cwd: "/Users/alex/code/project",
      });

      // No system.status OS probe and no host.exec call — the rejection
      // precedes OS detection, so no `cd` wrapper can be emitted for any
      // daemon host OS (POSIX or Windows).
      expect(mockedRequest).not.toHaveBeenCalled();
      // Identical to the Electron bridge's createSafeValidatedHandler zod
      // rejection (SystemExecuteCommandSchema cwd⇒workspaceId refinement).
      expect(response).toEqual({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request parameters",
          details: [
            {
              code: "custom",
              message: "cwd requires workspaceId (PROTOCOL §5.14 containment guard)",
              path: ["workspaceId"],
            },
          ],
        },
      });
    });

    it("treats an empty-string cwd as absent (never armed the guard; blank cwd stays off the wire, hostExec parity)", async () => {
      routeDaemon({
        "system.status": localHost("macos"),
        "host.exec": { stdout: "ok\n", stderr: "", exitCode: 0 },
      });

      const response = await mockInvoke<{ success: boolean }>(
        IPC_CHANNELS.SYSTEM.EXECUTE_COMMAND,
        { command: "git --version", cwd: "" },
      );

      expect(hostExecCalls()[0][1]).toEqual({
        command: "/bin/sh",
        args: ["-c", "git --version"],
        timeoutMs: 30_000,
      });
      expect(response.success).toBe(true);
    });

    it("runs the bare command (no cd prefix) when no cwd is supplied", async () => {
      routeDaemon({
        "system.status": localHost("macos"),
        "host.exec": { stdout: "ok\n", stderr: "", exitCode: 0 },
      });

      await mockInvoke(IPC_CHANNELS.SYSTEM.EXECUTE_COMMAND, { command: "git --version" });

      expect(hostExecCalls()[0][1]).toEqual({
        command: "/bin/sh",
        args: ["-c", "git --version"],
        timeoutMs: 30_000,
      });
    });

    it("forwards workspaceId even without cwd (Electron-handler parity; inert on the wire per §5.14)", async () => {
      routeDaemon({
        "system.status": localHost("macos"),
        "host.exec": { stdout: "ok\n", stderr: "", exitCode: 0 },
      });

      await mockInvoke(IPC_CHANNELS.SYSTEM.EXECUTE_COMMAND, {
        command: "git --version",
        workspaceId: "ws-1",
      });

      expect(hostExecCalls()[0][1]).toEqual({
        command: "/bin/sh",
        args: ["-c", "git --version"],
        workspaceId: "ws-1",
        timeoutMs: 30_000,
      });
    });

    it("uses `cmd.exe /c` on a Windows daemon host with cwd + workspaceId wire-native", async () => {
      routeDaemon({
        "system.status": localHost("windows"),
        "host.exec": { stdout: "", stderr: "", exitCode: 0 },
      });

      await mockInvoke(IPC_CHANNELS.SYSTEM.EXECUTE_COMMAND, {
        command: "git push --force-with-lease",
        cwd: "C:\\code\\project",
        workspaceId: "ws-1",
      });

      expect(hostExecCalls()[0][1]).toEqual({
        command: "cmd.exe",
        args: ["/c", "git push --force-with-lease"],
        cwd: "C:\\code\\project",
        workspaceId: "ws-1",
        timeoutMs: 30_000,
      });
    });

    it("maps a non-zero exit to the Electron failure envelope with stdout/stderr/code preserved", async () => {
      // CommitsTimeline's force-push fallback branches on
      // `pushResult.data?.stderr?.includes('has no upstream branch')`, so the
      // buffers must survive the failure envelope verbatim.
      routeDaemon({
        "system.status": localHost("macos"),
        "host.exec": {
          stdout: "",
          stderr: "fatal: The current branch feat has no upstream branch\n",
          exitCode: 128,
        },
      });

      const response = await mockInvoke(IPC_CHANNELS.SYSTEM.EXECUTE_COMMAND, {
        command: "git push --force-with-lease",
        cwd: "/repo",
        workspaceId: "ws-1",
      });

      expect(response).toEqual({
        success: false,
        error: "Command execution failed",
        data: {
          stdout: "",
          stderr: "fatal: The current branch feat has no upstream branch\n",
          code: 128,
        },
      });
    });

    it("folds a transport/RPC error to the Electron catch envelope without leaking the command", async () => {
      routeDaemon({ "system.status": localHost("macos") });
      mockedRequest.mockRejectedValue(new Error("boom: something sensitive"));

      const response = await mockInvoke<{
        success: boolean;
        error?: string;
        data?: { stdout: string; stderr: string; code: number };
      }>(IPC_CHANNELS.SYSTEM.EXECUTE_COMMAND, {
        command: "git commit --amend -m secret-token",
        cwd: "/repo",
        workspaceId: "ws-1",
      });

      expect(response).toEqual({
        success: false,
        error: "Command execution failed",
        data: { stdout: "", stderr: "", code: 1 },
      });
      expect(JSON.stringify(response)).not.toContain("secret-token");
    });

    it("folds a system.status response without the §5.7 host block (older intentd) to the catch envelope without guessing a shell", async () => {
      routeDaemon({
        "system.status": { running: true },
        "host.exec": { stdout: "", stderr: "", exitCode: 0 },
      });

      const response = await mockInvoke(IPC_CHANNELS.SYSTEM.EXECUTE_COMMAND, {
        command: "git status",
        cwd: "/repo",
        workspaceId: "ws-1",
      });

      expect(response).toEqual({
        success: false,
        error: "Command execution failed",
        data: { stdout: "", stderr: "", code: 1 },
      });
      expect(hostExecCalls()).toEqual([]);
    });

    it("folds a system.status failure to the catch envelope without reaching host.exec", async () => {
      routeDaemon({ "host.exec": { stdout: "", stderr: "", exitCode: 0 } });

      const response = await mockInvoke(IPC_CHANNELS.SYSTEM.EXECUTE_COMMAND, {
        command: "git status",
        cwd: "/repo",
        workspaceId: "ws-1",
      });

      expect(response).toEqual({
        success: false,
        error: "Command execution failed",
        data: { stdout: "", stderr: "", code: 1 },
      });
      expect(hostExecCalls()).toEqual([]);
    });

    it("rejects a missing/empty command with the failure envelope and no daemon call", async () => {
      const response = await mockInvoke<{ success: boolean }>(
        IPC_CHANNELS.SYSTEM.EXECUTE_COMMAND,
        {},
      );

      expect(mockedRequest).not.toHaveBeenCalled();
      expect(response).toEqual({
        success: false,
        error: "Command execution failed",
        data: { stdout: "", stderr: "", code: 1 },
      });
    });
  });
});

describe("misc-ui-events-seeder window:open-new bridge", () => {
  // Registered by misc-ui-events-seeder (the catch-all UI seeder); tested
  // here alongside the other window.open-backed handler so the window-locus
  // bridges stay covered together.
  beforeAll(async () => {
    await import("./misc-ui-events-seeder");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens the route as a new browsing context off the current origin", async () => {
    const fakeWindow = { opener: {} } as unknown as Window;
    const openSpy = vi.spyOn(window, "open").mockReturnValue(fakeWindow);

    const response = await mockInvoke("window:open-new", { route: "/workspace/ws-1" });

    expect(openSpy).toHaveBeenCalledWith(
      `${window.location.origin}/workspace/ws-1`,
      "_blank",
    );
    expect(fakeWindow.opener).toBeNull();
    expect(response).toEqual({ success: true });
    openSpy.mockRestore();
  });

  it("throws when the open is blocked so the callers' catch-fallback navigation runs", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    await expect(mockInvoke("window:open-new", { route: "/workspace/new" })).rejects.toThrow(
      "Opening a new window is not available in this build",
    );
    openSpy.mockRestore();
  });
});
