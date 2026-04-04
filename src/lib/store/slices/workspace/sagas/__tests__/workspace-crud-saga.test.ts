import { beforeEach, describe, expect, it, vi } from "vitest";
import * as sagaEffects from "redux-saga/effects";

// Must mock typed-redux-saga BEFORE importing saga modules
vi.mock("typed-redux-saga", () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  delay: function* (ms: number) {
    return yield sagaEffects.delay(ms);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
}));

const {
  mockCreate,
  mockDelete,
  mockDuplicate,
  mockOpen,
  mockUpdate,
  mockTrack,
  mockClearDeferredResults,
  mockInvalidateAgentCache,
  mockWorkspaceStorageClearState,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockDelete: vi.fn(),
  mockDuplicate: vi.fn(),
  mockOpen: vi.fn(),
  mockUpdate: vi.fn(),
  mockTrack: vi.fn(),
  mockClearDeferredResults: vi.fn(),
  mockInvalidateAgentCache: vi.fn(),
  mockWorkspaceStorageClearState: vi.fn(),
}));

vi.mock("$lib/store/slices/workspace/utils/workspace.client", () => ({
  workspaceClient: {
    create: mockCreate,
    delete: mockDelete,
    duplicate: mockDuplicate,
    open: mockOpen,
    update: mockUpdate,
  },
}));

vi.mock("$lib/services/analytics", () => ({ track: mockTrack }));
vi.mock("$features/agent/deferred-results-cache", () => ({ clearDeferredResults: mockClearDeferredResults }));
vi.mock("$lib/utils/agent-loader", () => ({ invalidateAgentCache: mockInvalidateAgentCache }));
vi.mock("$lib/store/slices/pr-status/pr-status-slice", () => ({
  cleanupPRStatusWorkspace: (wsId: string) => ({ type: "prStatus/cleanupWorkspace", payload: [wsId] }),
}));

const mockClearWorkspaceTransientUi = vi.hoisted(() =>
  vi.fn((wsId: string) => ({ type: "transientUi/clearWorkspaceTransientUi", payload: [wsId] })),
);

vi.mock("$lib/store/slices/transient-ui/transient-ui-slice", async () => {
  const actual = await vi.importActual<object>("$lib/store/slices/transient-ui/transient-ui-slice");
  return { ...actual, clearWorkspaceTransientUi: mockClearWorkspaceTransientUi };
});

vi.mock("$lib/store/slices/workspace/utils/workspace-storage-manager", () => ({
  workspaceStorageManager: { clearState: mockWorkspaceStorageClearState },
}));

vi.mock("$lib/store/utils/ipc-channel", () => ({
  takeEveryFromElectronChannel: vi.fn(function* () {}),
  takeEveryFromListenSync: vi.fn(function* () {}),
}));

vi.mock("$lib/store/redux-dispatch-bridge", () => ({
  getReduxStore: vi.fn(),
}));

import { workspaceClient } from "$lib/store/slices/workspace/utils/workspace.client";
import { workspaceUnmounted } from "../../../workspace-lifecycle/workspace-lifecycle-slice";
import { removeWorkspaceAgentState } from "../../../workspace-agents/workspace-agents-slice";
import { clearWorkspaceTransientUi } from "$lib/store/slices/transient-ui/transient-ui-slice";
import { clearWorkspaceStats as clearLineChangesWorkspaceStats } from "$lib/store/slices/line-changes/line-changes-slice";
import {
  createWorkspaceRequested,
  deleteWorkspaceRequested,
  duplicateWorkspaceRequested,
  openWorkspaceRequested,
  updateWorkspaceRequested,
  clearPendingCreation,
  clearWorkspacePendingDeletion,
  markWorkspacePendingDeletion,
  removeWorkspaceEntity,
  setActiveWorkspaceId,
  setPendingCreation,
  setWorkspaceCreating,
  setWorkspaceEntity,
  setWorkspaceError,
  setWorkspaceLoading,
} from "../../workspace-slice";
import { WorkspaceId } from "$shared/types/branded-ids";
import {
  handleCreateWorkspace,
  handleDeleteWorkspace,
  handleDuplicateWorkspace,
  handleOpenWorkspace,
  handleUpdateWorkspace,
} from "../workspace-crud-saga";

