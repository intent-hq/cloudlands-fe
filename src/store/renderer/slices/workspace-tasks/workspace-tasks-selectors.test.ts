import { describe, expect, it } from "vitest";
import type { StoreState } from "../../types";
import type { WorkspaceTask, WorkspaceTaskStats } from "$shared/types";
import { createCollection } from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";
import {
  selectWorkspaceTaskDisplayList,
  selectWorkspaceTaskProgress,
  selectWorkspaceTasks,
  selectWorkspaceTasksError,
  selectWorkspaceTasksInitialized,
  selectWorkspaceTasksLoading,
  selectWorkspaceTasksState,
} from "./workspace-tasks-selectors";
import { emptyWorkspaceTaskStats } from "./workspace-tasks-slice";

const WS = "ws-1";

function makeTask(id: string, status: WorkspaceTask["status"]): WorkspaceTask {
  return { id, title: `Task ${id}`, status };
}

function stateWith(
  tasks: WorkspaceTask[],
  overrides: Partial<{
    loading: boolean;
    error: string | null;
    initialized: boolean;
    stats: WorkspaceTaskStats;
  }> = {}
): StoreState {
  const { stats, ...rest } = overrides;
  return {
    workspaceTasks: {
      byWorkspaceId: {
        [WS]: {
          tasks: createCollection<WorkspaceTask, "id">("id", tasks),
          stats: stats ?? emptyWorkspaceTaskStats,
          loading: false,
          error: null,
          initialized: true,
          ...rest,
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
    it("returns the BE-provided WorkspaceTaskStats verbatim (no client re-derivation)", () => {
      const stats: WorkspaceTaskStats = { total: 4, completed: 1, inProgress: 2 };
      // Seed `tasks` that DIVERGE from `stats` to prove the selector never recomputes
      // (the FE renders whatever the daemon emits per PROTOCOL §5.4).
      const state = stateWith(
        [
          makeTask("t1", "not_started"),
          makeTask("t2", "not_started"),
          makeTask("t3", "not_started"),
        ],
        { stats },
      );

      expect(selectWorkspaceTaskProgress.select(state, WS)).toBe(stats);
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

