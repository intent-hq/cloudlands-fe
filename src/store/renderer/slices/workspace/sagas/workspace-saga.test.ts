import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { testSaga } from "redux-saga-test-plan";
import * as sagaEffects from "redux-saga/effects";
import { workspaceClient } from "$store/renderer/slices/workspace/utils/workspace.client";

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
  take: function* (patternOrChannel: any) {
    return yield sagaEffects.take(patternOrChannel);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
  takeLatest: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeLatest(pattern, worker);
  },
  cancelled: function* () {
    return yield sagaEffects.cancelled();
  },
}));

const {
  takeEveryFromElectronChannelMock,
  takeEveryFromListenSyncMock,
  mockArchive,
  mockClearWorkspaceTransientUi,
  mockCreate,
  mockDelete,
  mockDuplicate,
  mockAppStoreFactory,
  mockInvalidateAgentCache,
  mockList,
  mockOpen,
  mockTrack,
  mockUnarchive,
  mockUpdate,
  mockWorkspaceStorageClearState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  mockCleanupPRStatusForWorkspace,
} = vi.hoisted(() => ({
  takeEveryFromElectronChannelMock: vi.fn(function* () {}),
  takeEveryFromListenSyncMock: vi.fn(function* () {}),
  mockArchive: vi.fn(),
  mockClearWorkspaceTransientUi: vi.fn((workspaceId: string) => ({
    type: "transientUi/clearWorkspaceTransientUi",
    payload: [workspaceId],
  })),
  mockCreate: vi.fn(),
  mockDelete: vi.fn(),
  mockDuplicate: vi.fn(),
  mockAppStoreFactory: vi.fn(),
  mockInvalidateAgentCache: vi.fn(),
  mockList: vi.fn(),
  mockOpen: vi.fn(),
  mockTrack: vi.fn(),
  mockUnarchive: vi.fn(),
  mockUpdate: vi.fn(),
  mockWorkspaceStorageClearState: vi.fn(),
  mockCleanupPRStatusForWorkspace: vi.fn(),
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
  workspaceClient: {
    archive: mockArchive,
    create: mockCreate,
    delete: mockDelete,
    duplicate: mockDuplicate,
    list: mockList,
    open: mockOpen,
    unarchive: mockUnarchive,
    update: mockUpdate,
  },
}));

vi.mock("$lib/services/analytics", () => ({
  track: mockTrack,
}));

vi.mock("$store/renderer/slices/pr-status/pr-status-slice", async (importOriginal) => ({
  ...(await importOriginal<typeof import('$store/renderer/slices/pr-status/pr-status-slice')>()),
  cleanupPRStatusWorkspace: (wsId: string) => ({ type: "prStatus/cleanupWorkspace", payload: [wsId] }),
}));

vi.mock("$lib/utils/agent-loader", () => ({
  invalidateAgentCache: mockInvalidateAgentCache,
}));

vi.mock("$store/renderer/slices/transient-ui/transient-ui-slice", async () => {
  const actual = await vi.importActual<object>("$store/renderer/slices/transient-ui/transient-ui-slice");
  return {
    ...actual,
    clearWorkspaceTransientUi: mockClearWorkspaceTransientUi,
  };
});

vi.mock("$store/renderer/slices/workspace/utils/workspace-storage-manager", () => ({
  workspaceStorageManager: {
    clearState: mockWorkspaceStorageClearState,
  },
}));

