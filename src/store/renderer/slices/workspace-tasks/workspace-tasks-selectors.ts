/**
 * Workspace Tasks Selectors
 *
 * Component API for canonical workspace task state. Counts, progress, and
 * ordered display groups are derived here from task entities rather than
 * stored in Redux.
 */

import { store } from "../../store";
import type { WorkspaceTask } from "$shared/types";
import { EXCLUDED_STATUSES, IN_PROGRESS_STATUSES } from "$shared/utils/task-stats";
import { getItems } from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";
import { emptyWorkspaceTasksState } from "./workspace-tasks-slice";
import type { WorkspaceTaskProgress, WorkspaceTasksWorkspaceState } from "./workspace-tasks-types";

// ============================================================================
// Per-workspace base selector
// ============================================================================

export const selectWorkspaceTasksState = store.createSelector(
  (state, workspaceId: string): WorkspaceTasksWorkspaceState =>
    state.workspaceTasks.byWorkspaceId[workspaceId] ?? emptyWorkspaceTasksState,
);

/**
 * Root per-workspace task map. Subscribe to this once at component init when
 * rendering many workspaces via template helper functions, then read
 * individual workspaces with `selector.select(appStore.state, workspaceId)`.
 */
export const selectWorkspaceTasksByWorkspaceId = store.createSelector(
  (state): Record<string, WorkspaceTasksWorkspaceState> => state.workspaceTasks.byWorkspaceId,
);

// ============================================================================
// Scalar selectors
// ============================================================================

export const selectWorkspaceTasksLoading = store.createSelector(
  (state, workspaceId: string): boolean =>
    state.workspaceTasks.byWorkspaceId[workspaceId]?.loading ?? false,
);

export const selectWorkspaceTasksError = store.createSelector(
  (state, workspaceId: string): string | null =>
    state.workspaceTasks.byWorkspaceId[workspaceId]?.error ?? null,
);

export const selectWorkspaceTasksInitialized = store.createSelector(
  (state, workspaceId: string): boolean =>
    state.workspaceTasks.byWorkspaceId[workspaceId]?.initialized ?? false,
);

// ============================================================================
// Derived task selectors
// ============================================================================

/** All canonical tasks for a workspace in source order. */
export const selectWorkspaceTasks = store.createSelector(
  (state, workspaceId: string): WorkspaceTask[] => {
    const ws = state.workspaceTasks.byWorkspaceId[workspaceId];
    if (!ws) return [];
    return getItems(ws.tasks);
  },
);

/**
 * Task progress counts derived from canonical task entities.
 * Cancelled (excluded) tasks do not count toward any bucket.
 */
export const selectWorkspaceTaskProgress = store.createSelector(
  (state, workspaceId: string): WorkspaceTaskProgress => {
    const ws = state.workspaceTasks.byWorkspaceId[workspaceId];
    let total = 0;
    let completed = 0;
    let inProgress = 0;

    for (const task of ws ? getItems(ws.tasks) : []) {
      if (EXCLUDED_STATUSES.has(task.status)) continue;
      total++;
      if (task.status === "complete") {
        completed++;
      } else if (IN_PROGRESS_STATUSES.has(task.status)) {
        inProgress++;
      }
    }

    return { total, completed, inProgress };
  },
);

/**
 * Tasks ordered for display (in-progress first, then pending, then complete),
 * excluding cancelled tasks. Matches the legacy taskStats.tasks ordering.
 */
export const selectWorkspaceTaskDisplayList = store.createSelector(
  (state, workspaceId: string): WorkspaceTask[] => {
    const ws = state.workspaceTasks.byWorkspaceId[workspaceId];
    if (!ws) return [];

    const inProgress: WorkspaceTask[] = [];
    const pending: WorkspaceTask[] = [];
    const complete: WorkspaceTask[] = [];

    for (const task of getItems(ws.tasks)) {
      if (EXCLUDED_STATUSES.has(task.status)) continue;
      if (IN_PROGRESS_STATUSES.has(task.status)) {
        inProgress.push(task);
      } else if (task.status === "complete") {
        complete.push(task);
      } else {
        pending.push(task);
      }
    }

    return [...inProgress, ...pending, ...complete];
  },
);