describe("workspace-crud-saga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleCreateWorkspace", () => {
    it("creates a workspace, sets entity and active id, then schedules refresh", () => {
      const request = { title: "New WS", scope: "path" } as any;
      const workspace = { id: "ws-new", title: "New WS" };
      const iterator = handleCreateWorkspace(createWorkspaceRequested(request));

      expect(iterator.next().value).toEqual(sagaEffects.put(setWorkspaceLoading(true)));
      expect(iterator.next().value).toEqual(sagaEffects.put(setWorkspaceError(null)));
      expect(iterator.next().value).toEqual(sagaEffects.put(setWorkspaceCreating(true)));
      expect(iterator.next().value).toEqual(
        sagaEffects.call([workspaceClient, workspaceClient.create], request),
      );
      expect(iterator.next({ ok: true, data: workspace }).value).toEqual(
        sagaEffects.put(setPendingCreation(workspace as any)),
      );
      expect(iterator.next().value).toEqual(sagaEffects.put(setWorkspaceEntity(workspace as any)));
      expect(iterator.next().value).toEqual(sagaEffects.put(setActiveWorkspaceId("ws-new")));

      // track call
      const trackEffect = iterator.next().value as any;
      expect(trackEffect.type).toBe("CALL");

      // finally block
      expect(iterator.next().value).toEqual(sagaEffects.put(setWorkspaceLoading(false)));
      expect(iterator.next().value).toEqual(sagaEffects.put(setWorkspaceCreating(false)));
      // fork scheduleWorkspaceRefresh
      expect((iterator.next().value as any).type).toBe("FORK");
      expect(iterator.next().done).toBe(true);
    });

    it("sets error on create failure", () => {
      const request = { title: "Fail" } as any;
      const iterator = handleCreateWorkspace(createWorkspaceRequested(request));

      iterator.next(); // setWorkspaceLoading
      iterator.next(); // setWorkspaceError
      iterator.next(); // setWorkspaceCreating

      // call returns error
      expect(iterator.next().value).toEqual(
        sagaEffects.call([workspaceClient, workspaceClient.create], request),
      );
      const errorPut = iterator.next({ ok: false, error: "Create failed" }).value;
      expect(errorPut).toEqual(sagaEffects.put(setWorkspaceError("Create failed")));
    });
  });

  describe("handleOpenWorkspace", () => {
    it("opens a workspace and sets it as active", () => {
      const workspace = { id: "ws-1", title: "Opened" };
      const iterator = handleOpenWorkspace(openWorkspaceRequested("ws-1"));

      expect(iterator.next().value).toEqual(sagaEffects.put(setWorkspaceLoading(true)));
      expect(iterator.next().value).toEqual(sagaEffects.put(setWorkspaceError(null)));
      expect(iterator.next().value).toEqual(
        sagaEffects.call([workspaceClient, workspaceClient.open], WorkspaceId("ws-1")),
      );
      expect(iterator.next({ ok: true, data: workspace }).value).toEqual(
        sagaEffects.put(setWorkspaceEntity(workspace as any)),
      );
      expect(iterator.next().value).toEqual(sagaEffects.put(setActiveWorkspaceId("ws-1")));
      // finally: setWorkspaceLoading(false)
      expect(iterator.next().value).toEqual(sagaEffects.put(setWorkspaceLoading(false)));
      expect(iterator.next().done).toBe(true);
    });

    it("sets error when open fails", () => {
      const iterator = handleOpenWorkspace(openWorkspaceRequested("ws-bad"));

      iterator.next(); // setWorkspaceLoading
      iterator.next(); // setWorkspaceError(null)

      expect(iterator.next().value).toEqual(
        sagaEffects.call([workspaceClient, workspaceClient.open], WorkspaceId("ws-bad")),
      );
      expect(iterator.next({ ok: false, error: "Not found" }).value).toEqual(
        sagaEffects.put(setWorkspaceError("Not found")),
      );
    });
  });

  describe("handleUpdateWorkspace", () => {
    it("updates a workspace entity in the store", () => {
      const updated = { id: "ws-1", title: "Updated" };
      const iterator = handleUpdateWorkspace(
        updateWorkspaceRequested("ws-1", { title: "Updated" }),
      );

      // select existing workspace
      expect((iterator.next().value as any).type).toBe("SELECT");
      expect(
        iterator.next({ id: "ws-1", title: "Old" } as any).value,
      ).toEqual(
        sagaEffects.call([workspaceClient, workspaceClient.update], {
          id: WorkspaceId("ws-1"),
          title: "Updated",
        }),
      );
      expect(iterator.next({ ok: true, data: updated }).value).toEqual(
        sagaEffects.put(setWorkspaceEntity(updated as any)),
      );
      // track rename
      const trackEffect = iterator.next().value as any;
      expect(trackEffect.type).toBe("CALL");
      trackEffect.payload.fn();
      expect(mockTrack).toHaveBeenCalledWith("Renamed Workspace", { workspace_id: "ws-1" });
      expect(iterator.next().done).toBe(true);
    });

    it("does not track rename when title is unchanged", () => {
      const updated = { id: "ws-1", title: "Same" };
      const iterator = handleUpdateWorkspace(
        updateWorkspaceRequested("ws-1", { title: "Same" }),
      );

      iterator.next(); // select
      iterator.next({ id: "ws-1", title: "Same" } as any); // call update
      iterator.next({ ok: true, data: updated }); // put setWorkspaceEntity
      expect(iterator.next().done).toBe(true);
      expect(mockTrack).not.toHaveBeenCalled();
    });
  });

  describe("handleDuplicateWorkspace", () => {
    it("duplicates a workspace and schedules refresh", () => {
      const workspace = { id: "ws-dup", title: "Copy" };
      const iterator = handleDuplicateWorkspace(
        duplicateWorkspaceRequested("ws-1", "Copy"),
      );

      expect(iterator.next().value).toEqual(sagaEffects.put(setWorkspaceCreating(true)));
      expect(iterator.next().value).toEqual(
        sagaEffects.call(
          [workspaceClient, workspaceClient.duplicate],
          WorkspaceId("ws-1"),
          "Copy",
        ),
      );
      expect(iterator.next({ ok: true, data: workspace }).value).toEqual(
        sagaEffects.put(setPendingCreation(workspace as any)),
      );
      expect(iterator.next().value).toEqual(
        sagaEffects.put(setWorkspaceEntity(workspace as any)),
      );
      // finally
      expect(iterator.next().value).toEqual(sagaEffects.put(setWorkspaceCreating(false)));
      expect((iterator.next().value as any).type).toBe("FORK");
      expect(iterator.next().done).toBe(true);
    });
  });

  describe("handleDeleteWorkspace", () => {
    it("deletes a workspace, runs cleanup, and tracks analytics", () => {
      const iterator = handleDeleteWorkspace(deleteWorkspaceRequested("ws-1"));

      // select existing
      expect((iterator.next().value as any).type).toBe("SELECT");
      expect(iterator.next({ id: "ws-1", title: "Delete Me" } as any).value).toEqual(
        sagaEffects.put(markWorkspacePendingDeletion("ws-1")),
      );
      expect(iterator.next().value).toEqual(
        sagaEffects.call([workspaceClient, workspaceClient.delete], WorkspaceId("ws-1")),
      );
      // cleanup chain
      expect(iterator.next({ ok: true }).value).toEqual(
        sagaEffects.call(mockClearDeferredResults, "ws-1"),
      );
      expect(iterator.next().value).toEqual(
        sagaEffects.put({ type: "prStatus/cleanupWorkspace", payload: ["ws-1"] }),
      );
      expect(iterator.next().value).toEqual(sagaEffects.call(mockInvalidateAgentCache, "ws-1"));
      expect(iterator.next().value).toEqual(sagaEffects.put(removeWorkspaceAgentState("ws-1")));
      expect(iterator.next().value).toEqual(sagaEffects.put(workspaceUnmounted("ws-1")));
      expect(iterator.next().value).toEqual(sagaEffects.put(clearWorkspaceTransientUi("ws-1")));
      expect(iterator.next().value).toEqual(sagaEffects.put(clearLineChangesWorkspaceStats("ws-1")));
      expect(iterator.next().value).toEqual(
        sagaEffects.call(
          [{ clearState: mockWorkspaceStorageClearState }, mockWorkspaceStorageClearState],
          "ws-1",
        ),
      );
      expect(iterator.next().value).toEqual(sagaEffects.put(removeWorkspaceEntity("ws-1")));
      expect(iterator.next().value).toEqual(sagaEffects.put(clearPendingCreation("ws-1")));
      // track
      const trackEffect = iterator.next().value as any;
      expect(trackEffect.type).toBe("CALL");
      trackEffect.payload.fn();
      expect(mockTrack).toHaveBeenCalledWith("Deleted Workspace", {
        workspace_id: "ws-1",
        workspace_title: "Delete Me",
      });
      // finally
      expect(iterator.next().value).toEqual(
        sagaEffects.put(clearWorkspacePendingDeletion("ws-1")),
      );
      expect(iterator.next().done).toBe(true);
    });

    it("clears pending deletion even when backend returns not ok", () => {
      const iterator = handleDeleteWorkspace(deleteWorkspaceRequested("ws-1"));

      iterator.next(); // select
      iterator.next({ id: "ws-1", title: "X" } as any); // markWorkspacePendingDeletion
      iterator.next(); // call delete

      // backend failure — saga returns early, but finally still runs
      const step = iterator.next({ ok: false });
      // finally: clearWorkspacePendingDeletion
      expect(step.value).toEqual(
        sagaEffects.put(clearWorkspacePendingDeletion("ws-1")),
      );
    });
  });
});
