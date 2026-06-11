import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { testSaga } from "redux-saga-test-plan";
import * as sagaEffects from "redux-saga/effects";
import type { WorkspaceTask } from "$shared/types";

// Must mock typed-redux-saga BEFORE importing saga modules
vi.mock("typed-redux-saga", () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
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

const { takeEveryFromElectronChannelMock, takeEveryFromListenSyncMock, mockGetTasks } = vi.hoisted(
  () => ({
    takeEveryFromElectronChannelMock: vi.fn(function* () {}),
    takeEveryFromListenSyncMock: vi.fn(function* () {}),
    mockGetTasks: vi.fn(),
  })
);

vi.mock("$store/renderer/utils/ipc-channel", () => ({
  takeEveryFromElectronChannel: takeEveryFromElectronChannelMock,
  takeEveryFromListenSync: takeEveryFromListenSyncMock,
}));

vi.mock("$store/renderer/slices/workspace/utils/workspace.client", () => ({
  workspaceClient: { getTasks: mockGetTasks },
}));

import { workspaceClient } from "$store/renderer/slices/workspace/utils/workspace.client";
import { WorkspaceId } from "$shared/types/branded-ids";
import { workspaceMounted } from "../../workspace-lifecycle/workspace-lifecycle-slice";
import {
  applyTaskStatusChanged,
  ensureWorkspaceTasksLoaded,
  loadWorkspaceTasksFailed,
  loadWorkspaceTasksRequested,
  loadWorkspaceTasksSucceeded,
} from "../workspace-tasks-slice";
import {
  handleEnsureWorkspaceTasksLoaded,
  handleLoadWorkspaceTasksRequested,
  handleWorkspaceMounted,
  watchEnsureWorkspaceTasksLoadedSaga,
  watchLoadWorkspaceTasksRequestedSaga,
  watchTaskStatusChangedSaga,
  watchWorkspaceMountedSaga,
  watchWorkspaceTasksChangedSaga,
  workspaceTasksSaga,
} from "./workspace-tasks-saga";

function makeTask(id: string, status: WorkspaceTask["status"] = "not_started"): WorkspaceTask {
  return { id, title: `Task ${id}`, status };
}

function getElectronHandler(eventName: string) {
  const call = takeEveryFromElectronChannelMock.mock.calls.find(([name]: any) => name === eventName);
  expect(call).toBeDefined();
  return call![1] as (data: any) => Generator;
}

function getListenSyncHandler(eventName: string) {
  const call = takeEveryFromListenSyncMock.mock.calls.find(([name]: any) => name === eventName);
  expect(call).toBeDefined();
  return call![1] as (data: any) => Generator;
}

describe("workspace-tasks-saga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forks all workspace tasks watchers", () => {
    testSaga(workspaceTasksSaga)
      .next()
      .fork(watchLoadWorkspaceTasksRequestedSaga)
      .next()
      .fork(watchEnsureWorkspaceTasksLoadedSaga)
      .next()
      .fork(watchWorkspaceMountedSaga)
      .next()
      .fork(watchWorkspaceTasksChangedSaga)
      .next()
      .fork(watchTaskStatusChangedSaga)
      .next()
      .isDone();
  });

  describe("handleEnsureWorkspaceTasksLoaded", () => {
    it("requests tasks when neither initialized nor loading", () => {
      const iterator = handleEnsureWorkspaceTasksLoaded(ensureWorkspaceTasksLoaded("ws-1"));

      expect((iterator.next().value as any).type).toBe("SELECT");
      expect((iterator.next(false).value as any).type).toBe("SELECT");

      const putEffect = iterator.next(false).value as any;
      expect(putEffect.type).toBe("PUT");
      expect(putEffect.payload.action).toEqual(loadWorkspaceTasksRequested("ws-1"));
      expect(iterator.next().done).toBe(true);
    });

    it("is a no-op when the workspace is already initialized", () => {
      const iterator = handleEnsureWorkspaceTasksLoaded(ensureWorkspaceTasksLoaded("ws-1"));

      expect((iterator.next().value as any).type).toBe("SELECT");
      expect((iterator.next(true).value as any).type).toBe("SELECT");
      expect(iterator.next(false)).toEqual({ value: undefined, done: true });
    });

    it("is a no-op when a load is already in flight", () => {
      const iterator = handleEnsureWorkspaceTasksLoaded(ensureWorkspaceTasksLoaded("ws-1"));

      expect((iterator.next().value as any).type).toBe("SELECT");
      expect((iterator.next(false).value as any).type).toBe("SELECT");
      expect(iterator.next(true)).toEqual({ value: undefined, done: true });
    });

    it("is a no-op without a workspace ID", () => {
      const iterator = handleEnsureWorkspaceTasksLoaded(ensureWorkspaceTasksLoaded(""));

      expect(iterator.next().done).toBe(true);
    });
  });

  describe("handleLoadWorkspaceTasksRequested", () => {
    it("loads tasks and dispatches success", () => {
      const iterator = handleLoadWorkspaceTasksRequested(loadWorkspaceTasksRequested("ws-1"));
      const tasks = [makeTask("t1"), makeTask("t2", "complete")];

      const callEffect = iterator.next().value as any;
      expect(callEffect).toEqual(
        sagaEffects.call([workspaceClient, workspaceClient.getTasks], WorkspaceId("ws-1"))
      );

      expect(iterator.next({ ok: true, data: tasks })).toEqual({
        value: sagaEffects.put(loadWorkspaceTasksSucceeded("ws-1", tasks)),
        done: false,
      });
      expect(iterator.next().done).toBe(true);
    });

    it("dispatches failure when the endpoint returns an error", () => {
      const iterator = handleLoadWorkspaceTasksRequested(loadWorkspaceTasksRequested("ws-1"));

      iterator.next();
      expect(iterator.next({ ok: false, error: "nope" })).toEqual({
        value: sagaEffects.put(loadWorkspaceTasksFailed("ws-1", "nope")),
        done: false,
      });
    });

    it("dispatches failure when the call throws", () => {
      const iterator = handleLoadWorkspaceTasksRequested(loadWorkspaceTasksRequested("ws-1"));

      iterator.next();
      expect(iterator.throw(new Error("boom"))).toEqual({
        value: sagaEffects.put(loadWorkspaceTasksFailed("ws-1", "boom")),
        done: false,
      });
    });

    it("is a no-op without a workspace ID", () => {
      const iterator = handleLoadWorkspaceTasksRequested(loadWorkspaceTasksRequested(""));

      expect(iterator.next().done).toBe(true);
      expect(mockGetTasks).not.toHaveBeenCalled();
    });
  });

  describe("handleWorkspaceMounted", () => {
    it("requests tasks for the mounted workspace", () => {
      const iterator = handleWorkspaceMounted(workspaceMounted("ws-1"));

      expect(iterator.next()).toEqual({
        value: sagaEffects.put(loadWorkspaceTasksRequested("ws-1")),
        done: false,
      });
      expect(iterator.next().done).toBe(true);
    });
  });

  describe("watchWorkspaceTasksChangedSaga", () => {
    it("refreshes tasks for initialized workspaces", () => {
      watchWorkspaceTasksChangedSaga().next();

      const handler = getElectronHandler("workspace:tasks-changed");
      const iterator = handler({ workspaceId: "ws-1" });

      expect((iterator.next().value as any).type).toBe("SELECT");
      expect((iterator.next(true).value as any).type).toBe("SELECT");

      const putEffect = iterator.next(false).value as any;
      expect(putEffect.type).toBe("PUT");
      expect(putEffect.payload.action).toEqual(loadWorkspaceTasksRequested("ws-1"));
    });

    it("ignores workspaces whose task state is unused", () => {
      watchWorkspaceTasksChangedSaga().next();

      const handler = getElectronHandler("workspace:tasks-changed");
      const iterator = handler({ workspaceId: "ws-2" });

      expect((iterator.next().value as any).type).toBe("SELECT");
      expect((iterator.next(false).value as any).type).toBe("SELECT");
      expect(iterator.next(false)).toEqual({ value: undefined, done: true });
    });

    it("is a no-op without a workspace ID", () => {
      watchWorkspaceTasksChangedSaga().next();

      const handler = getElectronHandler("workspace:tasks-changed");
      expect(handler({}).next().done).toBe(true);
    });
  });

  describe("watchTaskStatusChangedSaga", () => {
    it("applies optimistic status changes from task:status-changed", () => {
      watchTaskStatusChangedSaga().next();

      const handler = getListenSyncHandler("task:status-changed");
      expect(
        handler({ workspaceId: "ws-1", noteId: "task-1", newStatus: "complete" }).next()
      ).toEqual({
        value: sagaEffects.put(applyTaskStatusChanged("ws-1", "task-1", "complete")),
        done: false,
      });
    });

    it("ignores events with an invalid status or missing fields", () => {
      watchTaskStatusChangedSaga().next();

      const handler = getListenSyncHandler("task:status-changed");
      expect(
        handler({ workspaceId: "ws-1", noteId: "task-1", newStatus: "bogus" }).next().done
      ).toBe(true);
      expect(handler({ noteId: "task-1", newStatus: "complete" }).next().done).toBe(true);
      expect(handler({ workspaceId: "ws-1", newStatus: "complete" }).next().done).toBe(true);
    });
  });
});

