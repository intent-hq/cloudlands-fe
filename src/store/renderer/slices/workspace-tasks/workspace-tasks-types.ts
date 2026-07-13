import type { WorkspaceTask, WorkspaceTaskStats } from "$shared/types";
import type { Collection } from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";

/** Per-workspace canonical task state. */
export interface WorkspaceTasksWorkspaceState {
  /** Canonical task facts keyed by task note ID (insertion-ordered). */
  tasks: Collection<WorkspaceTask, "id">;
  /**
   * Workspace-wide task progress rollup emitted by `task.list` (PROTOCOL §5.4).
   * Stored verbatim — selectors expose it directly without re-derivation.
   */
  stats: WorkspaceTaskStats;
  loading: boolean;
  error: string | null;
  /** True once tasks have been loaded at least once for this workspace. */
  initialized: boolean;
}

/** Root workspace-tasks state, keyed by workspace ID. */
export interface WorkspaceTasksState {
  byWorkspaceId: Record<string, WorkspaceTasksWorkspaceState>;
}

/**
 * Selector-derived task progress counts (mirrors the on-wire `WorkspaceTaskStats`
 * from `task.list`; the selector serves the BE rollup verbatim, no re-counting).
 */
export interface WorkspaceTaskProgress {
  total: number;
  completed: number;
  inProgress: number;
}