import { workspaceUnmounted } from "../../workspace-lifecycle/workspace-lifecycle-slice";
import { removeWorkspaceAgentState } from "../../workspace-agents/workspace-agents-slice";
import {
  getLocalStorageJSON,
  setLocalStorageJSON,
} from "$store/renderer/utils/safe-local-storage-saga";
import {
  applyOptimisticTaskStatusUpdate,
  createWorkspaceRequested,
  cleanupRecency,
  deleteWorkspaceRequested,
  duplicateWorkspaceRequested,
  clearPendingCreation,
  clearWorkspacePendingDeletion,
  loadRecencyData,
  loadWorkspacesRequested,
  markWorkspacePendingDeletion,
  openWorkspaceRequested,
  recordWorkspaceView,
  removeWorkspaceEntity,
  replaceWorkspaceList,
  setActiveWorkspaceId,
  setPendingCreation,
  setWorkspaceCreating,
  setWorkspaceEntity,
  setWorkspaceError,
  setWorkspaceHasLoaded,
  setWorkspaceLoading,
  updateWorkspaceEntity,
  updateWorkspaceRequested,
} from "../workspace-slice";
import { selectWorkspaceRecency } from "../workspace-selectors";
import { clearWorkspaceTransientUi } from "$store/renderer/slices/transient-ui/transient-ui-slice";
import {
  handleLoadWorkspaces,
  initializeWorkspaceRecencySaga,
  performLoadWorkspaces,
  persistWorkspaceRecency,
  watchWorkspaceLoadRequestsSaga,
  watchWorkspaceRecencyPersistenceSaga,
  WORKSPACE_RECENCY_STORAGE_KEY,
  workspaceSaga,
} from "./workspace-saga";
import {
  handleCreateWorkspace,
  handleDeleteWorkspace,
  handleDuplicateWorkspace,
  handleOpenWorkspace,
  handleUpdateWorkspace,
  watchWorkspaceRequestSaga,
  workspaceCrudSaga,
} from "./workspace-crud-saga";
import {
  watchTaskStatusChangedSaga,
  watchWorkspaceBeforeUnloadSaga,
  watchWorkspaceBackgroundEnrichmentSaga,
  watchWorkspaceUpdatedSaga,
  WORKSPACE_BEFORE_UNLOAD_POLL_MS,
  workspaceIpcSaga,
} from "./workspace-ipc-saga";
import { WorkspaceId } from "$shared/types/branded-ids";

function getListenSyncHandler(eventName: string) {
  const call = takeEveryFromListenSyncMock.mock.calls.find(([name]) => name === eventName);
  expect(call).toBeDefined();
  return call![1] as (data: any) => Generator;
}

