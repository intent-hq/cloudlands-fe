import { describe, expect, it } from "vitest";
import type { WorkspaceTask, WorkspaceTaskStats } from "$shared/types";
import { getItem, getItems } from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";
import { removeWorkspaceEntity } from "../workspace/workspace-slice";
import {
  applyTaskStatusChanged,
  clearWorkspaceTasks,
  emptyWorkspaceTaskStats,
  initialState,
  loadWorkspaceTasksFailed,
  loadWorkspaceTasksRequested,
  loadWorkspaceTasksSucceeded,
  workspaceTasksReducer,
} from "./workspace-tasks-slice";

const WS = "ws-1";

function makeTask(id: string, status: WorkspaceTask["status"] = "not_started"): WorkspaceTask {
  return { id, title: `Task ${id}`, status };
}

const ZERO_STATS: WorkspaceTaskStats = emptyWorkspaceTaskStats;

function loadedState(tasks: WorkspaceTask[], stats: WorkspaceTaskStats = ZERO_STATS) {
  return workspaceTasksReducer(initialState, loadWorkspaceTasksSucceeded(WS, tasks, stats));
}

describe("workspaceTasksReducer", () => {
  it("starts with no workspace entries", () => {
    expect(initialState.byWorkspaceId).toEqual({});
  });

  describe("loadWorkspaceTasksRequested", () => {
    it("marks the workspace as loading and clears errors", () => {
      const failed = workspaceTasksReducer(initialState, loadWorkspaceTasksFailed(WS, "nope"));
      const state = workspaceTasksReducer(failed, loadWorkspaceTasksRequested(WS));

      expect(state.byWorkspaceId[WS]).toMatchObject({ loading: true, error: null });
    });

    it("is a no-op when a request is already in flight", () => {
      const loading = workspaceTasksReducer(initialState, loadWorkspaceTasksRequested(WS));
      const again = workspaceTasksReducer(loading, loadWorkspaceTasksRequested(WS));

      expect(again).toBe(loading);
    });
  });

  describe("loadWorkspaceTasksSucceeded", () => {
    it("stores tasks and marks the workspace initialized", () => {
      const state = loadedState([makeTask("t1"), makeTask("t2", "complete")]);
      const ws = state.byWorkspaceId[WS];

      expect(ws.loading).toBe(false);
      expect(ws.error).toBeNull();
      expect(ws.initialized).toBe(true);
      expect(getItems(ws.tasks).map((t) => t.id)).toEqual(["t1", "t2"]);
    });

    it("replaces previously loaded tasks", () => {
      const state = workspaceTasksReducer(
        loadedState([makeTask("t1"), makeTask("t2")]),
        loadWorkspaceTasksSucceeded(WS, [makeTask("t3")], ZERO_STATS)
      );

      expect(getItems(state.byWorkspaceId[WS].tasks).map((t) => t.id)).toEqual(["t3"]);
    });

    it("stores the BE-provided stats verbatim alongside the task list", () => {
      const stats: WorkspaceTaskStats = { total: 4, completed: 1, inProgress: 2 };
      const state = workspaceTasksReducer(
        initialState,
        loadWorkspaceTasksSucceeded(WS, [makeTask("t1")], stats),
      );

      expect(state.byWorkspaceId[WS].stats).toEqual(stats);
    });
  });

  describe("loadWorkspaceTasksFailed", () => {
    it("records the error and stops loading", () => {
      const loading = workspaceTasksReducer(initialState, loadWorkspaceTasksRequested(WS));
      const state = workspaceTasksReducer(loading, loadWorkspaceTasksFailed(WS, "boom"));

      expect(state.byWorkspaceId[WS]).toMatchObject({ loading: false, error: "boom" });
    });
  });

  describe("applyTaskStatusChanged", () => {
    it("updates the status of a known task", () => {
      const state = workspaceTasksReducer(
        loadedState([makeTask("t1", "not_started")]),
        applyTaskStatusChanged(WS, "t1", "in_progress")
      );

      expect(getItem(state.byWorkspaceId[WS].tasks, "t1")?.status).toBe("in_progress");
    });

    it("is a no-op when the workspace is not initialized", () => {
      const state = workspaceTasksReducer(
        initialState,
        applyTaskStatusChanged(WS, "t1", "complete")
      );

      expect(state).toBe(initialState);
    });

    it("is a no-op for an unknown task", () => {
      const loaded = loadedState([makeTask("t1")]);
      const state = workspaceTasksReducer(loaded, applyTaskStatusChanged(WS, "missing", "complete"));

      expect(state).toBe(loaded);
    });

    it("is a no-op when the status is unchanged", () => {
      const loaded = loadedState([makeTask("t1", "complete")]);
      const state = workspaceTasksReducer(loaded, applyTaskStatusChanged(WS, "t1", "complete"));

      expect(state).toBe(loaded);
    });
  });

  describe("cleanup", () => {
    it("clears workspace state on clearWorkspaceTasks", () => {
      const state = workspaceTasksReducer(loadedState([makeTask("t1")]), clearWorkspaceTasks(WS));

      expect(state.byWorkspaceId[WS]).toBeUndefined();
    });

    it("clears workspace state on workspaceUnmounted", () => {
      const state = workspaceTasksReducer(loadedState([makeTask("t1")]), workspaceUnmounted(WS));

      expect(state.byWorkspaceId[WS]).toBeUndefined();
    });

    it("clears workspace state on removeWorkspaceEntity", () => {
      const state = workspaceTasksReducer(
        loadedState([makeTask("t1")]),
        removeWorkspaceEntity(WS)
      );

      expect(state.byWorkspaceId[WS]).toBeUndefined();
    });
  });
});

