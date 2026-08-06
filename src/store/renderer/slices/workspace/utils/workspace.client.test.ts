/**
 * Wire-contract tests for `WorkspaceClient.create` — the workspace-creation
 * mutation is now routed through the `AppClient` seam (daemon-backed
 * `workspace.create`, PROTOCOL §5.1) rather than the legacy main-process
 * `workspace:create` IPC handler. The seam layer (`LiveWorkspacesClient`)
 * owns the JSON-RPC framing + idempotencyKey (asserted in
 * `live-workspaces-client.test.ts`); these tests pin the wrapper's contract:
 * forward the request verbatim (including `initialAgent`), map the
 * `WorkspaceCreateResult` into a `Result<{ workspace, initialAgent? }, string>`
 * (surfacing the daemon-assigned initial agent id), and normalize workspace
 * paths on success.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreateWorkspaceRequest } from "$shared/types";

vi.mock("$lib/client", () => ({
  appClient: {
    workspaces: {
      create: vi.fn(),
    },
  },
}));

import { appClient } from "$lib/client";
import { WorkspaceClient } from "./workspace.client";

const workspaces = vi.mocked(appClient.workspaces);

describe("WorkspaceClient.create (AppClient seam, PROTOCOL §5.1)", () => {
  afterEach(() => vi.clearAllMocks());

  it("forwards the request verbatim (including initialAgent) to appClient.workspaces.create", async () => {
    workspaces.create.mockResolvedValueOnce({
      success: true,
      workspace: {
        id: "ws-1",
        title: "Fresh",
        branch: "intent/fresh",
        path: "C:\\repo\\worktree",
      } as never,
    });
    const client = new WorkspaceClient();
    const request: CreateWorkspaceRequest = {
      title: "Fresh",
      githubUrl: "https://github.com/example/repo",
      clonePath: "/tmp/clones/repo",
      scope: "apps/web",
      // No agentId: the daemon assigns the initial agent's id.
      initialAgent: {
        prompt: "Do the thing",
        specialist: "implementor",
        model: "opus4.7",
        provider: "auggie",
      },
    };

    await client.create(request);

    expect(workspaces.create).toHaveBeenCalledTimes(1);
    expect(workspaces.create).toHaveBeenCalledWith(request);
  });

  it("forwards a picked-repo request (githubUrl + baseRef, no clonePath/repositoryPath) unchanged", async () => {
    // Pick-a-repo flow: the daemon hydrates the checkout from its repo cache
    // when githubUrl is set with no clonePath (PROTOCOL §5.1) — the wrapper
    // must not inject a clonePath or repositoryPath.
    workspaces.create.mockResolvedValueOnce({
      success: true,
      workspace: { id: "ws-pick", title: "P", branch: "b" } as never,
    });
    const client = new WorkspaceClient();
    const request: CreateWorkspaceRequest = {
      title: "P",
      githubUrl: "https://github.com/example/picked",
      baseRef: "main",
      initialAgent: { prompt: "Go" },
    };

    await client.create(request);

    expect(workspaces.create).toHaveBeenCalledWith(request);
    const sent = workspaces.create.mock.calls[0][0];
    expect(sent.clonePath).toBeUndefined();
    expect(sent.repositoryPath).toBeUndefined();
  });

  it("maps a successful WorkspaceCreateResult into an ok Result with the normalized workspace", async () => {
    // Path normalization: main-process/daemon may return Windows-style
    // backslashes; the wrapper folds them to forward slashes for consistency.
    workspaces.create.mockResolvedValueOnce({
      success: true,
      workspace: {
        id: "ws-2",
        title: "N",
        branch: "b",
        path: "C:\\repo\\worktree",
        repositoryPath: "C:\\repo",
        worktreePath: "C:\\repo\\wt",
      } as never,
      initialAgent: { id: "agent-daemon-1" },
    });
    const client = new WorkspaceClient();

    const result = await client.create({ title: "N" } as CreateWorkspaceRequest);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.workspace.id).toBe("ws-2");
      expect(result.data.workspace.path).toBe("C:/repo/worktree");
      expect(result.data.workspace.repositoryPath).toBe("C:/repo");
      expect(result.data.workspace.worktreePath).toBe("C:/repo/wt");
      // The daemon-assigned initial agent id is surfaced for adoption.
      expect(result.data.initialAgent?.id).toBe("agent-daemon-1");
    }
  });

  it("returns a failure Result when the seam returns success without a workspace", async () => {
    workspaces.create.mockResolvedValueOnce({ success: true });
    const client = new WorkspaceClient();

    const result = await client.create({ title: "X" } as CreateWorkspaceRequest);

    expect(result).toEqual({ ok: false, error: "Failed to create workspace" });
  });

  it("folds a daemon error into a failed Result surfacing the message", async () => {
    workspaces.create.mockResolvedValueOnce({
      success: false,
      error: "worktree add failed",
    });
    const client = new WorkspaceClient();

    const result = await client.create({ title: "Broken" } as CreateWorkspaceRequest);

    expect(result).toEqual({ ok: false, error: "worktree add failed" });
  });

  it("forwards the structured errorCode on a failed Result (monorepo#761)", async () => {
    workspaces.create.mockResolvedValueOnce({
      success: false,
      error: "cannot resolve base ref 'nope'",
      errorCode: "base-ref-unresolvable",
    });
    const client = new WorkspaceClient();

    const result = await client.create({ title: "Bad ref" } as CreateWorkspaceRequest);

    expect(result).toEqual({
      ok: false,
      error: "cannot resolve base ref 'nope'",
      errorCode: "base-ref-unresolvable",
    });
  });

  it("does not invoke the legacy main-process IPC handler on create", async () => {
    // Regression guard for the create-orchestration cut-over: the wrapper
    // MUST route creation through the AppClient seam so nothing double-fires
    // via the main-process `workspace:create` handler. window.electronAPI is
    // absent under jsdom, so any accidental fall-through to the invoke path
    // would resolve to `IPC not available` (which we assert never happens).
    workspaces.create.mockResolvedValueOnce({
      success: true,
      workspace: { id: "ws-3", title: "T", branch: "b" } as never,
    });
    const client = new WorkspaceClient();

    const result = await client.create({ title: "T" } as CreateWorkspaceRequest);

    expect(result.ok).toBe(true);
    expect(workspaces.create).toHaveBeenCalledTimes(1);
  });
});