function getElectronHandler(eventName: string) {
  const call = takeEveryFromElectronChannelMock.mock.calls.find(([name]) => name === eventName);
  expect(call).toBeDefined();
  return call![1] as (data: any) => Generator;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("workspaceSaga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppStoreFactory.mockReturnValue({
      getState: () => ({
        workspace: {
          pendingDeletions: { "ws-1": true },
        },
      }),
    });
  });

  it("forks all workspace sub-sagas", () => {
    testSaga(workspaceSaga)
      .next()
      .fork(workspaceIpcSaga)
      .next()
      .fork(workspaceCrudSaga)
      .next()
      .fork(watchWorkspaceLoadRequestsSaga)
      .next()
      .fork(initializeWorkspaceRecencySaga)
      .next()
      .fork(watchWorkspaceRecencyPersistenceSaga)
      .next()
      .isDone();
  });

  it("forks all workspace IPC sub-sagas", () => {
    testSaga(workspaceIpcSaga)
      .next()
      .fork(watchWorkspaceUpdatedSaga)
      .next()
      .fork(watchWorkspaceBackgroundEnrichmentSaga)
      .next()
      .fork(watchTaskStatusChangedSaga)
      .next()
      .fork(watchWorkspaceBeforeUnloadSaga)
      .next()
      .isDone();
  });

  it("forks workspace CRUD request watchers", () => {
    testSaga(workspaceCrudSaga).next().fork(watchWorkspaceRequestSaga).next().isDone();
  });

  it("applies workspace updates locally when the IPC event arrives", () => {
    const data = {
      workspaceId: "ws-1",
      changes: { title: "Updated title" },
    };
    const iterator = watchWorkspaceUpdatedSaga();

    expect(iterator.next()).toEqual({ value: undefined, done: true });

    const effect = getListenSyncHandler("workspace:updated")(data).next().value as any;
    expect(effect.type).toBe("PUT");
    expect(effect.payload.action).toEqual(updateWorkspaceEntity("ws-1", { title: "Updated title" }));
  });

  it("dispatches updateWorkspaceEntity to keep Redux entity in sync on workspace:updated", () => {
    const data = {
      workspaceId: "ws-1",
      changes: { title: "IPC Updated" },
    };
    const iterator = watchWorkspaceUpdatedSaga();
    iterator.next(); // register listener

    const handler = getListenSyncHandler("workspace:updated")(data);
    const putEffect = handler.next().value as any;
    expect(putEffect.type).toBe("PUT");
    expect(putEffect.payload.action).toEqual(
      updateWorkspaceEntity("ws-1", { title: "IPC Updated" }),
    );
  });

  it("dispatches enrichment updates from the background enrichment channel", () => {
    const data = {
      workspaceId: "ws-1",
      updates: { diffSummary: "Fresh summary" },
    };

    watchWorkspaceBackgroundEnrichmentSaga().next();
    const putEffect = getElectronHandler("workspace:background-enrichment-complete")(data).next()
      .value as any;

    expect(putEffect.type).toBe("PUT");
    expect(putEffect.payload.action).toEqual(
      updateWorkspaceEntity("ws-1", { diffSummary: "Fresh summary" }),
    );
  });

  it("dispatches optimistic task stat updates from task:status-changed", () => {
    const payload = {
      workspaceId: "ws-1",
      previousStatus: "in_progress",
      newStatus: "complete",
    };

    watchTaskStatusChangedSaga().next();
    const putEffect = getListenSyncHandler("task:status-changed")(payload).next().value as any;

    expect(putEffect.type).toBe("PUT");
    expect(putEffect.payload.action).toEqual(applyOptimisticTaskStatusUpdate(payload));
  });

  it("registers a beforeunload listener that flushes pending deletions", () => {
    const iterator = watchWorkspaceBeforeUnloadSaga();

    // 1. Initial snapshot via selector effect
    const selectEffect = iterator.next().value as any;
    expect(selectEffect.type).toBe("SELECT");

    // 2. Fork a takeLatestFromSelector subscription
    const forkEffect = iterator.next({ "ws-1": true }).value as any;
    expect(forkEffect.type).toBe("FORK");

    // 3. Register the beforeunload listener via CALL
    const effect = iterator.next().value as any;
    expect(effect.type).toBe("CALL");
    const handler = effect.payload.args[0] as () => void;
    handler();
    expect(mockDelete).toHaveBeenCalledWith(WorkspaceId("ws-1"));

    expect(iterator.next(() => {}).value).toEqual(sagaEffects.delay(WORKSPACE_BEFORE_UNLOAD_POLL_MS));
  });
});

