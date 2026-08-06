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
import { Store } from "$lib/store-shim/svelte-store";
import { reducers } from "../reducer";

// FAKE transport only: the daemon bridge is mocked so no request ever reaches
// a real daemon. Each test asserts the JSON-RPC method + params the bridge
// emits and how it maps the daemon result back to the renderer envelope.
vi.mock("$lib/client/live/backend-transport", () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(() => Promise.resolve({ subscriptionId: "sub-1" })),
  backendUnsubscribe: vi.fn(() => Promise.resolve()),
  onBackendNotification: vi.fn(() => () => {}),
}));

// Mock the AppClient seam for seeder tests and IPC bridges
vi.mock("$lib/client", () => ({
  appClient: {
    workspaces: {
      list: vi.fn(),
      get: vi.fn(),
      recentViews: vi.fn(),
      removeRecentRepository: vi.fn(),
    },
    repos: {
      list: vi.fn(),
      remove: vi.fn(),
    },
  },
}));

import { backendRequest } from "$lib/client/live/backend-transport";
import { mockInvoke, UNBRIDGED_INVOKE_ALLOWLIST } from "$shared/ipc-mock-router";
import { WORKSPACE_CHANNELS } from "$shared/ipc/channels";
import { seedMockStore } from "../mock-bootstrap";
import { appClient } from "$lib/client";

