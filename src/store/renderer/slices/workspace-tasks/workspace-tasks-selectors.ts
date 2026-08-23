/**
 * Workspace Tasks Selectors
 *
 * Component API for canonical workspace task state. Counts, progress, and
 * ordered display groups are derived here from task entities rather than
 * stored in Redux.
 */

import { store } from '../../store';
import type { WorkspaceTask } from '$shared/types';
import { EXCLUDED_STATUSES, IN_PROGRESS_STATUSES } from '$shared/utils/task-stats';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { emptyWorkspaceTaskStats, emptyWorkspaceTasksState } from './workspace-tasks-slice';
import type { WorkspaceTaskProgress, WorkspaceTasksWorkspaceState } from './workspace-tasks-types';

// ============================================================================
// Per-workspace base selector
// ============================================================================

export const selectWorkspaceTasksState = store.createSelector(
  (state, workspaceId: string): WorkspaceTasksWorkspaceState =>
    state.workspaceTasks.byWorkspaceId[workspaceId] ?? emptyWorkspaceTasksState,
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
 * Workspace-wide task progress rollup. Served VERBATIM from the BE — `task.list`
 * (PROTOCOL §5.4) emits the canonical `{ total, completed, inProgress }`
 * aggregate and the slice stores it as-is; this selector returns that stored
 * value with no client-side classification. Unknown workspaces fall back to
 * the zero aggregate so callers can render a sparser card without a null check.
 */
export const selectWorkspaceTaskProgress = store.createSelector(
  (state, workspaceId: string): WorkspaceTaskProgress =>
    state.workspaceTasks.byWorkspaceId[workspaceId]?.stats ?? emptyWorkspaceTaskStats,
);

/**
 * Fallback plan-card tasks (monorepo#3249): spec-linked workspace tasks in
 * source order with cancelled tasks excluded. `specLinked` is additive
 * (PROTOCOL §5.4) — when the daemon predates the flag (`undefined` on every
 * row) the legacy behavior keeps all non-cancelled tasks; rows the daemon
 * explicitly marks `specLinked: false` are dropped.
 */
export const selectSpecLinkedTaskDisplayList = store.createSelector(
  (state, workspaceId: string): WorkspaceTask[] => {
    const ws = state.workspaceTasks?.byWorkspaceId[workspaceId];
    if (!ws) return [];
    return getItems(ws.tasks).filter(
      (task) => !EXCLUDED_STATUSES.has(task.status) && task.specLinked !== false,
    );
  },
);

/**
 * Fallback plan-card tasks for one agent (monorepo#3249). A delegated task
 * agent (it has `task-agent-associations` rows) sees only its own linked
 * task(s); a root/Coordinator agent (no association rows) sees the
 * spec-linked list. Both views preserve source order and exclude cancelled
 * tasks. Returns [] until the associations slice has hydrated for the
 * workspace — before `task.listAgentLinks` resolves, "no links" is
 * indistinguishable from "links not loaded", and falling through would
 * briefly show a delegated agent the Coordinator view. The native-plan
 * source-priority gate lives in the `nativePlans` slice — callers combine
 * the two.
 */
export const selectFallbackPlanTasksForAgent = store.createSelector(
  (state, workspaceId: string, agentId: string): WorkspaceTask[] => {
    const ws = state.workspaceTasks?.byWorkspaceId[workspaceId];
    if (!ws || !agentId) return [];

    const associations = state.taskAgentAssociations?.byWorkspaceId[workspaceId];
    if (!associations?.hydrated) return [];

    const byNoteId = associations.byNoteId;
    const linkedNoteIds = new Set<string>();
    for (const noteAssociations of Object.values(byNoteId)) {
      for (const association of Object.values(noteAssociations)) {
        if (association.agentId === agentId) linkedNoteIds.add(association.noteId);
      }
    }

    if (linkedNoteIds.size > 0) {
      return getItems(ws.tasks).filter(
        (task) => linkedNoteIds.has(task.id) && !EXCLUDED_STATUSES.has(task.status),
      );
    }

    return selectSpecLinkedTaskDisplayList.select(state, workspaceId);
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
      } else if (task.status === 'complete') {
        complete.push(task);
      } else {
        pending.push(task);
      }
    }

    return [...inProgress, ...pending, ...complete];
  },
);
