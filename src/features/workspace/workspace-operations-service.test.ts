import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "$shared/types";
import { WorkspaceStatusEnum } from "$shared/types";
import type { WorkspaceId } from "$shared/types/branded-ids";

// FAKE seam: the workspace IPC client is stubbed so no IPC/daemon call happens.
// The service runs against the REAL configured store so the operations
// middleware wiring + optimistic store convergence are exercised end to end.
vi.mock("$store/renderer/slices/workspace/utils/workspace.client", () => ({
  workspaceClient: {
    archive: vi.fn(() => Promise.resolve({ ok: true })),
    unarchive: vi.fn(() => Promise.resolve({ ok: true })),
    delete: vi.fn(() => Promise.resolve({ ok: true })),
    create: vi.fn(() => Promise.resolve({ ok: true, data: { workspace: { id: "ws-created" } } })),
  },
}));

vi.mock("svelte-sonner", () => ({
  toast: Object.assign(vi.fn(), {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("$lib/utils/delete-warning-utils", () => ({
  hasRunningAgents: vi.fn(() => false),
  getRunningAgentNames: vi.fn(() => [] as string[]),
}));

// FAKE raw-IPC bridge: only `invoke` is stubbed (the remove-repo path routes
// through the legacy `workspace:remove-recent-repository` channel); everything
// else keeps the real implementation.
vi.mock("$lib/electron-bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/electron-bridge")>();
  return { ...actual, invoke: vi.fn() };
});

// FAKE daemon transport: the unload-flush wire test routes the stubbed client
// seam through the REAL WorkspaceClient, whose live path bottoms out here so
// the exact JSON-RPC method + params can be asserted per PROTOCOL.md §5.1.
vi.mock("$lib/client/live/backend-transport", async () => {
  const mod = await import("../../test/mocks/backend-transport.mock");
  return mod.mockBackendTransportModule;
});

import { workspaceClient } from "$store/renderer/slices/workspace/utils/workspace.client";
import { installMockBackend } from "../../test/mocks/backend-transport.mock";
import { flushPendingWorkspaceDeletions } from "./workspace-operations-service";
import { hasRunningAgents } from "$lib/utils/delete-warning-utils";
import { invoke } from "$lib/electron-bridge";
import { WORKSPACE_CHANNELS } from "$shared/ipc/channels";
import type { KnownRepo } from "$shared/types/known-repo";
import { store as appStore } from "$store/renderer/store";
import { getItem } from "$lib/store-shim/utils/collections/collection-utils";
import {
  resetWorkspaceState,
  setWorkspaceEntity,
} from "$store/renderer/slices/workspace/workspace-slice";
import { setRepos } from "$store/renderer/slices/known-repos/known-repos-slice";
import {
  applyWorkspaceProposal,
  confirmBulkArchive,
  confirmBulkDeleteArchived,
  confirmRemoveRepo,
  openBulkArchiveConfirm,
  openBulkDeleteArchivedConfirm,
  openRemoveRepoConfirm,
  requestArchiveWorkspace,
  requestDeleteWorkspace,
  requestUnarchiveWorkspace,
} from "$store/renderer/slices/workspace-operations/workspace-operations-slice";
import { hydrateProposalLifecycle } from "$store/renderer/slices/proposal-lifecycle/proposal-lifecycle-slice";
import type { BulkOperationProposal, WorkspaceCreateProposal } from "$shared/types/proposal";

const ws = workspaceClient as unknown as Record<string, ReturnType<typeof vi.fn>>;
const agents = vi.mocked(hasRunningAgents);
const bridgeInvoke = vi.mocked(invoke);
const UNDO_MS = 15000;
// Handlers chain several awaits (dynamic imports of the toast/nav/agent utils)
// before the optimistic dispatch, so drain the microtask queue a few turns.
const flush = async () => {
  for (let i = 0; i < 8; i++) await vi.advanceTimersByTimeAsync(0);
};

function makeWorkspace(overrides: Partial<Workspace> & { id: string }): Workspace {
  return {
    title: "Test Workspace",
    branch: "main",
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatusEnum.Active,
    repositoryOwner: "acme",
    repositoryName: "app",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
    id: overrides.id as WorkspaceId,
  };
}

function seed(...workspaces: Workspace[]): void {
  for (const workspace of workspaces) appStore.dispatch(setWorkspaceEntity(workspace));
}

function stored(id: string): Workspace | undefined {
  return getItem(appStore.state.workspace.workspaces, id as WorkspaceId);
}

describe("workspaceOperationsService (fake seam, real store)", () => {
  beforeAll(() => appStore.init());
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
    agents.mockReturnValue(false);
    ws.archive.mockResolvedValue({ ok: true } as never);
    ws.unarchive.mockResolvedValue({ ok: true } as never);
    ws.delete.mockResolvedValue({ ok: true } as never);
    ws.create.mockResolvedValue({
      ok: true,
      data: { workspace: makeWorkspace({ id: "ws-created" }) },
    } as never);
    appStore.dispatch(resetWorkspaceState());
    appStore.dispatch(hydrateProposalLifecycle({}));
  });

  it("archives via the client seam and converges the store to Archived", async () => {
    seed(makeWorkspace({ id: "ws-a" }));

    appStore.dispatch(requestArchiveWorkspace("ws-a"));
    await flush();

    expect(ws.archive).toHaveBeenCalledWith("ws-a");
    expect(stored("ws-a")?.status).toBe(WorkspaceStatusEnum.Archived);
  });

  it("unarchives via the client seam and converges the store to Active", async () => {
    seed(makeWorkspace({ id: "ws-u", status: WorkspaceStatusEnum.Archived, archived: true }));

    appStore.dispatch(requestUnarchiveWorkspace("ws-u"));
    await flush();

    expect(ws.unarchive).toHaveBeenCalledWith("ws-u");
    expect(stored("ws-u")?.status).toBe(WorkspaceStatusEnum.Active);
  });

  it("deletes optimistically, then commits via the client after the undo window", async () => {
    seed(makeWorkspace({ id: "ws-d" }));

    appStore.dispatch(requestDeleteWorkspace("ws-d"));
    await flush();

    expect(stored("ws-d")).toBeUndefined();
    expect(ws.delete).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(UNDO_MS);
    expect(ws.delete).toHaveBeenCalledWith("ws-d");
  });

  describe("flush pending deletions on window teardown", () => {
    it("commits the pending workspace.delete when the window unloads before the undo window", async () => {
      seed(makeWorkspace({ id: "ws-flush" }));

      appStore.dispatch(requestDeleteWorkspace("ws-flush"));
      await flush();
      expect(ws.delete).not.toHaveBeenCalled();

      window.dispatchEvent(new Event("pagehide"));

      // The commit initiates the delete synchronously so the request is handed
      // to the transport before teardown completes.
      expect(ws.delete).toHaveBeenCalledWith("ws-flush");

      // The undo timer was disarmed — no double delete when it would elapse.
      await vi.advanceTimersByTimeAsync(UNDO_MS);
      expect(ws.delete).toHaveBeenCalledTimes(1);
    });

    it("sends the exact workspace.delete wire request (PROTOCOL §5.1) on flush", async () => {
      // Route the seam-stubbed delete through the REAL WorkspaceClient so the
      // flush exercises the genuine wire path against the mock daemon.
      const actual = await vi.importActual<
        typeof import("$store/renderer/slices/workspace/utils/workspace.client")
      >("$store/renderer/slices/workspace/utils/workspace.client");
      ws.delete.mockImplementation((id: WorkspaceId) => actual.workspaceClient.delete(id));
      const backend = installMockBackend();
      backend.onRequest("workspace.delete", () => ({}));

      seed(makeWorkspace({ id: "ws-wire" }));
      appStore.dispatch(requestDeleteWorkspace("ws-wire"));
      await flush();
      expect(backend.requests).toEqual([]);

      flushPendingWorkspaceDeletions();
      await flush();

      expect(backend.requests).toEqual([
        { method: "workspace.delete", params: { workspaceId: "ws-wire" } },
      ]);
    });

    it("keeps Undo inert when the flush already committed the deletion", async () => {
      seed(makeWorkspace({ id: "ws-inert" }));

      appStore.dispatch(requestDeleteWorkspace("ws-inert"));
      await flush();

      // A beforeunload flush fires without the window actually unloading
      // (cancelled navigation / dev HMR) — the delete is committed.
      window.dispatchEvent(new Event("beforeunload"));
      expect(ws.delete).toHaveBeenCalledWith("ws-inert");

      // Clicking Undo afterwards must NOT resurrect the entity locally —
      // the daemon already received the delete.
      const { toast } = await import("svelte-sonner");
      const [, options] = vi.mocked(toast.warning).mock.calls.at(-1)! as [
        string,
        { action: { onClick: () => void } },
      ];
      options.action.onClick();
      await flush();

      expect(stored("ws-inert")).toBeUndefined();
    });

    it("does not delete an undone workspace when the flush fires afterwards", async () => {
      seed(makeWorkspace({ id: "ws-undone" }));

      appStore.dispatch(requestDeleteWorkspace("ws-undone"));
      await flush();

      const { toast } = await import("svelte-sonner");
      const [, options] = vi.mocked(toast.warning).mock.calls.at(-1)! as [
        string,
        { action: { onClick: () => void } },
      ];
      options.action.onClick();

      window.dispatchEvent(new Event("beforeunload"));
      flushPendingWorkspaceDeletions();
      await vi.advanceTimersByTimeAsync(UNDO_MS);

      expect(ws.delete).not.toHaveBeenCalled();
      expect(stored("ws-undone")).toBeDefined();
    });
  });

  it("routes a running-agents delete to the warning modal instead of deleting", async () => {
    agents.mockReturnValue(true);
    seed(makeWorkspace({ id: "ws-w" }));

    appStore.dispatch(requestDeleteWorkspace("ws-w"));
    await flush();
    await vi.advanceTimersByTimeAsync(UNDO_MS);

    expect(ws.delete).not.toHaveBeenCalled();
    expect(stored("ws-w")).toBeDefined();
    expect(appStore.state.workspaceOperations.showDeleteWarning).toBe(true);
  });

  it("bulk-archives every active workspace for the pending repo", async () => {
    seed(
      makeWorkspace({ id: "ws-1" }),
      makeWorkspace({ id: "ws-2" }),
      makeWorkspace({ id: "ws-other", repositoryName: "different" })
    );

    appStore.dispatch(openBulkArchiveConfirm("acme/app"));
    appStore.dispatch(confirmBulkArchive());
    await flush();

    expect(ws.archive).toHaveBeenCalledTimes(2);
    expect(ws.archive).toHaveBeenCalledWith("ws-1");
    expect(ws.archive).toHaveBeenCalledWith("ws-2");
    expect(ws.archive).not.toHaveBeenCalledWith("ws-other");
    expect(stored("ws-1")?.status).toBe(WorkspaceStatusEnum.Archived);
  });

  it("bulk-deletes every archived workspace sequentially for the pending repo", async () => {
    seed(
      makeWorkspace({ id: "ws-x", status: WorkspaceStatusEnum.Archived }),
      makeWorkspace({ id: "ws-y", status: WorkspaceStatusEnum.Archived }),
      makeWorkspace({ id: "ws-active" })
    );

    appStore.dispatch(openBulkDeleteArchivedConfirm("acme/app"));
    appStore.dispatch(confirmBulkDeleteArchived());
    await flush();

    expect(ws.delete).toHaveBeenCalledTimes(2);
    expect(ws.delete).toHaveBeenCalledWith("ws-x");
    expect(ws.delete).toHaveBeenCalledWith("ws-y");
    expect(ws.delete).not.toHaveBeenCalledWith("ws-active");
    expect(stored("ws-x")).toBeUndefined();
  });

  it("reports timeouts as 'still deleting' and does not remove entities on timeout", async () => {
    ws.delete.mockResolvedValueOnce({ ok: false, error: "JSON-RPC request timed out: workspace.delete" } as never);
    seed(makeWorkspace({ id: "ws-timeout", status: WorkspaceStatusEnum.Archived }));

    appStore.dispatch(openBulkDeleteArchivedConfirm("acme/app"));
    appStore.dispatch(confirmBulkDeleteArchived());
    await flush();

    expect(ws.delete).toHaveBeenCalledWith("ws-timeout");
    // Entity is NOT removed on timeout — the workspace:deleted event will do it.
    expect(stored("ws-timeout")).toBeDefined();
    const { toast } = await import("svelte-sonner");
    expect(vi.mocked(toast.info)).toHaveBeenCalledWith("1 space is still deleting (large checkout)");
  });

  describe("remove repo from the known-repos registry", () => {
    const repo: KnownRepo = {
      path: "/Users/me/src/app",
      name: "app",
      owner: "acme",
      addedAt: "2026-01-01T00:00:00Z",
      lastUsedAt: "2026-01-02T00:00:00Z",
    };

    function knownRepo(path: string): KnownRepo | undefined {
      return getItem(appStore.state.knownRepos.repos, path);
    }

    it("removes via the remove-recent-repository channel and converges the slice", async () => {
      bridgeInvoke.mockResolvedValueOnce({ success: true, data: { removed: true } });
      appStore.dispatch(setRepos([repo]));

      appStore.dispatch(openRemoveRepoConfirm(repo.path));
      appStore.dispatch(confirmRemoveRepo());
      await flush();

      expect(bridgeInvoke).toHaveBeenCalledWith(
        WORKSPACE_CHANNELS.REMOVE_RECENT_REPOSITORY,
        { repository: repo.path }
      );
      expect(knownRepo(repo.path)).toBeUndefined();
      expect(appStore.state.workspaceOperations.showRemoveRepoConfirm).toBe(false);
      expect(appStore.state.workspaceOperations.pendingRemoveRepoPath).toBeNull();
    });

    it("keeps the repo and toasts loud when the channel reports failure", async () => {
      bridgeInvoke.mockResolvedValueOnce({ success: false, error: "daemon offline" });
      appStore.dispatch(setRepos([repo]));

      appStore.dispatch(openRemoveRepoConfirm(repo.path));
      appStore.dispatch(confirmRemoveRepo());
      await flush();

      expect(knownRepo(repo.path)).toBeDefined();
      const { toast } = await import("svelte-sonner");
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Failed to remove repository");
    });

    it("keeps the repo and toasts loud when the invoke rejects", async () => {
      bridgeInvoke.mockRejectedValueOnce(new Error("ipc down"));
      appStore.dispatch(setRepos([repo]));

      appStore.dispatch(openRemoveRepoConfirm(repo.path));
      appStore.dispatch(confirmRemoveRepo());
      await flush();

      expect(knownRepo(repo.path)).toBeDefined();
      const { toast } = await import("svelte-sonner");
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Failed to remove repository");
    });

    it("closes the confirm and does nothing without a pending repo path", async () => {
      appStore.dispatch(confirmRemoveRepo());
      await flush();

      expect(bridgeInvoke).not.toHaveBeenCalled();
      expect(appStore.state.workspaceOperations.showRemoveRepoConfirm).toBe(false);
    });
  });

  function lifecycleEntry(proposalId: string) {
    const state = appStore.state as {
      proposalLifecycle?: Record<
        string,
        { status: string; error?: string; result?: { workspaceId?: string } }
      >;
    };
    return state.proposalLifecycle?.[proposalId];
  }

  describe("apply workspace-create proposal (ProposalCard Apply)", () => {
    function makeProposal(
      overrides?: Partial<WorkspaceCreateProposal>,
    ): WorkspaceCreateProposal {
      return {
        kind: "workspace-create",
        payload: {
          operation: "workspace.create",
          params: {
            title: "New space",
            repositoryPath: "/repo",
            baseRef: "main",
            initialAgent: { name: "Coordinator", prompt: "Do the thing" },
          },
        },
        preview: { title: "Create workspace" },
        applyToolCallId: "tc-apply-1",
        ...overrides,
      };
    }

    it("runs workspace.create with the proposal params and drives the lifecycle to applied", async () => {
      appStore.dispatch(applyWorkspaceProposal({ proposal: makeProposal() }));
      await flush();

      expect(ws.create).toHaveBeenCalledTimes(1);
      const request = ws.create.mock.calls[0][0];
      expect(request).toMatchObject({
        title: "New space",
        repositoryPath: "/repo",
        baseRef: "main",
        initialAgent: {
          name: "Coordinator",
          prompt: "Do the thing",
          metadata: { isInitialAgent: true },
        },
      });
      // No client-supplied agentId: the daemon assigns the initial agent's id.
      expect(request.initialAgent).not.toHaveProperty("agentId");

      expect(lifecycleEntry("tc-apply-1")).toMatchObject({
        status: "applied",
        result: { workspaceId: "ws-created" },
      });
      expect(stored("ws-created")).toBeDefined();
    });

    it("merges editedFields overrides into the create request", async () => {
      appStore.dispatch(
        applyWorkspaceProposal({
          proposal: makeProposal(),
          editedFields: { branch: "feature/x", initialPrompt: "Edited prompt" },
        }),
      );
      await flush();

      expect(ws.create.mock.calls[0][0]).toMatchObject({
        baseRef: "feature/x",
        initialAgent: { prompt: "Edited prompt" },
      });
    });

    it("dedupes rapid double-applies via the lifecycle slice", async () => {
      appStore.dispatch(applyWorkspaceProposal({ proposal: makeProposal() }));
      appStore.dispatch(applyWorkspaceProposal({ proposal: makeProposal() }));
      await flush();

      expect(ws.create).toHaveBeenCalledTimes(1);
    });

    it("marks the lifecycle failed and toasts loud when create fails", async () => {
      ws.create.mockResolvedValueOnce({ ok: false, error: "clone failed" } as never);

      appStore.dispatch(applyWorkspaceProposal({ proposal: makeProposal() }));
      await flush();

      expect(lifecycleEntry("tc-apply-1")).toMatchObject({
        status: "failed",
        error: "clone failed",
      });
      const { toast } = await import("svelte-sonner");
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith("clone failed");
    });

    it("routes bulk-op proposals to the bulk applier, not workspace.create", async () => {
      seed(makeWorkspace({ id: "ws-1" }));

      appStore.dispatch(
        applyWorkspaceProposal({
          proposal: {
            kind: "bulk-op",
            payload: { operation: "workspace.bulkArchive", ids: ["ws-1"] },
            preview: { title: "Archive" },
          },
        }),
      );
      await flush();

      expect(ws.create).not.toHaveBeenCalled();
      expect(ws.archive).toHaveBeenCalledWith("ws-1");
    });
  });

  describe("apply bulk-op proposal (ProposalCard Apply)", () => {
    function makeBulkProposal(
      operation: BulkOperationProposal["payload"]["operation"],
      ids: string[],
      overrides?: Partial<BulkOperationProposal>,
    ): BulkOperationProposal {
      return {
        kind: "bulk-op",
        payload: { operation, ids },
        preview: { title: "Bulk operation" },
        applyToolCallId: "tc-bulk-1",
        ...overrides,
      };
    }

    it("archives every targeted id, converges the store, and drives the lifecycle to applied", async () => {
      seed(makeWorkspace({ id: "ws-1" }), makeWorkspace({ id: "ws-2" }));

      appStore.dispatch(
        applyWorkspaceProposal({
          proposal: makeBulkProposal("workspace.bulkArchive", ["ws-1", "ws-2"]),
        }),
      );
      await flush();

      expect(ws.archive).toHaveBeenCalledTimes(2);
      expect(ws.archive).toHaveBeenCalledWith("ws-1");
      expect(ws.archive).toHaveBeenCalledWith("ws-2");
      expect(stored("ws-1")?.status).toBe(WorkspaceStatusEnum.Archived);
      expect(stored("ws-2")?.status).toBe(WorkspaceStatusEnum.Archived);
      expect(lifecycleEntry("tc-bulk-1")).toMatchObject({ status: "applied" });
      const { toast } = await import("svelte-sonner");
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Archived 2 spaces");
    });

    it("sends the exact workspace.archive wire request (PROTOCOL §5.1) per targeted id", async () => {
      // Route the seam-stubbed archive through the REAL WorkspaceClient so the
      // apply exercises the genuine wire path against the mock daemon.
      const actual = await vi.importActual<
        typeof import("$store/renderer/slices/workspace/utils/workspace.client")
      >("$store/renderer/slices/workspace/utils/workspace.client");
      ws.archive.mockImplementation((id: WorkspaceId) => actual.workspaceClient.archive(id));
      const backend = installMockBackend();
      backend.onRequest("workspace.archive", (params) => ({
        workspace: {
          ...makeWorkspace({ id: (params as { workspaceId: string }).workspaceId }),
          status: WorkspaceStatusEnum.Archived,
          archived: true,
          archivedAt: "2026-01-02T00:00:00Z",
        },
      }));

      seed(makeWorkspace({ id: "ws-1" }), makeWorkspace({ id: "ws-2" }));
      appStore.dispatch(
        applyWorkspaceProposal({
          proposal: makeBulkProposal("workspace.bulkArchive", ["ws-1", "ws-2"]),
        }),
      );
      await flush();

      expect(backend.requests).toEqual([
        { method: "workspace.archive", params: { workspaceId: "ws-1" } },
        { method: "workspace.archive", params: { workspaceId: "ws-2" } },
      ]);
      expect(lifecycleEntry("tc-bulk-1")).toMatchObject({ status: "applied" });
    });

    it("deletes every targeted id sequentially and drives the lifecycle to applied", async () => {
      const order: string[] = [];
      ws.delete.mockImplementation(async (id: string) => {
        order.push(id);
        return { ok: true };
      });
      seed(
        makeWorkspace({ id: "ws-x", status: WorkspaceStatusEnum.Archived }),
        makeWorkspace({ id: "ws-y", status: WorkspaceStatusEnum.Archived }),
      );

      appStore.dispatch(
        applyWorkspaceProposal({
          proposal: makeBulkProposal("workspace.bulkDelete", ["ws-x", "ws-y"]),
        }),
      );
      await flush();

      expect(order).toEqual(["ws-x", "ws-y"]);
      expect(stored("ws-x")).toBeUndefined();
      expect(stored("ws-y")).toBeUndefined();
      expect(lifecycleEntry("tc-bulk-1")).toMatchObject({ status: "applied" });
      const { toast } = await import("svelte-sonner");
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Deleted 2 spaces");
    });

    it("sends the exact workspace.delete wire request (PROTOCOL §5.1) per targeted id", async () => {
      const actual = await vi.importActual<
        typeof import("$store/renderer/slices/workspace/utils/workspace.client")
      >("$store/renderer/slices/workspace/utils/workspace.client");
      ws.delete.mockImplementation((id: WorkspaceId) => actual.workspaceClient.delete(id));
      const backend = installMockBackend();
      backend.onRequest("workspace.delete", () => ({ success: true }));

      seed(makeWorkspace({ id: "ws-x", status: WorkspaceStatusEnum.Archived }));
      appStore.dispatch(
        applyWorkspaceProposal({
          proposal: makeBulkProposal("workspace.bulkDelete", ["ws-x"]),
        }),
      );
      await flush();

      expect(backend.requests).toEqual([
        { method: "workspace.delete", params: { workspaceId: "ws-x" } },
      ]);
      expect(lifecycleEntry("tc-bulk-1")).toMatchObject({ status: "applied" });
    });

    it("honors selectedBulkItemIds when the user narrowed the checklist", async () => {
      seed(makeWorkspace({ id: "ws-1" }), makeWorkspace({ id: "ws-2" }));

      appStore.dispatch(
        applyWorkspaceProposal({
          proposal: makeBulkProposal("workspace.bulkArchive", ["ws-1", "ws-2"]),
          selectedBulkItemIds: ["ws-2"],
        }),
      );
      await flush();

      expect(ws.archive).toHaveBeenCalledTimes(1);
      expect(ws.archive).toHaveBeenCalledWith("ws-2");
      expect(stored("ws-1")?.status).toBe(WorkspaceStatusEnum.Active);
      expect(lifecycleEntry("tc-bulk-1")).toMatchObject({ status: "applied" });
    });

    it("fails loud (no silent no-op) when the resolved id list is empty", async () => {
      appStore.dispatch(
        applyWorkspaceProposal({
          proposal: makeBulkProposal("workspace.bulkArchive", []),
        }),
      );
      await flush();

      expect(ws.archive).not.toHaveBeenCalled();
      expect(lifecycleEntry("tc-bulk-1")).toMatchObject({
        status: "failed",
        error: "No spaces selected to archive",
      });
      const { toast } = await import("svelte-sonner");
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith("No spaces selected to archive");
    });

    it("marks the lifecycle failed and toasts with counts when an archive hard-fails", async () => {
      ws.archive.mockResolvedValueOnce({ ok: false, error: "daemon offline" } as never);
      seed(makeWorkspace({ id: "ws-1" }), makeWorkspace({ id: "ws-2" }));

      appStore.dispatch(
        applyWorkspaceProposal({
          proposal: makeBulkProposal("workspace.bulkArchive", ["ws-1", "ws-2"]),
        }),
      );
      await flush();

      expect(lifecycleEntry("tc-bulk-1")).toMatchObject({
        status: "failed",
        error: "Failed to archive 1 of 2 spaces",
      });
      const { toast } = await import("svelte-sonner");
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Failed to archive 1 of 2 spaces");
      // The other archive still converged.
      expect(stored("ws-2")?.status).toBe(WorkspaceStatusEnum.Archived);
    });

    it("marks the lifecycle failed and toasts with counts when a delete hard-fails", async () => {
      ws.delete.mockResolvedValueOnce({ ok: false, error: "daemon offline" } as never);
      seed(makeWorkspace({ id: "ws-x", status: WorkspaceStatusEnum.Archived }));

      appStore.dispatch(
        applyWorkspaceProposal({
          proposal: makeBulkProposal("workspace.bulkDelete", ["ws-x"]),
        }),
      );
      await flush();

      expect(lifecycleEntry("tc-bulk-1")).toMatchObject({
        status: "failed",
        error: "Failed to delete 1 of 1 space",
      });
      const { toast } = await import("svelte-sonner");
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Failed to delete 1 of 1 space");
      expect(stored("ws-x")).toBeDefined();
    });

    it("treats delete timeouts as still-deleting, keeps the entity, and still applies", async () => {
      ws.delete.mockResolvedValueOnce({
        ok: false,
        error: "JSON-RPC request timed out: workspace.delete",
      } as never);
      seed(makeWorkspace({ id: "ws-slow", status: WorkspaceStatusEnum.Archived }));

      appStore.dispatch(
        applyWorkspaceProposal({
          proposal: makeBulkProposal("workspace.bulkDelete", ["ws-slow"]),
        }),
      );
      await flush();

      // Entity is NOT removed on timeout — the workspace:deleted event will do it.
      expect(stored("ws-slow")).toBeDefined();
      expect(lifecycleEntry("tc-bulk-1")).toMatchObject({ status: "applied" });
      const { toast } = await import("svelte-sonner");
      expect(vi.mocked(toast.info)).toHaveBeenCalledWith(
        "1 space is still deleting (large checkout)",
      );
    });

    it("dedupes rapid double-applies via the lifecycle slice", async () => {
      seed(makeWorkspace({ id: "ws-1" }));

      const proposal = makeBulkProposal("workspace.bulkArchive", ["ws-1"]);
      appStore.dispatch(applyWorkspaceProposal({ proposal }));
      appStore.dispatch(applyWorkspaceProposal({ proposal }));
      await flush();

      expect(ws.archive).toHaveBeenCalledTimes(1);
    });
  });
});