describe("workspace request sagas", () => {
  it("registers the load workspace request handler", () => {
    const iterator = watchWorkspaceLoadRequestsSaga();
    const effect = iterator.next().value as any;

    expect(effect.type).toBe("FORK");
    expect(effect.payload.args).toEqual([loadWorkspacesRequested, handleLoadWorkspaces]);
    expect(iterator.next().done).toBe(true);
  });

  it("registers async workspace request handlers", () => {
    const iterator = watchWorkspaceRequestSaga();

    const effects = Array.from({ length: 5 }, () => iterator.next().value as any);
    expect(effects.map((effect) => effect.type)).toEqual(Array(5).fill("FORK"));
    expect(effects[0].payload.args).toEqual([createWorkspaceRequested, handleCreateWorkspace]);
    expect(effects[1].payload.args).toEqual([openWorkspaceRequested, handleOpenWorkspace]);
    expect(effects[2].payload.args).toEqual([updateWorkspaceRequested, handleUpdateWorkspace]);
    expect(effects[3].payload.args).toEqual([duplicateWorkspaceRequested, handleDuplicateWorkspace]);
    expect(effects[4].payload.args).toEqual([deleteWorkspaceRequested, handleDeleteWorkspace]);
    expect(iterator.next().done).toBe(true);
  });

  it("loads workspaces with loading and success state updates", () => {
    const workspaces = [{ id: "ws-1", title: "One" }];

    testSaga(performLoadWorkspaces, 0)
      .next()
      .put(setWorkspaceLoading(true))
      .next()
      .put(setWorkspaceError(null))
      .next()
      .call([workspaceClient, workspaceClient.list], { lite: true })
      .next({ ok: true, data: workspaces })
      .put(replaceWorkspaceList(workspaces as any))
      .next()
      .put(setWorkspaceHasLoaded(true))
      .next()
      .put(setWorkspaceError(null))
      .next()
      .cancelled()
      .next(false)
      .put(setWorkspaceLoading(false))
      .next()
      .isDone();
  });

  it("skips initial loads while a create is in flight", () => {
    const iterator = handleLoadWorkspaces(loadWorkspacesRequested());

    expect((iterator.next().value as any).type).toBe("SELECT");
    expect(iterator.next(true).done).toBe(true);
  });

  it("creates a workspace and schedules a list refresh", () => {
    const request = {
      title: "New Workspace",
      scope: "path",
      environmentConfig: { type: "remote" },
      initialAgent: { metadata: { workMode: "team" } },
    } as any;
    const workspace = { id: "ws-1", title: "New Workspace" };

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
    expect(iterator.next().value).toEqual(sagaEffects.put(setActiveWorkspaceId("ws-1")));
    const createTrackEffect = iterator.next().value as any;
    expect(createTrackEffect.type).toBe("CALL");
    createTrackEffect.payload.fn();
    expect(mockTrack).toHaveBeenCalledWith("Created Workspace", {
      workspace_id: "ws-1",
      workspace_title: "New Workspace",
      is_remote: true,
      from_template: false,
      has_initial_prompt: false,
      work_mode: "team",
    });
    expect(iterator.next().value).toEqual(sagaEffects.put(setWorkspaceLoading(false)));
    expect(iterator.next().value).toEqual(sagaEffects.put(setWorkspaceCreating(false)));
    expect((iterator.next().value as any).type).toBe("FORK");
    expect(iterator.next().done).toBe(true);
  });

  it("duplicates a workspace and schedules a list refresh", () => {
    const workspace = { id: "ws-dup", title: "Copy of Workspace" };
    const iterator = handleDuplicateWorkspace(
      duplicateWorkspaceRequested("ws-1", "Copy of Workspace"),
    );

    expect(iterator.next().value).toEqual(sagaEffects.put(setWorkspaceCreating(true)));
    expect(iterator.next().value).toEqual(
      sagaEffects.call(
        [workspaceClient, workspaceClient.duplicate],
        WorkspaceId("ws-1"),
        "Copy of Workspace",
      ),
    );
    expect(iterator.next({ ok: true, data: workspace }).value).toEqual(
      sagaEffects.put(setPendingCreation(workspace as any)),
    );
    expect(iterator.next().value).toEqual(sagaEffects.put(setWorkspaceEntity(workspace as any)));
    // finally: setWorkspaceCreating(false) comes before the FORK
    expect(iterator.next().value).toEqual(sagaEffects.put(setWorkspaceCreating(false)));
    // scheduleWorkspaceRefresh is forked, not called
    expect((iterator.next().value as any).type).toBe("FORK");
    expect(iterator.next().done).toBe(true);
  });

  it("tracks rename analytics when a workspace title changes", () => {
    const iterator = handleUpdateWorkspace(
      updateWorkspaceRequested("ws-1", { title: "Renamed Workspace" }),
    );

    expect((iterator.next().value as any).type).toBe("SELECT");
    expect(iterator.next({ id: "ws-1", title: "Old Workspace" } as any).value).toEqual(
      sagaEffects.call([workspaceClient, workspaceClient.update], {
        id: WorkspaceId("ws-1"),
        title: "Renamed Workspace",
      }),
    );
    expect(iterator.next({ ok: true, data: { id: "ws-1", title: "Renamed Workspace" } }).value).toEqual(
      sagaEffects.put(setWorkspaceEntity({ id: "ws-1", title: "Renamed Workspace" } as any)),
    );
    const renameTrackEffect = iterator.next().value as any;
    expect(renameTrackEffect.type).toBe("CALL");
    renameTrackEffect.payload.fn();
    expect(mockTrack).toHaveBeenCalledWith("Renamed Workspace", { workspace_id: "ws-1" });
    expect(iterator.next().done).toBe(true);
  });

  it("deletes a workspace, runs cleanup, and tracks analytics", () => {
    const iterator = handleDeleteWorkspace(deleteWorkspaceRequested("ws-1"));

    expect((iterator.next().value as any).type).toBe("SELECT");
    expect(iterator.next({ id: "ws-1", title: "Delete Me" } as any).value).toEqual(
      sagaEffects.put(markWorkspacePendingDeletion("ws-1")),
    );
    expect(iterator.next().value).toEqual(
      sagaEffects.call([workspaceClient, workspaceClient.delete], WorkspaceId("ws-1")),
    );
    expect(iterator.next({ ok: true }).value).toEqual(
      sagaEffects.put({ type: "prStatus/cleanupWorkspace", payload: ["ws-1"] }),
    );
    expect(iterator.next().value).toEqual(sagaEffects.call(mockInvalidateAgentCache, "ws-1"));
    expect(iterator.next().value).toEqual(sagaEffects.put(removeWorkspaceAgentState("ws-1")));
    expect(iterator.next().value).toEqual(sagaEffects.put(workspaceUnmounted("ws-1")));
    expect(iterator.next().value).toEqual(sagaEffects.put(clearWorkspaceTransientUi("ws-1")));
    expect(iterator.next().value).toEqual(
      sagaEffects.call([{ clearState: mockWorkspaceStorageClearState }, mockWorkspaceStorageClearState], "ws-1"),
    );
    expect(iterator.next().value).toEqual(sagaEffects.put(removeWorkspaceEntity("ws-1")));
    expect(iterator.next().value).toEqual(sagaEffects.put(clearPendingCreation("ws-1")));
    const deleteTrackEffect = iterator.next().value as any;
    expect(deleteTrackEffect.type).toBe("CALL");
    deleteTrackEffect.payload.fn();
    expect(mockTrack).toHaveBeenCalledWith("Deleted Workspace", {
      workspace_id: "ws-1",
      workspace_title: "Delete Me",
    });
    expect(iterator.next().value).toEqual(
      sagaEffects.put(clearWorkspacePendingDeletion("ws-1")),
    );
    expect(iterator.next().done).toBe(true);
  });
});

