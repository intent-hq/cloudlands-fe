/**
 * Wire-contract tests for the workspaces seeder's legacy IPC bridges.
 *
 * Asserts the `workspace:list` / `workspace:create` mock IPC handlers forward
 * to the canonical daemon JSON-RPC methods (`workspace.list` /
 * `workspace.create`, PROTOCOL §5.1) and wrap the daemon result in the
 * `{ success, data }` CommandResponse envelope `workspace.client.ts`
 * `normalizeResponse` folds into `{ ok, data }` for the creation-flow callers
 * (RepoSelector, CompactWorkspaceInitializer, OnboardingPage).
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

  describe("workspace:create → daemon workspace.create", () => {
    it("forwards the request (+ idempotencyKey) and returns the created workspace", async () => {
      // PROTOCOL §5.1: workspace.create → { workspace: Workspace }.
      mockedRequest.mockResolvedValueOnce({
        workspace: {
          id: "22222222-2222-4222-8222-222222222222",
          title: "Fresh",
          branch: "intent/fresh",
          status: "Active",
          path: "/tmp/worktrees/fresh",
          repositoryPath: "/tmp/repo-a",
        },
      });

      const response = await mockInvoke<CommandResponse<Record<string, unknown>>>(
        WORKSPACE_CHANNELS.CREATE,
        { title: "Fresh", repositoryPath: "/tmp/repo-a", baseRef: "main" },
      );

      expect(mockedRequest).toHaveBeenCalledWith(
        "workspace.create",
        expect.objectContaining({
          title: "Fresh",
          repositoryPath: "/tmp/repo-a",
          baseRef: "main",
          idempotencyKey: expect.any(String),
        }),
      );
      expect(response.success).toBe(true);
      expect(response.data).toMatchObject({
        id: "22222222-2222-4222-8222-222222222222",
        branch: "intent/fresh",
      });
    });

    it("folds a daemon failure into {success:false, error} for the PullConflict-style dialogs", async () => {
      mockedRequest.mockRejectedValueOnce(new Error("worktree add failed"));

      const response = await mockInvoke<CommandResponse<never>>(WORKSPACE_CHANNELS.CREATE, {
        title: "Broken",
      });

      expect(response).toEqual({ success: false, error: "worktree add failed" });
    });

    it("fails loud when the daemon returns success without a workspace (§5.1 divergence)", async () => {
      mockedRequest.mockResolvedValueOnce({});

      const response = await mockInvoke<CommandResponse<never>>(WORKSPACE_CHANNELS.CREATE, {
        title: "NoBody",
      });

      expect(response.success).toBe(false);
      expect(response.error).toContain("PROTOCOL §5.1 divergence");
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
});
