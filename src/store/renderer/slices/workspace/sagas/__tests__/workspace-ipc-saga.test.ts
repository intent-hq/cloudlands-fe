import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { testSaga } from "redux-saga-test-plan";
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
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
}));

const {
  takeEveryFromElectronChannelMock,
  takeEveryFromListenSyncMock,
  mockAppStoreFactory,
  mockDelete,
} = vi.hoisted(() => ({
  takeEveryFromElectronChannelMock: vi.fn(function* () {}),
  takeEveryFromListenSyncMock: vi.fn(function* () {}),
  mockAppStoreFactory: vi.fn(),
  mockDelete: vi.fn(),
}));

vi.mock("$store/renderer/utils/ipc-channel", () => ({
  takeEveryFromElectronChannel: takeEveryFromElectronChannelMock,
  takeEveryFromListenSync: takeEveryFromListenSyncMock,
}));

vi.mock("$store/renderer/store", async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => mockAppStoreFactory()?.getState?.() ?? {},
    dispatch: (...args: any[]) => mockAppStoreFactory()?.dispatch?.(...args),
  });
});

vi.mock("$store/renderer/slices/workspace/utils/workspace.client", () => ({
  workspaceClient: { delete: mockDelete },
}));

import {
  clearPendingCreation,
  initialState,
  removeWorkspaceEntity,
  setPendingCreation,
  setWorkspaceEntity,
  updateWorkspaceEntity,
  workspaceReducer,
} from "../../workspace-slice";
import { WorkspaceId } from "$shared/types/branded-ids";
import type { Workspace } from "$shared/types";
import { WorkspaceStatusEnum } from "$shared/types";
import { getItem } from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";
import {
  watchWorkspaceUpdatedSaga,
  watchWorkspaceCreatedSaga,
  watchWorkspaceDeletedSaga,
  watchWorkspaceArchivedSaga,
  watchWorkspaceBackgroundEnrichmentSaga,
  watchCoalescedWorkspaceUpdatesOnMountSaga,
  watchMountedWorkspaceInterestCleanupSaga,
  watchWorkspaceBeforeUnloadSaga,
  workspaceIpcSaga,
  WORKSPACE_BEFORE_UNLOAD_POLL_MS,
  flushCoalescedWorkspaceUpdateOnMountSaga,
  clearMountedWorkspaceInterestOnUnmountSaga,
  __resetWorkspaceIpcCoalescingForTesting,
} from "../workspace-ipc-saga";
import {
  workspaceMounted,
  workspaceUnmounted,
} from "../../../workspace-lifecycle/workspace-lifecycle-slice";

function makeWorkspace(overrides: Partial<Workspace> & { id: string }): Workspace {
  return {
    title: "Test Workspace",
    branch: "main",
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatusEnum.Active,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
    id: overrides.id as WorkspaceId,
  };
}

function getListenSyncHandler(eventName: string) {
  const call = takeEveryFromListenSyncMock.mock.calls.find(([name]: any) => name === eventName);
  expect(call).toBeDefined();
  return call![1] as (data: any) => Generator;
}

function getElectronHandler(eventName: string) {
  const call = takeEveryFromElectronChannelMock.mock.calls.find(([name]: any) => name === eventName);
  expect(call).toBeDefined();
  return call![1] as (data: any) => Generator;
}

