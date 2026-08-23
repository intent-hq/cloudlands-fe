import { describe, expect, it } from "vitest";
import type { StoreState } from "../../types";
import type { WorkspaceTask, WorkspaceTaskStats } from "$shared/types";
import { createCollection } from "@augmentcode/themis/utils/collections/collection-utils";
import {
  selectFallbackPlanTasksForAgent,
  selectSpecLinkedTaskDisplayList,
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
  describe("selectSpecLinkedTaskDisplayList (fallback plan card, monorepo#3249)", () => {
    it("keeps spec-linked tasks in source order and drops cancelled + specLinked:false rows", () => {
      const state = stateWith([
        { ...makeTask("t1", "complete"), specLinked: true },
        { ...makeTask("t2", "in_progress"), specLinked: true },
        { ...makeTask("orphan", "not_started"), specLinked: false },
        { ...makeTask("gone", "cancelled"), specLinked: true },
        { ...makeTask("t3", "not_started"), specLinked: true },
      ]);

      expect(selectSpecLinkedTaskDisplayList.select(state, WS).map((t) => t.id)).toEqual([
        "t1",
        "t2",
        "t3",
      ]);
    });

    it("keeps legacy behavior (all non-cancelled) when the daemon omits specLinked", () => {
      const state = stateWith([
        makeTask("t1", "not_started"),
        makeTask("gone", "cancelled"),
        makeTask("t2", "in_progress"),
      ]);

      expect(selectSpecLinkedTaskDisplayList.select(state, WS).map((t) => t.id)).toEqual([
        "t1",
        "t2",
      ]);
    });

    it("returns [] for unknown workspaces", () => {
      expect(selectSpecLinkedTaskDisplayList.select(emptyState, WS)).toEqual([]);
    });
  });

  describe("selectFallbackPlanTasksForAgent (fallback plan card, monorepo#3249)", () => {
    const withAssociations = (
      base: StoreState,
      byNoteId: Record<string, Record<string, { agentId: string; noteId: string }>>
    ): StoreState =>
      ({
        ...(base as object),
        taskAgentAssociations: { byWorkspaceId: { [WS]: { byNoteId } } },
      }) as unknown as StoreState;

    it("shows only the delegated agent's linked task when associations exist", () => {
      const base = stateWith([
        { ...makeTask("t1", "not_started"), specLinked: true },
        { ...makeTask("t2", "in_progress"), specLinked: true },
      ]);
      const state = withAssociations(base, {
        t2: { key: { agentId: "agent-1", noteId: "t2" } },
      });

      expect(
        selectFallbackPlanTasksForAgent.select(state, WS, "agent-1").map((t) => t.id)
      ).toEqual(["t2"]);
    });

    it("excludes a delegated agent's linked task when it is cancelled", () => {
      const base = stateWith([{ ...makeTask("t1", "cancelled"), specLinked: true }]);
      const state = withAssociations(base, {
        t1: { key: { agentId: "agent-1", noteId: "t1" } },
      });

      expect(selectFallbackPlanTasksForAgent.select(state, WS, "agent-1")).toEqual([]);
    });

    it("falls back to the spec-linked list for agents with no associations (coordinator/root)", () => {
      const base = stateWith([
        { ...makeTask("t1", "not_started"), specLinked: true },
        { ...makeTask("orphan", "not_started"), specLinked: false },
      ]);
      const state = withAssociations(base, {
        t1: { key: { agentId: "other-agent", noteId: "t1" } },
      });

      expect(
        selectFallbackPlanTasksForAgent.select(state, WS, "coordinator-1").map((t) => t.id)
      ).toEqual(["t1"]);
    });

    it("returns [] for an empty agent id or unknown workspace", () => {
      const base = stateWith([{ ...makeTask("t1", "not_started"), specLinked: true }]);
      expect(selectFallbackPlanTasksForAgent.select(base, WS, "")).toEqual([]);
      expect(selectFallbackPlanTasksForAgent.select(emptyState, WS, "agent-1")).toEqual([]);
    });
  });
});
