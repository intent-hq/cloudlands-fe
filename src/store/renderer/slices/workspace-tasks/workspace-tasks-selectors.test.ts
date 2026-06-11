import { describe, expect, it } from "vitest";
import type { StoreState } from "../../types";
import type { WorkspaceTask } from "$shared/types";
import { createCollection } from "ag-redux-toolkit/utils/collections/collection-utils";
import {
  selectWorkspaceTaskDisplayList,
  selectWorkspaceTaskProgress,
  selectWorkspaceTasks,
  selectWorkspaceTasksError,
  selectWorkspaceTasksInitialized,
  selectWorkspaceTasksLoading,
  selectWorkspaceTasksState,
} from "./workspace-tasks-selectors";

const WS = "ws-1";

function makeTask(id: string, status: WorkspaceTask["status"]): WorkspaceTask {
  return { id, title: `Task ${id}`, status };
}

function stateWith(
  tasks: WorkspaceTask[],
  overrides: Partial<{ loading: boolean; error: string | null; initialized: boolean }> = {}
): StoreState {
  return {
    workspaceTasks: {
      byWorkspaceId: {
        [WS]: {
          tasks: createCollection<WorkspaceTask, "id">("id", tasks),
          loading: false,
          error: null,
          initialized: true,
          ...overrides,
        },
      },
    },
  } as unknown as StoreState;
}

const emptyState = { workspaceTasks: { byWorkspaceId: {} } } as unknown as StoreState;

describe("workspace-tasks selectors", () => {
  it("falls back to empty state for unknown workspaces", () => {
    const ws = selectWorkspaceTasksState.select(emptyState, WS);

    expect(ws.initialized).toBe(false);
    expect(selectWorkspaceTasks.select(emptyState, WS)).toEqual([]);
    expect(selectWorkspaceTasksLoading.select(emptyState, WS)).toBe(false);
    expect(selectWorkspaceTasksError.select(emptyState, WS)).toBeNull();
    expect(selectWorkspaceTasksInitialized.select(emptyState, WS)).toBe(false);
  });

  it("exposes scalar loading/error/initialized state", () => {
    const state = stateWith([], { loading: true, error: "boom", initialized: false });

    expect(selectWorkspaceTasksLoading.select(state, WS)).toBe(true);
    expect(selectWorkspaceTasksError.select(state, WS)).toBe("boom");
    expect(selectWorkspaceTasksInitialized.select(state, WS)).toBe(false);
  });

  it("returns tasks in source order", () => {
    const state = stateWith([makeTask("t1", "complete"), makeTask("t2", "not_started")]);

    expect(selectWorkspaceTasks.select(state, WS).map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  describe("selectWorkspaceTaskProgress", () => {
    it("derives counts and excludes cancelled tasks", () => {
      const state = stateWith([
        makeTask("t1", "complete"),
        makeTask("t2", "in_progress"),
        makeTask("t3", "review_required"),
        makeTask("t4", "not_started"),
        makeTask("t5", "cancelled"),
      ]);

      expect(selectWorkspaceTaskProgress.select(state, WS)).toEqual({
        total: 4,
        completed: 1,
        inProgress: 2,
      });
    });

    it("returns zero counts for unknown workspaces", () => {
      expect(selectWorkspaceTaskProgress.select(emptyState, WS)).toEqual({
        total: 0,
        completed: 0,
        inProgress: 0,
      });
    });
  });

  describe("selectWorkspaceTaskDisplayList", () => {
    it("orders tasks in-progress, then pending, then complete and drops cancelled", () => {
      const state = stateWith([
        makeTask("done", "complete"),
        makeTask("pending", "not_started"),
        makeTask("active", "in_progress"),
        makeTask("review", "review_required"),
        makeTask("gone", "cancelled"),
        makeTask("waiting", "waiting"),
      ]);

      expect(selectWorkspaceTaskDisplayList.select(state, WS).map((t) => t.id)).toEqual([
        "active",
        "review",
        "pending",
        "waiting",
        "done",
      ]);
    });
  });
});

