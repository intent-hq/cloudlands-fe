import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { testSaga } from "redux-saga-test-plan";
import * as sagaEffects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor, ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  delay: function* (ms: number) {
    return yield sagaEffects.delay(ms);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  race: function* (effects: any) {
    return yield sagaEffects.race(effects);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  spawn: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.spawn(fn, ...args);
  },
  take: function* (patternOrChannel: any) {
    return yield sagaEffects.take(patternOrChannel);
  },
  takeLatest: function* (pattern: any, saga: any) {
    return yield sagaEffects.takeLatest(pattern, saga);
  },
}));

const {
  mockHasRunningAgents,
  mockGetRunningAgentNames,
  mockNavigateAfterWorkspaceRemoval,
  mockToast,
  mockWorkspaceClientDelete,
  mockWorkspaceClientArchive,
  mockWorkspaceClientUnarchive,
} = vi.hoisted(() => ({
  mockHasRunningAgents: vi.fn(() => false),
  mockGetRunningAgentNames: vi.fn(() => []),
  mockNavigateAfterWorkspaceRemoval: vi.fn(),
  mockToast: {
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    dismiss: vi.fn(),
  },
  mockWorkspaceClientDelete: vi.fn(),
  mockWorkspaceClientArchive: vi.fn().mockResolvedValue({ ok: true }),
  mockWorkspaceClientUnarchive: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("$lib/utils/delete-warning-utils", () => ({
  hasRunningAgents: mockHasRunningAgents,
  getRunningAgentNames: mockGetRunningAgentNames,
}));

vi.mock("$lib/utils/workspace-navigation", () => ({
  navigateAfterWorkspaceRemoval: mockNavigateAfterWorkspaceRemoval,
}));

vi.mock("svelte-sonner", () => ({
  toast: mockToast,
}));

vi.mock("$lib/electron-bridge", () => ({
  invoke: vi.fn(),
}));

vi.mock("$app/navigation", () => ({
  goto: vi.fn(),
}));

vi.mock("$lib/store/slices/workspace/utils/workspace.client", () => ({
  workspaceClient: {
    delete: mockWorkspaceClientDelete,
    archive: mockWorkspaceClientArchive,
    unarchive: mockWorkspaceClientUnarchive,
  },
}));

import type { Workspace } from "$shared/types";
import { WorkspaceStatusEnum } from "$shared/types";
import type { WorkspaceId } from "$shared/types/branded-ids";
import { navigateAfterWorkspaceRemoval } from "$lib/utils/workspace-navigation";
import { getItem } from "svelte-redux-toolkit/utils/collections/collection-utils";
import {
  clearWorkspacePendingDeletion,
  initialState as workspaceInitialState,
  loadWorkspacesRequested,
  markWorkspacePendingDeletion,
  removeWorkspaceEntity,
  replaceWorkspaceList,
  setWorkspaceEntity,
  workspaceReducer,
} from "$lib/store/slices/workspace/workspace-slice";
import {
  requestDeleteWorkspaceSaga,
  confirmDeleteWorkspaceSaga,
  requestArchiveWorkspaceSaga,
  workspaceOperationsSaga,
} from "./workspace-operations-saga";
import {
  requestDeleteWorkspace,
  requestArchiveWorkspace,
  openBulkArchiveConfirm,
  confirmBulkArchive,
  openDeleteWarning,
  closeDeleteWarning,
  workspaceOperationsReducer,
} from "../workspace-operations-slice";
import {
  applyMiddleware,
  combineReducers,
  createStore,
  type Store,
} from "redux";
import createSagaMiddleware from "redux-saga";

function makeWorkspace(id: string): Workspace {
  return {
    id: id as WorkspaceId,
    title: "Test Workspace",
    branch: "main",
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: "Active",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as Workspace;
}

describe("workspace-operations-saga navigate-away behavior", () => {
  const workspace = makeWorkspace("ws-123");

  beforeEach(() => {
    vi.clearAllMocks();
    mockHasRunningAgents.mockReturnValue(false);
    Object.defineProperty(window, "location", {
      value: { pathname: "/" },
      writable: true,
      configurable: true,
    });
  });

  describe("requestDeleteWorkspaceSaga", () => {
    it("calls navigateAfterWorkspaceRemoval when viewing the workspace", () => {
      Object.defineProperty(window, "location", {
        value: { pathname: `/workspace/${workspace.id}` },
        writable: true,
        configurable: true,
      });

      const action = requestDeleteWorkspace(workspace.id);
      const gen = requestDeleteWorkspaceSaga(action);

      // First yield: selectWorkspaceById.effect(workspace.id)
      const selectEffect = gen.next().value as any;
      expect(selectEffect.type).toBe("SELECT");

      // Provide the workspace as the select result → next yield: navigateAfterWorkspaceRemoval
      const navEffect = gen.next(workspace).value as any;
      expect(navEffect.type).toBe("CALL");
      expect(navEffect.payload.fn).toBe(navigateAfterWorkspaceRemoval);
      expect(navEffect.payload.args).toEqual([workspace.id]);

      // Next yield: spawn(deleteWorkspaceWithUndo, workspace)
      const deleteEffect = gen.next().value as any;
      expect(deleteEffect.type).toBe("FORK");
      expect(deleteEffect.payload.detached).toBe(true);
      expect(deleteEffect.payload.args).toEqual([workspace]);

      // Done
      expect(gen.next().done).toBe(true);
    });

    it("does NOT call navigateAfterWorkspaceRemoval when not viewing the workspace", () => {
      Object.defineProperty(window, "location", {
        value: { pathname: "/workspace/other-id" },
        writable: true,
        configurable: true,
      });

      const action = requestDeleteWorkspace(workspace.id);
      const gen = requestDeleteWorkspaceSaga(action);

      // First yield: selectWorkspaceById.effect(workspace.id)
      const selectEffect = gen.next().value as any;
      expect(selectEffect.type).toBe("SELECT");

      // Provide the workspace — path doesn't match, so skip navigation → spawn deleteWorkspaceWithUndo
      const deleteEffect = gen.next(workspace).value as any;
      expect(deleteEffect.type).toBe("FORK");
      expect(deleteEffect.payload.detached).toBe(true);
      expect(deleteEffect.payload.args).toEqual([workspace]);
      // Should NOT be navigateAfterWorkspaceRemoval
      expect(deleteEffect.payload.fn).not.toBe(navigateAfterWorkspaceRemoval);

      // Done
      expect(gen.next().done).toBe(true);
    });

    it("calls navigateAfterWorkspaceRemoval when viewing a sub-route of the workspace", () => {
      Object.defineProperty(window, "location", {
        value: { pathname: `/workspace/${workspace.id}/files` },
        writable: true,
        configurable: true,
      });

      const action = requestDeleteWorkspace(workspace.id);
      const gen = requestDeleteWorkspaceSaga(action);

      // First yield: selectWorkspaceById.effect(workspace.id)
      const selectEffect = gen.next().value as any;
      expect(selectEffect.type).toBe("SELECT");

      // Provide the workspace → navigate
      const navEffect = gen.next(workspace).value as any;
      expect(navEffect.type).toBe("CALL");
      expect(navEffect.payload.fn).toBe(navigateAfterWorkspaceRemoval);
      expect(navEffect.payload.args).toEqual([workspace.id]);

      // Next yield: spawn(deleteWorkspaceWithUndo, workspace)
      const deleteEffect = gen.next().value as any;
      expect(deleteEffect.type).toBe("FORK");
      expect(deleteEffect.payload.detached).toBe(true);
      expect(deleteEffect.payload.args).toEqual([workspace]);

      // Done
      expect(gen.next().done).toBe(true);
    });

    it("does NOT call navigateAfterWorkspaceRemoval for a workspace whose ID is a prefix of the current path", () => {
      Object.defineProperty(window, "location", {
        value: { pathname: `/workspace/${workspace.id}-other` },
        writable: true,
        configurable: true,
      });

      const action = requestDeleteWorkspace(workspace.id);
      const gen = requestDeleteWorkspaceSaga(action);

      // First yield: selectWorkspaceById.effect(workspace.id)
      const selectEffect = gen.next().value as any;
      expect(selectEffect.type).toBe("SELECT");

      // Provide workspace → path doesn't match, so skip navigation → spawn deleteWorkspaceWithUndo
      const deleteEffect = gen.next(workspace).value as any;
      expect(deleteEffect.type).toBe("FORK");
      expect(deleteEffect.payload.detached).toBe(true);
      expect(deleteEffect.payload.args).toEqual([workspace]);
      // Should NOT be navigateAfterWorkspaceRemoval
      expect(deleteEffect.payload.fn).not.toBe(navigateAfterWorkspaceRemoval);

      // Done
      expect(gen.next().done).toBe(true);
    });

    it("opens delete warning when workspace has running agents (no navigation)", () => {
      mockHasRunningAgents.mockReturnValue(true);
      mockGetRunningAgentNames.mockReturnValue(["Agent 1"]);
      Object.defineProperty(window, "location", {
        value: { pathname: `/workspace/${workspace.id}` },
        writable: true,
        configurable: true,
      });

      const action = requestDeleteWorkspace(workspace.id);

      testSaga(requestDeleteWorkspaceSaga, action)
        .next()
        .put(openDeleteWarning({ workspaceId: workspace.id, agentNames: ["Agent 1"] }))
        .next()
        .isDone();
    });
  });

  describe("confirmDeleteWorkspaceSaga", () => {
    it("calls navigateAfterWorkspaceRemoval when viewing the workspace", () => {
      Object.defineProperty(window, "location", {
        value: { pathname: `/workspace/${workspace.id}` },
        writable: true,
        configurable: true,
      });

      const gen = confirmDeleteWorkspaceSaga();

      // First yield: selectPendingDeleteWorkspaceId.effect()
      const selectIdEffect = gen.next().value as any;
      expect(selectIdEffect.type).toBe("SELECT");

      // Second yield: put(closeDeleteWarning()) — provide workspaceId from select
      const putEffect = gen.next(workspace.id).value as any;
      expect(putEffect.type).toBe("PUT");
      expect(putEffect.payload.action.type).toBe(closeDeleteWarning.type);

      // Third yield: selectWorkspaceById.effect(workspaceId) — look up full workspace
      const selectWsEffect = gen.next().value as any;
      expect(selectWsEffect.type).toBe("SELECT");

      // Fourth yield: call(navigateAfterWorkspaceRemoval, workspace.id)
      const navEffect = gen.next(workspace).value as any;
      expect(navEffect.type).toBe("CALL");
      expect(navEffect.payload.fn).toBe(navigateAfterWorkspaceRemoval);
      expect(navEffect.payload.args).toEqual([workspace.id]);

      // Fifth yield: spawn(deleteWorkspaceWithUndo, workspace)
      const deleteEffect = gen.next().value as any;
      expect(deleteEffect.type).toBe("FORK");
      expect(deleteEffect.payload.detached).toBe(true);
      expect(deleteEffect.payload.args).toEqual([workspace]);

      // Done
      expect(gen.next().done).toBe(true);
    });
  });

  describe("requestArchiveWorkspaceSaga", () => {
    it("calls navigateAfterWorkspaceRemoval when viewing the workspace", () => {
      Object.defineProperty(window, "location", {
        value: { pathname: `/workspace/${workspace.id}` },
        writable: true,
        configurable: true,
      });

      const action = requestArchiveWorkspace(workspace.id);
      const gen = requestArchiveWorkspaceSaga(action);

      // First yield: call(getToast)
      const toastEffect = gen.next().value as any;
      expect(toastEffect.type).toBe("CALL");

      // Second yield: select(selectWorkspaceById, workspaceId)
      const selectEffect = gen.next(mockToast).value as any;
      expect(selectEffect.type).toBe("SELECT");

      // Third yield: call(navigateAfterWorkspaceRemoval, workspace.id)
      const navEffect = gen.next(workspace).value as any;
      expect(navEffect.type).toBe("CALL");
      expect(navEffect.payload.fn).toBe(navigateAfterWorkspaceRemoval);
      expect(navEffect.payload.args).toEqual([workspace.id]);

      // Fourth yield: call([workspaceClient, workspaceClient.archive], workspace.id)
      const archiveEffect = gen.next().value as any;
      expect(archiveEffect.type).toBe("CALL");
    });

    it("does NOT call navigateAfterWorkspaceRemoval when not viewing the workspace", () => {
      Object.defineProperty(window, "location", {
        value: { pathname: "/workspace/other-id" },
        writable: true,
        configurable: true,
      });

      const action = requestArchiveWorkspace(workspace.id);
      const gen = requestArchiveWorkspaceSaga(action);

      // First yield: call(getToast)
      const toastEffect = gen.next().value as any;
      expect(toastEffect.type).toBe("CALL");

      // Second yield: select(selectWorkspaceById, workspaceId)
      const selectEffect = gen.next(mockToast).value as any;
      expect(selectEffect.type).toBe("SELECT");

      // Third yield: call([workspaceClient, workspaceClient.archive], ...) — no navigation
      const archiveEffect = gen.next(workspace).value as any;
      expect(archiveEffect.type).toBe("CALL");
      // Should NOT be navigateAfterWorkspaceRemoval
      expect(archiveEffect.payload.fn).not.toBe(navigateAfterWorkspaceRemoval);
    });
  });
});

function makeReducerWorkspace(id: string, title = "Test Workspace"): Workspace {
  return {
    id: id as WorkspaceId,
    title,
    branch: "main",
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatusEnum.Active,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as Workspace;
}

/**
 * Reducer-level tests that encode the invariants dispatched by
 * `deleteWorkspaceWithUndo` in each of its terminal branches
 * (undo, success, failure). The saga itself is an async function that uses
 * `setTimeout` and `svelte-sonner`, so we verify the outcome by driving the
 * same action sequence through the real reducer.
 */
describe("deleteWorkspaceWithUndo — multi-delete race invariants", () => {
  const w1 = makeReducerWorkspace("ws-1", "One");
  const w2 = makeReducerWorkspace("ws-2", "Two");

  it("two concurrent deletes: background list refresh does not re-insert either pending-deletion workspace", () => {
    // Both workspaces exist.
    let state = workspaceReducer(workspaceInitialState, setWorkspaceEntity(w1));
    state = workspaceReducer(state, setWorkspaceEntity(w2));

    // User triggers delete for W1: optimistic remove + mark pending.
    state = workspaceReducer(state, removeWorkspaceEntity(w1.id));
    state = workspaceReducer(state, markWorkspacePendingDeletion(w1.id));

    // User triggers delete for W2 while W1's undo window is still open.
    state = workspaceReducer(state, removeWorkspaceEntity(w2.id));
    state = workspaceReducer(state, markWorkspacePendingDeletion(w2.id));

    expect(state.pendingDeletions[w1.id]).toBe(true);
    expect(state.pendingDeletions[w2.id]).toBe(true);

    // W1's timer fires: backend delete succeeds, clear pending, reload list.
    // Backend still reports W2 (still on disk while its undo window runs).
    state = workspaceReducer(state, clearWorkspacePendingDeletion(w1.id));
    state = workspaceReducer(state, replaceWorkspaceList([w2]));

    // Invariant: W2 must NOT re-appear in the visible workspaces collection,
    // because its pendingDeletions flag is still set.
    expect(getItem(state.workspaces, w2.id)).toBeUndefined();
    expect(getItem(state.workspaces, w1.id)).toBeUndefined();
    expect(state.pendingDeletions[w1.id]).toBeUndefined();
    expect(state.pendingDeletions[w2.id]).toBe(true);

    // W2's timer then fires: backend delete succeeds, clear pending.
    state = workspaceReducer(state, clearWorkspacePendingDeletion(w2.id));
    expect(state.pendingDeletions[w2.id]).toBeUndefined();
    expect(state.pendingDeletions).toEqual({});
  });

  it("undo path: clearWorkspacePendingDeletion + setWorkspaceEntity restores the workspace to the visible list", () => {
    let state = workspaceReducer(workspaceInitialState, setWorkspaceEntity(w1));

    // Optimistic delete dispatches from `deleteWorkspaceWithUndo`.
    state = workspaceReducer(state, removeWorkspaceEntity(w1.id));
    state = workspaceReducer(state, markWorkspacePendingDeletion(w1.id));

    expect(getItem(state.workspaces, w1.id)).toBeUndefined();
    expect(state.pendingDeletions[w1.id]).toBe(true);

    // User clicks Undo: clear pending first, then re-insert entity.
    state = workspaceReducer(state, clearWorkspacePendingDeletion(w1.id));
    state = workspaceReducer(state, setWorkspaceEntity(w1));

    expect(state.pendingDeletions[w1.id]).toBeUndefined();
    expect(getItem(state.workspaces, w1.id)?.id).toBe(w1.id);
  });

  it("failure path: clear pending + setWorkspaceEntity restores the workspace even if a subsequent list refresh omits it", () => {
    let state = workspaceReducer(workspaceInitialState, setWorkspaceEntity(w1));
    state = workspaceReducer(state, removeWorkspaceEntity(w1.id));
    state = workspaceReducer(state, markWorkspacePendingDeletion(w1.id));

    // Timer fires; backend delete fails. Clear pending, restore entity, reload.
    state = workspaceReducer(state, clearWorkspacePendingDeletion(w1.id));
    state = workspaceReducer(state, setWorkspaceEntity(w1));

    // Simulate the loadWorkspacesRequested round-trip returning [w1].
    state = workspaceReducer(state, replaceWorkspaceList([w1]));

    expect(state.pendingDeletions[w1.id]).toBeUndefined();
    expect(getItem(state.workspaces, w1.id)?.id).toBe(w1.id);
  });
});

/**
 * Saga-level tests that drive `deleteWorkspaceWithUndo` through the real
 * `requestDeleteWorkspaceSaga` against a real Redux store with fake timers.
 * Unlike the reducer-level tests above, these exercise the saga's own
 * `markWorkspacePendingDeletion` / `clearWorkspacePendingDeletion` dispatches
 * and the 15s undo timing branch, so they fail if either dispatch is dropped.
 */
describe("deleteWorkspaceWithUndo — saga-level invariants", () => {
  const TOAST_ID = "toast-abc";
  const workspace = makeReducerWorkspace("ws-saga-1", "Saga One");

  let store: Store;
  let capturedUndoCallback: (() => Promise<void> | void) | undefined;
  let dispatchedActions: any[];

  // Pre-warm the dynamic `import("svelte-sonner")` that `deleteWorkspaceWithUndo`
  // performs internally. The first resolution of that import requires more
  // microtask rounds than a simple `await Promise.resolve()` can reliably drain
  // under fake timers, which produces flaky results on whichever test runs first.
  // Resolving it once up front makes subsequent imports module-cached.
  beforeAll(async () => {
    await import("svelte-sonner");
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockHasRunningAgents.mockReturnValue(false);
    mockWorkspaceClientArchive.mockResolvedValue({ ok: true });
    mockWorkspaceClientUnarchive.mockResolvedValue({ ok: true });
    capturedUndoCallback = undefined;
    dispatchedActions = [];

    mockToast.warning.mockImplementation((_message: string, opts?: any) => {
      if (opts?.action?.onClick) {
        capturedUndoCallback = opts.action.onClick as () => Promise<void> | void;
      }
      return TOAST_ID;
    });

    Object.defineProperty(window, "location", {
      value: { pathname: "/" },
      writable: true,
      configurable: true,
    });

    const sagaMiddleware = createSagaMiddleware();
    const rootReducer = combineReducers({
      workspace: workspaceReducer,
      workspaceOperations: workspaceOperationsReducer,
    });
    const captureMiddleware = () => (next: any) => (action: any) => {
      dispatchedActions.push(action);
      return next(action);
    };
    store = createStore(rootReducer, applyMiddleware(captureMiddleware, sagaMiddleware));
    store.dispatch(setWorkspaceEntity(workspace));
    sagaMiddleware.run(workspaceOperationsSaga);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const workspaceState = () => (store.getState() as any).workspace;

  const countDispatched = (type: string) =>
    dispatchedActions.filter((action) => action.type === type).length;

  const waitForWarningToast = async () => {
    for (let i = 0; i < 50; i++) {
      if (mockToast.warning.mock.calls.length > 0) return;
      await Promise.resolve();
    }
    // Final safety net: advance timers by 0 to flush any pending timer-queued work.
    await vi.advanceTimersByTimeAsync(0);
  };

  it("success: after 15s workspaceClient.delete resolves ok; pendingDeletions empty, workspace stays removed", async () => {
    mockWorkspaceClientDelete.mockResolvedValue({ ok: true });

    store.dispatch(requestDeleteWorkspace(workspace.id));

    await waitForWarningToast();

    // Invariant: immediately after the optimistic delete, the workspace is
    // removed from the visible collection and pendingDeletions is flagged.
    expect(workspaceState().pendingDeletions[workspace.id]).toBe(true);
    expect(getItem(workspaceState().workspaces, workspace.id)).toBeUndefined();
    expect(mockWorkspaceClientDelete).not.toHaveBeenCalled();
    expect(mockToast.warning).toHaveBeenCalledTimes(1);

    // Advance to the 15s mark; the async timeout callback should call delete.
    await vi.advanceTimersByTimeAsync(15000);

    expect(mockWorkspaceClientDelete).toHaveBeenCalledWith(workspace.id);
    expect(workspaceState().pendingDeletions).toEqual({});
    expect(getItem(workspaceState().workspaces, workspace.id)).toBeUndefined();
    expect(countDispatched(loadWorkspacesRequested.type)).toBeGreaterThanOrEqual(1);
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it("failure: workspaceClient.delete resolves !ok; workspace is restored, pendingDeletions empty, toast.error called", async () => {
    mockWorkspaceClientDelete.mockResolvedValue({ ok: false, error: "boom" });

    store.dispatch(requestDeleteWorkspace(workspace.id));
    await waitForWarningToast();

    // Same immediate invariant as success case.
    expect(workspaceState().pendingDeletions[workspace.id]).toBe(true);
    expect(getItem(workspaceState().workspaces, workspace.id)).toBeUndefined();

    await vi.advanceTimersByTimeAsync(15000);

    expect(mockWorkspaceClientDelete).toHaveBeenCalledWith(workspace.id);
    expect(workspaceState().pendingDeletions).toEqual({});
    expect(getItem(workspaceState().workspaces, workspace.id)?.id).toBe(workspace.id);
    expect(countDispatched(loadWorkspacesRequested.type)).toBeGreaterThanOrEqual(1);
    expect(mockToast.error).toHaveBeenCalledWith("Failed to delete space");
  });

  it("undo: invoking the captured onClick before 15s restores workspace, clears pending, skips delete, dismisses toast", async () => {
    mockWorkspaceClientDelete.mockResolvedValue({ ok: true });

    store.dispatch(requestDeleteWorkspace(workspace.id));
    await waitForWarningToast();

    expect(workspaceState().pendingDeletions[workspace.id]).toBe(true);
    expect(getItem(workspaceState().workspaces, workspace.id)).toBeUndefined();
    expect(capturedUndoCallback).toBeDefined();

    // User clicks "Undo" before the 15s timer fires.
    await capturedUndoCallback!();

    expect(workspaceState().pendingDeletions).toEqual({});
    expect(getItem(workspaceState().workspaces, workspace.id)?.id).toBe(workspace.id);
    expect(mockToast.dismiss).toHaveBeenCalledWith(TOAST_ID);

    // Advancing past the original 15s window must not trigger a delete,
    // since the undo channel won the timing race.
    await vi.advanceTimersByTimeAsync(15000);
    expect(mockWorkspaceClientDelete).not.toHaveBeenCalled();
  });

  it("archive undo: clicking the toast undo unarchives through the saga channel and reloads workspaces", async () => {
    store.dispatch(requestArchiveWorkspace(workspace.id));
    await waitForWarningToast();

    expect(mockWorkspaceClientArchive).toHaveBeenCalledWith(workspace.id);
    expect(capturedUndoCallback).toBeDefined();
    const loadCountAfterArchive = countDispatched(loadWorkspacesRequested.type);
    expect(loadCountAfterArchive).toBeGreaterThanOrEqual(1);

    await capturedUndoCallback!();
    for (let i = 0; i < 10 && countDispatched(loadWorkspacesRequested.type) <= loadCountAfterArchive; i++) {
      await Promise.resolve();
    }

    expect(mockWorkspaceClientUnarchive).toHaveBeenCalledWith(workspace.id);
    expect(countDispatched(loadWorkspacesRequested.type)).toBeGreaterThan(loadCountAfterArchive);
  });

  it("bulk archive undo: clicking the toast undo unarchives archived ids through the saga channel and reloads", async () => {
    store.dispatch(openBulkArchiveConfirm("unknown"));
    store.dispatch(confirmBulkArchive());
    await waitForWarningToast();

    expect(mockWorkspaceClientArchive).toHaveBeenCalledWith(workspace.id);
    expect(capturedUndoCallback).toBeDefined();
    const loadCountAfterArchive = countDispatched(loadWorkspacesRequested.type);
    expect(loadCountAfterArchive).toBeGreaterThanOrEqual(1);

    await capturedUndoCallback!();
    for (let i = 0; i < 10 && countDispatched(loadWorkspacesRequested.type) <= loadCountAfterArchive; i++) {
      await Promise.resolve();
    }

    expect(mockWorkspaceClientUnarchive).toHaveBeenCalledWith(workspace.id);
    expect(countDispatched(loadWorkspacesRequested.type)).toBeGreaterThan(loadCountAfterArchive);
  });
});
