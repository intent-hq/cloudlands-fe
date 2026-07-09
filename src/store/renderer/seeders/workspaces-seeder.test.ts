/**
 * Wire-contract tests for the workspaces seeder's legacy IPC bridges.
 *
 * Asserts the `workspace:list` mock IPC handler forwards to the canonical
 * daemon JSON-RPC method (`workspace.list`, PROTOCOL §5.1) and wraps the
 * daemon result in the `{ success, data }` CommandResponse envelope
 * `workspace.client.ts` `normalizeResponse` folds into `{ ok, data }` for
 * the RepoSelector recent-repo scan. `workspace:create` was retired with the
 * daemon-direct cut-over — `WorkspaceClient.create` now calls
 * `appClient.workspaces.create` directly (see workspace.client.test.ts).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// FAKE transport only: the daemon bridge is mocked so no request ever reaches
// a real daemon. Each test asserts the JSON-RPC method + params the bridge
// emits and how it maps the daemon result back to the renderer envelope.
vi.mock("$lib/client/live/backend-transport", () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(() => Promise.resolve({ subscriptionId: "sub-1" })),
  backendUnsubscribe: vi.fn(() => Promise.resolve()),
  onBackendNotification: vi.fn(() => () => {}),
}));

import { backendRequest } from "$lib/client/live/backend-transport";
import { mockInvoke, UNBRIDGED_INVOKE_ALLOWLIST } from "$shared/ipc-mock-router";
import { WORKSPACE_CHANNELS } from "$shared/ipc/channels";

const mockedRequest = vi.mocked(backendRequest);

interface CommandResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

describe("workspaces-seeder legacy IPC bridges", () => {
  beforeAll(async () => {
    // Importing the seeder runs its `registerMockIpcHandler` side effects.
    await import("./workspaces-seeder");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("workspace:list → daemon workspace.list", () => {
    it("forwards to workspace.list and wraps the workspaces in {success, data}", async () => {
      // PROTOCOL §5.1: workspace.list → { workspaces: Workspace[] }.
      mockedRequest.mockResolvedValueOnce({
        workspaces: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            title: "Repo A",
            branch: "main",
            status: "Active",
            path: "/tmp/repo-a",
            repositoryPath: "/tmp/repo-a",
            createdAt: "2026-07-01T00:00:00Z",
            updatedAt: "2026-07-02T00:00:00Z",
          },
        ],
      });

      const response = await mockInvoke<CommandResponse<Array<Record<string, unknown>>>>(
        WORKSPACE_CHANNELS.LIST,
        { lite: true },
      );

      expect(mockedRequest).toHaveBeenCalledWith("workspace.list");
      expect(response.success).toBe(true);
      expect(response.data).toHaveLength(1);
      expect(response.data![0]).toMatchObject({
        id: "11111111-1111-4111-8111-111111111111",
        title: "Repo A",
        branch: "main",
        path: "/tmp/repo-a",
        repositoryPath: "/tmp/repo-a",
      });
    });

    it("rejects when the daemon read fails so callers see the real error", async () => {
      mockedRequest.mockRejectedValueOnce(new Error("daemon unreachable"));

      await expect(mockInvoke(WORKSPACE_CHANNELS.LIST, {})).rejects.toThrow(
        "daemon unreachable",
      );
    });
  });

  describe("workspace:get-recent-repositories → daemon repo.list", () => {
    it("forwards to repo.list and wraps the KnownRepo[] in {success, data}", async () => {
      // PROTOCOL §5.6: repo.list → { repos: KnownRepo[] } (MRU-first, camelCase).
      mockedRequest.mockResolvedValueOnce({
        repos: [
          {
            path: "/Users/me/src/intent",
            name: "intent",
            owner: "cloudlands-ai",
            addedAt: "2026-01-01T00:00:00Z",
            lastUsedAt: "2026-01-02T00:00:00Z",
          },
        ],
      });

      const response = await mockInvoke<CommandResponse<Array<Record<string, unknown>>>>(
        WORKSPACE_CHANNELS.GET_RECENT_REPOSITORIES,
        {},
      );

      expect(mockedRequest).toHaveBeenCalledWith("repo.list");
      expect(response.success).toBe(true);
      expect(response.data).toEqual([
        {
          path: "/Users/me/src/intent",
          name: "intent",
          owner: "cloudlands-ai",
          addedAt: "2026-01-01T00:00:00Z",
          lastUsedAt: "2026-01-02T00:00:00Z",
        },
      ]);
    });

    it("rejects on daemon failure — LifecycleIpcReadService keeps the prior known repos", async () => {
      mockedRequest.mockRejectedValueOnce(new Error("daemon unreachable"));

      await expect(
        mockInvoke(WORKSPACE_CHANNELS.GET_RECENT_REPOSITORIES, {}),
      ).rejects.toThrow("daemon unreachable");
    });
  });

  describe("workspace:remove-recent-repository → daemon repo.remove", () => {
    it("forwards the path and wraps { removed } in {success, data}", async () => {
      // PROTOCOL §5.11: repo.remove { path } → { removed: bool }.
      mockedRequest.mockResolvedValueOnce({ removed: true });

      const response = await mockInvoke<CommandResponse<{ removed: boolean }>>(
        WORKSPACE_CHANNELS.REMOVE_RECENT_REPOSITORY,
        { repository: "/Users/me/src/intent" },
      );

      expect(mockedRequest).toHaveBeenCalledWith("repo.remove", {
        path: "/Users/me/src/intent",
      });
      expect(response).toEqual({ success: true, data: { removed: true } });
    });

    it("passes through removed:false for an unregistered path (daemon no-op)", async () => {
      mockedRequest.mockResolvedValueOnce({ removed: false });

      const response = await mockInvoke<CommandResponse<{ removed: boolean }>>(
        WORKSPACE_CHANNELS.REMOVE_RECENT_REPOSITORY,
        { repository: "/never/registered" },
      );

      expect(response).toEqual({ success: true, data: { removed: false } });
    });

    it("folds a daemon failure into {success:false, error} for the loud toast", async () => {
      mockedRequest.mockRejectedValueOnce(new Error("daemon unreachable"));

      const response = await mockInvoke<CommandResponse<never>>(
        WORKSPACE_CHANNELS.REMOVE_RECENT_REPOSITORY,
        { repository: "/Users/me/src/intent" },
      );

      expect(response).toEqual({ success: false, error: "daemon unreachable" });
    });

    it("rejects a missing repository param without touching the daemon", async () => {
      const response = await mockInvoke<CommandResponse<never>>(
        WORKSPACE_CHANNELS.REMOVE_RECENT_REPOSITORY,
        {},
      );

      expect(response).toEqual({ success: false, error: "repository is required" });
      expect(mockedRequest).not.toHaveBeenCalled();
    });
  });

  describe("workspace:get-root (allowlisted absence)", () => {
    it("resolves undefined instead of rejecting — NoteTabType hides the open-file button", async () => {
      expect(UNBRIDGED_INVOKE_ALLOWLIST.has("workspace:get-root")).toBe(true);
      await expect(
        mockInvoke("workspace:get-root", { workspaceId: "ws-1" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("workspace:get → daemon workspace.get", () => {
    it("forwards to workspace.get and wraps the workspace in {success, data}", async () => {
      // PROTOCOL §5.1: workspace.get → { workspace: Workspace }.
      mockedRequest.mockResolvedValueOnce({
        workspace: {
          id: "11111111-1111-4111-8111-111111111111",
          title: "Repo A",
          branch: "main",
          status: "Active",
          path: "/tmp/repo-a",
          repositoryPath: "/tmp/repo-a",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-02T00:00:00Z",
        },
      });

      const response = (await mockInvoke(WORKSPACE_CHANNELS.GET, {
        id: "11111111-1111-4111-8111-111111111111",
      })) as CommandResponse<{ id: string; title: string }>;

      expect(mockedRequest).toHaveBeenCalledWith("workspace.get", {
        workspaceId: "11111111-1111-4111-8111-111111111111",
      });
      expect(response.success).toBe(true);
      expect(response.data?.title).toBe("Repo A");
    });

    it("folds a missing id, a missing workspace, and a transport failure to {success:false}", async () => {
      expect(await mockInvoke(WORKSPACE_CHANNELS.GET, {})).toEqual({
        success: false,
        error: "Workspace not found",
      });
      expect(mockedRequest).not.toHaveBeenCalled();

      // A response without a workspace payload (daemon "not found") folds to
      // {success:false} — the live client's normalization throws and the
      // handler's catch shapes it; the exact message is the client's.
      const validId = "22222222-2222-4222-8222-222222222222";
      mockedRequest.mockResolvedValueOnce({});
      expect(await mockInvoke(WORKSPACE_CHANNELS.GET, { id: validId })).toMatchObject({
        success: false,
      });

      mockedRequest.mockRejectedValueOnce(new Error("daemon offline"));
      expect(await mockInvoke(WORKSPACE_CHANNELS.GET, { id: validId })).toEqual({
        success: false,
        error: "daemon offline",
      });
    });
  });
});