const mockedRequest = vi.mocked(backendRequest);
const mockedAppClient = vi.mocked(appClient);

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
      mockedAppClient.workspaces.list.mockResolvedValueOnce([
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
      ]);

      const response = await mockInvoke<CommandResponse<Array<Record<string, unknown>>>>(
        WORKSPACE_CHANNELS.LIST,
        { lite: true },
      );

      expect(mockedAppClient.workspaces.list).toHaveBeenCalled();
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
      mockedAppClient.workspaces.list.mockRejectedValueOnce(new Error("daemon unreachable"));

      await expect(mockInvoke(WORKSPACE_CHANNELS.LIST, {})).rejects.toThrow(
        "daemon unreachable",
      );
    });
  });

  describe("workspace:get-recent-repositories → daemon repo.list + repos.known", () => {
    it("forwards to repo.list and wraps the KnownRepo[] in {success, data}", async () => {
      // PROTOCOL §5.6: repo.list → { repos: KnownRepo[] } (MRU-first, camelCase).
      // This handler uses backendRequest directly, not appClient
      mockedRequest.mockImplementation(async (method) => {
        if (method === "repo.list") {
          return {
            repos: [
              {
                path: "/Users/me/src/intent",
                name: "intent",
                owner: "intent-hq",
                addedAt: "2026-01-01T00:00:00Z",
                lastUsedAt: "2026-01-02T00:00:00Z",
              },
            ],
          };
        }
        if (method === "settings.get") return { value: [] };
        return undefined;
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
          owner: "intent-hq",
          addedAt: "2026-01-01T00:00:00Z",
          lastUsedAt: "2026-01-02T00:00:00Z",
        },
      ]);
    });

    it("merges path-less GitHub picks from repos.known and filters cache/clone paths", async () => {
      mockedRequest.mockImplementation(async (method) => {
        if (method === "repo.list") {
          return {
            repos: [
              {
                path: "/Users/me/src/intent",
                name: "intent",
                addedAt: "2026-01-01T00:00:00Z",
                lastUsedAt: "2026-01-02T00:00:00Z",
              },
              // Daemon-managed cache/clone checkouts: internal, never pickable.
              {
                path: "/ws-root/.repo-cache/acme/widget",
                name: "widget",
                addedAt: "2026-01-01T00:00:00Z",
                lastUsedAt: "2026-01-05T00:00:00Z",
              },
              {
                path: "/home/.clones/legacy",
                name: "legacy",
                addedAt: "2026-01-01T00:00:00Z",
                lastUsedAt: "2026-01-04T00:00:00Z",
              },
            ],
          };
        }
        if (method === "settings.get") {
          return {
            value: [
              {
                path: "acme/widget",
                name: "widget",
                owner: "acme",
                githubUrl: "https://github.com/acme/widget",
                addedAt: "2026-01-03T00:00:00Z",
                lastUsedAt: "2026-01-06T00:00:00Z",
              },
            ],
          };
        }
        return undefined;
      });

      const response = await mockInvoke<CommandResponse<Array<Record<string, unknown>>>>(
        WORKSPACE_CHANNELS.GET_RECENT_REPOSITORIES,
        {},
      );

      expect(response.success).toBe(true);
      // MRU-first: the fresher GitHub pick sorts ahead of the local repo;
      // cache/clone paths are gone.
      expect(response.data).toEqual([
        expect.objectContaining({
          path: "acme/widget",
          githubUrl: "https://github.com/acme/widget",
        }),
        expect.objectContaining({ path: "/Users/me/src/intent" }),
      ]);
    });

    it("rejects on daemon failure — LifecycleIpcReadService keeps the prior known repos", async () => {
      mockedRequest.mockRejectedValueOnce(new Error("daemon unreachable"));

      await expect(
        mockInvoke(WORKSPACE_CHANNELS.GET_RECENT_REPOSITORIES, {}),
      ).rejects.toThrow("daemon unreachable");
    });
  });

  describe("workspace:add-recent-repository → repos.known setting", () => {
    it("upserts a path-less GitHub pick into repos.known via settings.update", async () => {
      mockedRequest.mockImplementation(async (method) => {
        if (method === "settings.get") return { value: [] };
        return undefined;
      });

      const response = await mockInvoke<CommandResponse<never>>(
        WORKSPACE_CHANNELS.ADD_RECENT_REPOSITORY,
        {
          repository: "acme/widget",
          name: "widget",
          owner: "acme",
          githubUrl: "https://github.com/acme/widget",
        },
      );

      expect(response).toEqual({ success: true });
      const updateCall = mockedRequest.mock.calls.find(([m]) => m === "settings.update");
      expect(updateCall).toBeTruthy();
      const params = updateCall![1] as {
        changes: { path: string; value: Array<Record<string, unknown>> }[];
      };
      expect(params.changes[0].path).toBe("repos.known");
      expect(params.changes[0].value[0]).toMatchObject({
        path: "acme/widget",
        name: "widget",
        owner: "acme",
        githubUrl: "https://github.com/acme/widget",
      });
    });

    it("bumps lastUsedAt on re-add instead of duplicating the entry", async () => {
      mockedRequest.mockImplementation(async (method) => {
        if (method === "settings.get") {
          return {
            value: [
              {
                path: "acme/widget",
                name: "widget",
                owner: "acme",
                githubUrl: "https://github.com/acme/widget",
                addedAt: "2026-01-01T00:00:00Z",
                lastUsedAt: "2026-01-01T00:00:00Z",
              },
            ],
          };
        }
        return undefined;
      });

      const response = await mockInvoke<CommandResponse<never>>(
        WORKSPACE_CHANNELS.ADD_RECENT_REPOSITORY,
        { repository: "acme/widget", name: "widget", owner: "acme" },
      );

      expect(response).toEqual({ success: true });
      const updateCall = mockedRequest.mock.calls.find(([m]) => m === "settings.update");
      const params = updateCall![1] as {
        changes: { path: string; value: Array<Record<string, unknown>> }[];
      };
      expect(params.changes[0].value).toHaveLength(1);
      // githubUrl is preserved from the existing entry.
      expect(params.changes[0].value[0]).toMatchObject({
        githubUrl: "https://github.com/acme/widget",
      });
      expect(params.changes[0].value[0].lastUsedAt).not.toBe("2026-01-01T00:00:00Z");
    });

    it("rejects a missing repository param without touching the daemon", async () => {
      const response = await mockInvoke<CommandResponse<never>>(
        WORKSPACE_CHANNELS.ADD_RECENT_REPOSITORY,
        {},
      );
      expect(response).toEqual({ success: false, error: "repository is required" });
      expect(mockedRequest).not.toHaveBeenCalled();
    });
  });

  describe("workspace:remove-recent-repository → daemon repo.remove", () => {
    it("forwards the path and wraps { removed } in {success, data}", async () => {
      // PROTOCOL §5.11: repo.remove { path } → { removed: bool }.
      mockedRequest.mockImplementation(async (method) => {
        if (method === "settings.get") return { value: [] };
        if (method === "repo.remove") return { removed: true };
        return undefined;
      });

      const response = await mockInvoke<CommandResponse<{ removed: boolean }>>(
        WORKSPACE_CHANNELS.REMOVE_RECENT_REPOSITORY,
        { repository: "/Users/me/src/intent" },
      );

      expect(mockedRequest).toHaveBeenCalledWith("repo.remove", {
        path: "/Users/me/src/intent",
      });
      expect(response).toEqual({ success: true, data: { removed: true } });
    });

    it("removes a path-less GitHub pick from repos.known (registry no-op)", async () => {
      mockedRequest.mockImplementation(async (method) => {
        if (method === "settings.get") {
          return {
            value: [
              {
                path: "acme/widget",
                name: "widget",
                githubUrl: "https://github.com/acme/widget",
                addedAt: "t",
                lastUsedAt: "t",
              },
            ],
          };
        }
        if (method === "repo.remove") return { removed: false };
        return undefined;
      });

      const response = await mockInvoke<CommandResponse<{ removed: boolean }>>(
        WORKSPACE_CHANNELS.REMOVE_RECENT_REPOSITORY,
        { repository: "acme/widget" },
      );

      const updateCall = mockedRequest.mock.calls.find(([m]) => m === "settings.update");
      expect(updateCall![1]).toEqual({
        changes: [{ path: "repos.known", value: [] }],
      });
      expect(response).toEqual({ success: true, data: { removed: true } });
    });

    it("passes through removed:false for an unregistered path (daemon no-op)", async () => {
      mockedRequest.mockImplementation(async (method) => {
        if (method === "settings.get") return { value: [] };
        if (method === "repo.remove") return { removed: false };
        return undefined;
      });

      const response = await mockInvoke<CommandResponse<{ removed: boolean }>>(
        WORKSPACE_CHANNELS.REMOVE_RECENT_REPOSITORY,
        { repository: "/never/registered" },
      );

      expect(response).toEqual({ success: true, data: { removed: false } });
    });

    it("folds a daemon failure into {success:false, error} for the loud toast", async () => {
      mockedRequest.mockImplementation(async (method) => {
        if (method === "settings.get") return { value: [] };
        throw new Error("daemon unreachable");
      });

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

  describe("seeder respects existing route-driven state", () => {
    it("does not override activeWorkspaceId when one is already set", async () => {
      const { setActiveWorkspaceId } = await import(
        "../slices/workspace/workspace-slice"
      );

      // Simulate route loader setting activeWorkspaceId = "ws-2" before seeder runs
      const store = new Store(reducers, []);
      store.init();
      store.dispatch(setActiveWorkspaceId("ws-2"));

      // Mock workspace.list returning ws-1 first, ws-2 second
      mockedAppClient.workspaces.list.mockResolvedValueOnce([
        {
          id: "ws-1",
          title: "First Workspace",
          branch: "main",
          status: "Active",
          path: "/tmp/ws-1",
          repositoryPath: "/tmp/ws-1",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-02T00:00:00Z",
        },
        {
          id: "ws-2",
          title: "Second Workspace",
          branch: "main",
          status: "Active",
          path: "/tmp/ws-2",
          repositoryPath: "/tmp/ws-2",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-02T00:00:00Z",
        },
      ]);
      mockedAppClient.workspaces.recentViews.mockResolvedValueOnce({ "ws-1": 100, "ws-2": 200 });

      // Run the seeder
      await seedMockStore(store, appClient);

      // Assert: activeWorkspaceId stays "ws-2", not clobbered to "ws-1"
      expect(store.state.workspace.activeWorkspaceId).toBe("ws-2");
    });

    it("does not force-open ws-1 tab when a currentTabId is already set", async () => {
      const { openWorkspaceTab } = await import(
        "../slices/tab-state/tab-state-slice"
      );

      // Simulate route loader opening ws-2 tab before seeder runs
      const store = new Store(reducers, []);
      store.init();
      store.dispatch(openWorkspaceTab("ws-2"));

      // Mock workspace.list returning ws-1 first
      mockedAppClient.workspaces.list.mockResolvedValueOnce([
        {
          id: "ws-1",
          title: "First Workspace",
          branch: "main",
          status: "Active",
          path: "/tmp/ws-1",
          repositoryPath: "/tmp/ws-1",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-02T00:00:00Z",
        },
        {
          id: "ws-2",
          title: "Second Workspace",
          branch: "main",
          status: "Active",
          path: "/tmp/ws-2",
          repositoryPath: "/tmp/ws-2",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-02T00:00:00Z",
        },
      ]);
      mockedAppClient.workspaces.recentViews.mockResolvedValueOnce({});

      // Run the seeder
      await seedMockStore(store, appClient);

      // Assert: currentTabId stays "ws-2", not clobbered; ws-1 tab NOT opened
      expect(store.state.tabState.currentTabId).toBe("ws-2");
      expect(store.state.tabState.openTabs["ws-1"]).toBeUndefined();
    });

    it("still auto-selects the first workspace on fresh boot (no route state)", async () => {
      // Fresh store with no pre-seeded state
      const store = new Store(reducers, []);
      store.init();

      mockedAppClient.workspaces.list.mockResolvedValueOnce([
        {
          id: "ws-1",
          title: "First Workspace",
          branch: "main",
          status: "Active",
          path: "/tmp/ws-1",
          repositoryPath: "/tmp/ws-1",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-02T00:00:00Z",
        },
      ]);
      mockedAppClient.workspaces.recentViews.mockResolvedValueOnce({});

      // Run the seeder
      await seedMockStore(store, appClient);

      // Assert: first workspace auto-selected
      expect(store.state.workspace.activeWorkspaceId).toBe("ws-1");
      expect(store.state.tabState.currentTabId).toBe("ws-1");
      expect(store.state.tabState.openTabs["ws-1"]).toBe(true);
    });

    it("skips archived workspaces when auto-selecting on fresh boot", async () => {
      // Fresh store with no pre-seeded state
      const store = new Store(reducers, []);
      store.init();

      // First workspace is archived, second is active
      mockedAppClient.workspaces.list.mockResolvedValueOnce([
        {
          id: "ws-archived",
          title: "Archived Workspace",
          branch: "main",
          status: "Archived",
          path: "/tmp/ws-archived",
          repositoryPath: "/tmp/ws-archived",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-02T00:00:00Z",
        },
        {
          id: "ws-active",
          title: "Active Workspace",
          branch: "main",
          status: "Active",
          path: "/tmp/ws-active",
          repositoryPath: "/tmp/ws-active",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-02T00:00:00Z",
        },
      ]);
      mockedAppClient.workspaces.recentViews.mockResolvedValueOnce({});

      // Run the seeder
      await seedMockStore(store, appClient);

      // Assert: skipped archived ws-archived, selected active ws-active instead
      expect(store.state.workspace.activeWorkspaceId).toBe("ws-active");
      expect(store.state.tabState.currentTabId).toBe("ws-active");
      expect(store.state.tabState.openTabs["ws-active"]).toBe(true);
      expect(store.state.tabState.openTabs["ws-archived"]).toBeUndefined();
    });

    it("sets hasLoaded=true even when workspaces.list rejects (daemon down)", async () => {
      // Fresh store with no pre-seeded state
      const store = new Store(reducers, []);
      store.init();

      // Mock workspaces.list rejecting (daemon unreachable)
      mockedAppClient.workspaces.list.mockRejectedValueOnce(new Error("daemon unreachable"));

      // Suppress console.error for this test
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        // Run the seeder
        await seedMockStore(store, appClient);

        // Assert: hasLoaded is true despite the error, preventing infinite skeletons
        expect(store.state.workspace.hasLoaded).toBe(true);
        // Workspace list remains empty (collection initialized but no items added)
        expect(store.state.workspace.workspaces.ids.length).toBe(0);
        // Console.error was called with the error
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "Workspaces seeder: client.workspaces.list() failed:",
          expect.any(Error),
        );
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });
  });

  describe("workspace:get → daemon workspace.get", () => {
    it("forwards to workspace.get and wraps the workspace in {success, data}", async () => {
      // PROTOCOL §5.1: workspace.get → { workspace: Workspace }.
      mockedAppClient.workspaces.get.mockResolvedValueOnce({
        id: "11111111-1111-4111-8111-111111111111",
        title: "Repo A",
        branch: "main",
        status: "Active",
        path: "/tmp/repo-a",
        repositoryPath: "/tmp/repo-a",
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-02T00:00:00Z",
      });

      const response = (await mockInvoke(WORKSPACE_CHANNELS.GET, {
        id: "11111111-1111-4111-8111-111111111111",
      })) as CommandResponse<{ id: string; title: string }>;

      expect(mockedAppClient.workspaces.get).toHaveBeenCalledWith(
        "11111111-1111-4111-8111-111111111111"
      );
      expect(response.success).toBe(true);
      expect(response.data?.title).toBe("Repo A");
    });

    it("folds a missing id, a missing workspace, and a transport failure to {success:false}", async () => {
      expect(await mockInvoke(WORKSPACE_CHANNELS.GET, {})).toEqual({
        success: false,
        error: "Workspace not found",
      });
      expect(mockedAppClient.workspaces.get).not.toHaveBeenCalled();

      // A response without a workspace payload (daemon "not found") folds to
      // {success:false} — the live client's normalization throws and the
      // handler's catch shapes it; the exact message is the client's.
      const validId = "22222222-2222-4222-8222-222222222222";
      mockedAppClient.workspaces.get.mockResolvedValueOnce(null as any);
      expect(await mockInvoke(WORKSPACE_CHANNELS.GET, { id: validId })).toMatchObject({
        success: false,
      });

      mockedAppClient.workspaces.get.mockRejectedValueOnce(new Error("daemon offline"));
      expect(await mockInvoke(WORKSPACE_CHANNELS.GET, { id: validId })).toEqual({
        success: false,
        error: "daemon offline",
      });
    });
  });
});