describe("workspace-ipc-saga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetWorkspaceIpcCoalescingForTesting();
    mockAppStoreFactory.mockReturnValue({
      getState: () => ({
        workspace: { activeWorkspaceId: "ws-1", pendingDeletions: { "ws-1": true } },
      }),
    });
  });

  it("forks all IPC sub-sagas", () => {
    testSaga(workspaceIpcSaga)
      .next()
      .fork(watchWorkspaceUpdatedSaga)
      .next()
      .fork(watchWorkspaceCreatedSaga)
      .next()
      .fork(watchWorkspaceDeletedSaga)
      .next()
      .fork(watchWorkspaceArchivedSaga)
      .next()
      .fork(watchWorkspaceBackgroundEnrichmentSaga)
      .next()
      .fork(watchCoalescedWorkspaceUpdatesOnMountSaga)
      .next()
      .fork(watchMountedWorkspaceInterestCleanupSaga)
      .next()
      .fork(watchWorkspaceBeforeUnloadSaga)
      .next()
      .isDone();
  });

  describe("watchWorkspaceUpdatedSaga", () => {
    it("dispatches updateWorkspaceEntity on workspace:updated", () => {
      watchWorkspaceUpdatedSaga().next();

      const handler = getListenSyncHandler("workspace:updated");
      const iterator = handler({
        workspaceId: "ws-1",
        changes: { title: "New Title" },
      });
      expect((iterator.next().value as any).type).toBe("SELECT");
      const effect = iterator.next("ws-1").value as any;

      expect(effect.type).toBe("PUT");
      expect(effect.payload.action).toEqual(
        updateWorkspaceEntity("ws-1", { title: "New Title" }),
      );
    });

    it("coalesces inactive workspace updates until that workspace mounts", () => {
      watchWorkspaceUpdatedSaga().next();

      const handler = getListenSyncHandler("workspace:updated");
      const first = handler({ workspaceId: "ws-2", changes: { title: "Old" } });
      expect((first.next().value as any).type).toBe("SELECT");
      expect((first.next("ws-1").value as any).type).toBe("SELECT");
      expect((first.next(false).value as any).type).toBe("SELECT");
      expect((first.next(false).value as any).type).toBe("SELECT");
      expect(first.next([])).toEqual({ value: undefined, done: true });

      const second = handler({ workspaceId: "ws-2", changes: { branch: "feature" } });
      expect((second.next().value as any).type).toBe("SELECT");
      expect((second.next("ws-1").value as any).type).toBe("SELECT");
      expect((second.next(false).value as any).type).toBe("SELECT");
      expect((second.next(false).value as any).type).toBe("SELECT");
      expect(second.next([])).toEqual({ value: undefined, done: true });

      const flush = flushCoalescedWorkspaceUpdateOnMountSaga(workspaceMounted("ws-2"));
      const effect = flush.next().value as any;
      expect(effect.type).toBe("PUT");
      expect(effect.payload.action).toEqual(
        updateWorkspaceEntity("ws-2", { title: "Old", branch: "feature" }),
      );
      expect(flush.next()).toEqual({ value: undefined, done: true });
    });

    it("preserves updates for a mounted non-active workspace", () => {
      const mount = flushCoalescedWorkspaceUpdateOnMountSaga(workspaceMounted("ws-open"));
      expect(mount.next()).toEqual({ value: undefined, done: true });

      watchWorkspaceUpdatedSaga().next();

      const handler = getListenSyncHandler("workspace:updated");
      const iterator = handler({ workspaceId: "ws-open", changes: { title: "Open" } });
      expect((iterator.next().value as any).type).toBe("SELECT");
      const effect = iterator.next("ws-active").value as any;

      expect(effect.type).toBe("PUT");
      expect(effect.payload.action).toEqual(
        updateWorkspaceEntity("ws-open", { title: "Open" }),
      );
    });

    it("preserves updates for an open but unmounted non-active workspace tab", () => {
      watchWorkspaceUpdatedSaga().next();

      const handler = getListenSyncHandler("workspace:updated");
      const iterator = handler({ workspaceId: "ws-tab", changes: { title: "Open Tab" } });
      expect((iterator.next().value as any).type).toBe("SELECT");
      expect((iterator.next("ws-active").value as any).type).toBe("SELECT");
      const effect = iterator.next(true).value as any;

      expect(effect.type).toBe("PUT");
      expect(effect.payload.action).toEqual(
        updateWorkspaceEntity("ws-tab", { title: "Open Tab" }),
      );
    });
  });

  describe("watchWorkspaceCreatedSaga", () => {
    it("dispatches setPendingCreation and setWorkspaceEntity on workspace:created", () => {
      watchWorkspaceCreatedSaga().next();

      const workspace = makeWorkspace({ id: "ws-new", title: "New Space" });
      const handler = getListenSyncHandler("workspace:created");
      const iterator = handler({ workspaceId: "ws-new", workspace });

      const first = iterator.next().value as any;
      expect(first.type).toBe("PUT");
      expect(first.payload.action).toEqual(setPendingCreation(workspace));

      const second = iterator.next().value as any;
      expect(second.type).toBe("PUT");
      expect(second.payload.action).toEqual(setWorkspaceEntity(workspace));

      expect(iterator.next().done).toBe(true);
    });

    it("is a no-op when workspaceId or workspace is missing", () => {
      watchWorkspaceCreatedSaga().next();

      const handler = getListenSyncHandler("workspace:created");
      expect(handler({ workspaceId: "ws-new" }).next().done).toBe(true);
      expect(handler({ workspaceId: "", workspace: makeWorkspace({ id: "ws-new" }) }).next().done).toBe(true);
    });

    it("is idempotent for the originating window that already inserted the workspace", () => {
      const workspace = makeWorkspace({ id: "ws-new", title: "New Space" });

      // Originating window: workspace-crud-saga already dispatched these actions.
      let state = workspaceReducer(initialState, setPendingCreation(workspace));
      state = workspaceReducer(state, setWorkspaceEntity(workspace));

      // The broadcast event replays the same actions.
      let replayed = workspaceReducer(state, setPendingCreation(workspace));
      replayed = workspaceReducer(replayed, setWorkspaceEntity(workspace));

      expect(getItem(replayed.workspaces, "ws-new")).toEqual(getItem(state.workspaces, "ws-new"));
      expect(replayed.workspaces.ids).toEqual(state.workspaces.ids);
      expect(replayed.pendingCreations).toEqual(state.pendingCreations);
    });
  });

  describe("watchWorkspaceDeletedSaga", () => {
    it("removes the entity and clears pendingCreations on workspace:deleted", () => {
      watchWorkspaceDeletedSaga().next();

      const handler = getListenSyncHandler("workspace:deleted");
      const iterator = handler({ workspaceId: "ws-gone" });

      const first = iterator.next().value as any;
      expect(first.type).toBe("PUT");
      expect(first.payload.action).toEqual(removeWorkspaceEntity("ws-gone"));

      const second = iterator.next().value as any;
      expect(second.type).toBe("PUT");
      expect(second.payload.action).toEqual(clearPendingCreation("ws-gone"));

      expect(iterator.next().done).toBe(true);
    });

    it("is a no-op when workspaceId is missing", () => {
      watchWorkspaceDeletedSaga().next();

      const handler = getListenSyncHandler("workspace:deleted");
      expect(handler({ workspaceId: "" }).next().done).toBe(true);
    });

    it("is idempotent when the originating window already removed the entity", () => {
      const workspace = makeWorkspace({ id: "ws-gone" });
      let state = workspaceReducer(initialState, setWorkspaceEntity(workspace));
      state = workspaceReducer(state, removeWorkspaceEntity("ws-gone"));
      state = workspaceReducer(state, clearPendingCreation("ws-gone"));

      let replayed = workspaceReducer(state, removeWorkspaceEntity("ws-gone"));
      replayed = workspaceReducer(replayed, clearPendingCreation("ws-gone"));

      expect(replayed).toBe(state);
    });
  });

  describe("watchWorkspaceArchivedSaga", () => {
    it("marks the workspace archived on workspace:archived", () => {
      watchWorkspaceArchivedSaga().next();

      const handler = getListenSyncHandler("workspace:archived");
      const iterator = handler({ workspaceId: "ws-arch" });

      const effect = iterator.next().value as any;
      expect(effect.type).toBe("PUT");
      expect(effect.payload.action).toEqual(
        updateWorkspaceEntity("ws-arch", {
          status: WorkspaceStatusEnum.Archived,
          archived: true,
        }),
      );

      expect(iterator.next().done).toBe(true);
    });

    it("is a no-op when workspaceId is missing", () => {
      watchWorkspaceArchivedSaga().next();

      const handler = getListenSyncHandler("workspace:archived");
      expect(handler({ workspaceId: "" }).next().done).toBe(true);
    });
  });

  describe("watchWorkspaceBackgroundEnrichmentSaga", () => {
    it("dispatches updateWorkspaceEntity on enrichment complete", () => {
      watchWorkspaceBackgroundEnrichmentSaga().next();

      const handler = getElectronHandler("workspace:background-enrichment-complete");
      const iterator = handler({
        workspaceId: "ws-1",
        updates: { prUrl: "https://example.com/pr/1" },
      });
      expect((iterator.next().value as any).type).toBe("SELECT");
      const effect = iterator.next("ws-1").value as any;

      expect(effect.type).toBe("PUT");
      expect(effect.payload.action).toEqual(
        updateWorkspaceEntity("ws-1", { prUrl: "https://example.com/pr/1" }),
      );
    });

    it("preserves enrichment updates for a subscribed non-active workspace", () => {
      watchWorkspaceBackgroundEnrichmentSaga().next();

      const handler = getElectronHandler("workspace:background-enrichment-complete");
      const iterator = handler({
        workspaceId: "ws-subscribed",
        updates: { prUrl: "https://example.com/pr/2" },
      });
      expect((iterator.next().value as any).type).toBe("SELECT");
      expect((iterator.next("ws-active").value as any).type).toBe("SELECT");
      expect((iterator.next(false).value as any).type).toBe("SELECT");
      const effect = iterator.next(true).value as any;

      expect(effect.type).toBe("PUT");
      expect(effect.payload.action).toEqual(
        updateWorkspaceEntity("ws-subscribed", { prUrl: "https://example.com/pr/2" }),
      );
    });

    it("preserves enrichment updates for open but unmounted workspace tabs", () => {
      watchWorkspaceBackgroundEnrichmentSaga().next();

      const handler = getElectronHandler("workspace:background-enrichment-complete");
      const iterator = handler({
        workspaceId: "ws-tab",
        updates: { prUrl: "https://example.com/pr/3" },
      });
      expect((iterator.next().value as any).type).toBe("SELECT");
      expect((iterator.next("ws-active").value as any).type).toBe("SELECT");
      const effect = iterator.next(true).value as any;

      expect(effect.type).toBe("PUT");
      expect(effect.payload.action).toEqual(
        updateWorkspaceEntity("ws-tab", { prUrl: "https://example.com/pr/3" }),
      );
    });

    it("is a no-op when workspaceId or updates is missing", () => {
      watchWorkspaceBackgroundEnrichmentSaga().next();

      const handler = getElectronHandler("workspace:background-enrichment-complete");
      const result = handler({ workspaceId: null, updates: null }).next();
      expect(result.done).toBe(true);
    });
  });

  describe("watchCoalescedWorkspaceUpdatesOnMountSaga", () => {
    it("registers workspaceMounted watcher", () => {
      expect(watchCoalescedWorkspaceUpdatesOnMountSaga().next().value).toEqual(
        sagaEffects.takeEvery(workspaceMounted, flushCoalescedWorkspaceUpdateOnMountSaga),
      );
    });
  });

  describe("watchMountedWorkspaceInterestCleanupSaga", () => {
    it("registers workspaceUnmounted watcher", () => {
      expect(watchMountedWorkspaceInterestCleanupSaga().next().value).toEqual(
        sagaEffects.takeEvery(workspaceUnmounted, clearMountedWorkspaceInterestOnUnmountSaga),
      );
    });
  });

  describe("watchWorkspaceBeforeUnloadSaga", () => {
    it("registers a beforeunload listener that flushes pending deletions", () => {
      const iterator = watchWorkspaceBeforeUnloadSaga();

      // 1. Initial snapshot of pending deletions via selector effect
      const selectEffect = iterator.next().value as any;
      expect(selectEffect.type).toBe("SELECT");

      // 2. Fork a takeLatestFromSelector subscription to keep snapshot fresh
      const forkEffect = iterator.next({ "ws-1": true }).value as any;
      expect(forkEffect.type).toBe("FORK");

      // 3. Register the beforeunload listener via a CALL effect
      const callEffect = iterator.next().value as any;
      expect(callEffect.type).toBe("CALL");

      // Execute the handler function to verify it calls workspaceClient.delete
      const handler = callEffect.payload.args[0] as () => void;
      handler();
      expect(mockDelete).toHaveBeenCalledWith(WorkspaceId("ws-1"));

      // Next yield is the delay loop
      expect(iterator.next(() => {}).value).toEqual(
        sagaEffects.delay(WORKSPACE_BEFORE_UNLOAD_POLL_MS),
      );
    });
  });
});