describe("workspace recency sagas", () => {
  it("loads persisted recency data on saga init", () => {
    const recency = { lastViewedAt: { "ws-1": 123 } };

    testSaga(initializeWorkspaceRecencySaga)
      .next()
      .call(getLocalStorageJSON, WORKSPACE_RECENCY_STORAGE_KEY)
      .next(recency)
      .put(loadRecencyData(recency))
      .next()
      .isDone();
  });

  it("skips recency hydration when nothing is stored", () => {
    testSaga(initializeWorkspaceRecencySaga)
      .next()
      .call(getLocalStorageJSON, WORKSPACE_RECENCY_STORAGE_KEY)
      .next(undefined)
      .isDone();
  });

  it("persists the current recency snapshot", () => {
    const recency = { lastViewedAt: { "ws-1": 123, "ws-2": 456 } };

    testSaga(persistWorkspaceRecency)
      .next()
      .select(selectWorkspaceRecency.select)
      .next(recency)
      .call(setLocalStorageJSON, WORKSPACE_RECENCY_STORAGE_KEY, recency)
      .next()
      .isDone();
  });

  it("watches view + cleanup actions for recency persistence", () => {
    const iterator = watchWorkspaceRecencyPersistenceSaga();
    const effect = iterator.next().value as any;

    expect(effect.type).toBe("FORK");
    expect(effect.payload.args).toEqual([
      [recordWorkspaceView, cleanupRecency],
      persistWorkspaceRecency,
    ]);
    expect(iterator.next().done).toBe(true);
  });
});