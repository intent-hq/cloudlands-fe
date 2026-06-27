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

import { workspaceClient } from "$store/renderer/slices/workspace/utils/workspace.client";
import { hasRunningAgents } from "$lib/utils/delete-warning-utils";
import { store as appStore } from "$store/renderer/store";
import { getItem } from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";
import {
  resetWorkspaceState,
  setWorkspaceEntity,
} from "$store/renderer/slices/workspace/workspace-slice";
import {
  confirmBulkArchive,
  confirmBulkDeleteArchived,
  openBulkArchiveConfirm,
  openBulkDeleteArchivedConfirm,
  requestArchiveWorkspace,
  requestDeleteWorkspace,
  requestUnarchiveWorkspace,
} from "$store/renderer/slices/workspace-operations/workspace-operations-slice";

const ws = workspaceClient as unknown as Record<string, ReturnType<typeof vi.fn>>;
const agents = vi.mocked(hasRunningAgents);
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
    appStore.dispatch(resetWorkspaceState());
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

  it("bulk-deletes every archived workspace for the pending repo", async () => {
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
});
