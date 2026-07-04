/**
 * Wire-contract tests for the legacy settings-store bridge.
 *
 * Asserts `settings:get` / `settings:set` / `settings:update` route
 * daemon-owned keys to `settings.get` / `settings.update` (PROTOCOL §5.12)
 * with the mapped catalog paths, merge the `providers.paths` sub-keys, fall
 * back to namespaced localStorage for FE-only keys, and fold daemon failures
 * into the reference `{ success: false, error }` envelope. Also asserts the
 * feature-codes gate rejects (never a fake "Feature activated!").
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// FAKE transport only: the daemon bridge is mocked so no IPC ever fires.
vi.mock("$lib/client/live/backend-transport", () => ({
  backendRequest: vi.fn(),
}));

import { backendRequest } from "$lib/client/live/backend-transport";
import { mockInvoke } from "$shared/ipc-mock-router";
import {
  FEATURE_CODES_CHANNELS,
  PERSISTENCE_CHANNELS,
  SETTINGS_CHANNELS,
} from "$shared/ipc/channels";

const mockedRequest = vi.mocked(backendRequest);

type Envelope = { success: boolean; data?: unknown; error?: string };

// test-setup replaces window.localStorage with bare vi.fn() mocks; back them
// with an in-memory map so the FE-only persistence path is observable.
const localStore = new Map<string, string>();

describe("settings-legacy-bridge-seeder", () => {
  beforeAll(async () => {
    // Importing the seeder runs its `registerMockIpcHandler` side effects.
    await import("./settings-legacy-bridge-seeder");
  });

  beforeEach(() => {
    vi.mocked(window.localStorage.getItem).mockImplementation(
      (key: string) => localStore.get(key) ?? null,
    );
    vi.mocked(window.localStorage.setItem).mockImplementation((key: string, value: string) => {
      localStore.set(key, String(value));
    });
    vi.mocked(window.localStorage.removeItem).mockImplementation((key: string) => {
      localStore.delete(key);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    localStore.clear();
  });

  describe("settings:get", () => {
    it("routes daemon-owned keys to settings.get with the mapped catalog path", async () => {
      mockedRequest.mockResolvedValueOnce({ path: "git.autoCommit", value: false });
      const result = await mockInvoke<Envelope>(SETTINGS_CHANNELS.GET, { key: "autoCommit" });
      expect(mockedRequest).toHaveBeenCalledWith("settings.get", { path: "git.autoCommit" });
      expect(result).toEqual({ success: true, data: false });
    });

    it("reads provider path keys out of the daemon providers.paths object", async () => {
      mockedRequest.mockResolvedValueOnce({
        path: "providers.paths",
        value: { "claude-code": "/opt/bin/claude", codex: "/opt/bin/codex-acp" },
      });
      const result = await mockInvoke<Envelope>(SETTINGS_CHANNELS.GET, {
        key: "claude-codePath",
      });
      expect(mockedRequest).toHaveBeenCalledWith("settings.get", { path: "providers.paths" });
      expect(result).toEqual({ success: true, data: "/opt/bin/claude" });
    });

    it("reads FE-only keys from namespaced localStorage without touching the daemon", async () => {
      window.localStorage.setItem(
        "legacy-settings:downloadAttribution",
        JSON.stringify({ ajs_aid: "a1" }),
      );
      const result = await mockInvoke<Envelope>(SETTINGS_CHANNELS.GET, {
        key: "downloadAttribution",
      });
      expect(mockedRequest).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true, data: { ajs_aid: "a1" } });
    });

    it("folds a daemon failure into the reference failure envelope", async () => {
      mockedRequest.mockRejectedValueOnce(new Error("unknown setting"));
      const result = await mockInvoke<Envelope>(SETTINGS_CHANNELS.GET, { key: "autoCommit" });
      expect(result).toEqual({ success: false, error: "unknown setting" });
    });
  });

  describe("settings:set", () => {
    it("routes daemon-owned keys through a settings.update single-change batch", async () => {
      mockedRequest.mockResolvedValueOnce({ applied: [] });
      const result = await mockInvoke<Envelope>(SETTINGS_CHANNELS.SET, {
        key: "auggiePath",
        value: "/usr/local/bin/auggie",
      });
      expect(mockedRequest).toHaveBeenCalledWith("settings.update", {
        changes: [{ path: "context.auggiePath", value: "/usr/local/bin/auggie" }],
      });
      expect(result).toEqual({ success: true });
    });

    it("read-merge-writes provider path keys into the providers.paths object", async () => {
      mockedRequest
        .mockResolvedValueOnce({ path: "providers.paths", value: { codex: "/old/codex" } })
        .mockResolvedValueOnce({ applied: [] });
      await mockInvoke<Envelope>(SETTINGS_CHANNELS.SET, {
        key: "claude-codePath",
        value: "/new/claude",
      });
      expect(mockedRequest).toHaveBeenLastCalledWith("settings.update", {
        changes: [
          { path: "providers.paths", value: { codex: "/old/codex", "claude-code": "/new/claude" } },
        ],
      });
    });

    it("persists FE-only keys to namespaced localStorage", async () => {
      const result = await mockInvoke<Envelope>(SETTINGS_CHANNELS.SET, {
        key: "rtkEnabled",
        value: true,
      });
      expect(mockedRequest).not.toHaveBeenCalled();
      expect(window.localStorage.getItem("legacy-settings:rtkEnabled")).toBe("true");
      expect(result).toEqual({ success: true });
    });
  });

  describe("settings:update", () => {
    it("applies each key through the same daemon/local routing", async () => {
      mockedRequest.mockResolvedValue({ applied: [] });
      const result = await mockInvoke<Envelope>(SETTINGS_CHANNELS.UPDATE, {
        settings: { branchPrefix: "agent/", linearIssueFilter: "mine" },
      });
      expect(mockedRequest).toHaveBeenCalledWith("settings.update", {
        changes: [{ path: "workspace.branchPrefix", value: "agent/" }],
      });
      expect(window.localStorage.getItem("legacy-settings:linearIssueFilter")).toBe('"mine"');
      expect(result).toEqual({ success: true });
    });

    it("rejects a missing settings object with a failure envelope", async () => {
      const result = await mockInvoke<Envelope>(SETTINGS_CHANNELS.UPDATE, {});
      expect(result).toEqual({
        success: false,
        error: "settings:update requires a settings object",
      });
    });
  });

  describe("feature-codes gate", () => {
    it("rejects activation instead of resolving a fake success", async () => {
      await expect(mockInvoke(FEATURE_CODES_CHANNELS.ACTIVATE, { code: "X" })).rejects.toThrow(
        "Feature codes are not supported in this build",
      );
    });

    it("rejects restart-app (no app-relaunch surface in this build)", async () => {
      await expect(mockInvoke(FEATURE_CODES_CHANNELS.RESTART_APP)).rejects.toThrow(
        "App restart is not available in this build",
      );
    });
  });

  describe("persistence:* → namespaced localStorage (legacy agent-persistence store)", () => {
    it("save/load/delete round-trip under the legacy-persistence namespace", async () => {
      expect(
        await mockInvoke(PERSISTENCE_CHANNELS.SAVE, { key: "agent-state", data: { a: 1 } }),
      ).toEqual({ success: true });
      expect(localStore.get("legacy-persistence:agent-state")).toBe('{"a":1}');

      expect(await mockInvoke(PERSISTENCE_CHANNELS.LOAD, { key: "agent-state" })).toEqual({
        success: true,
        data: { a: 1 },
      });

      expect(await mockInvoke(PERSISTENCE_CHANNELS.DELETE, { key: "agent-state" })).toEqual({
        success: true,
      });
      expect(localStore.has("legacy-persistence:agent-state")).toBe(false);
      expect(await mockInvoke(PERSISTENCE_CHANNELS.LOAD, { key: "agent-state" })).toEqual({
        success: true,
        data: null,
      });
    });

    it("save-session/load-session key by workspaceId + session id", async () => {
      const session = { id: "agent-1", messages: [{ role: "user", content: "hi" }] };
      expect(
        await mockInvoke(PERSISTENCE_CHANNELS.SAVE_SESSION, { session, workspaceId: "ws-1" }),
      ).toEqual({ success: true });

      expect(
        await mockInvoke(PERSISTENCE_CHANNELS.LOAD_SESSION, {
          agentId: "agent-1",
          workspaceId: "ws-1",
        }),
      ).toEqual({ success: true, data: session });

      // A session never saved folds to the legacy "no session" envelope.
      expect(
        await mockInvoke(PERSISTENCE_CHANNELS.LOAD_SESSION, {
          agentId: "agent-2",
          workspaceId: "ws-1",
        }),
      ).toEqual({ success: false, data: null });
    });

    it("validates missing keys/ids and always resolves load-agent-config to { data: null }", async () => {
      expect(await mockInvoke(PERSISTENCE_CHANNELS.SAVE, { data: 1 })).toEqual({
        success: false,
        error: "persistence:save requires a key",
      });
      expect(await mockInvoke(PERSISTENCE_CHANNELS.SAVE_SESSION, { session: {} })).toEqual({
        success: false,
        error: "persistence:save-session requires a session id and workspaceId",
      });
      expect(
        await mockInvoke(PERSISTENCE_CHANNELS.LOAD_AGENT_CONFIG, {
          agentId: "agent-1",
          workspaceId: "ws-1",
        }),
      ).toEqual({ data: null });
    });
  });
});
