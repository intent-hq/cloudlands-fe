import type { WorkspaceTask } from "$shared/types";
import type { Collection } from "ag-redux-toolkit/utils/collections/collection-utils";

/** Per-workspace canonical task state. */
export interface WorkspaceTasksWorkspaceState {
  /** Canonical task facts keyed by task note ID (insertion-ordered). */
  tasks: Collection<WorkspaceTask, "id">;
  loading: boolean;
  error: string | null;
  /** True once tasks have been loaded at least once for this workspace. */
  initialized: boolean;
}

/** Root workspace-tasks state, keyed by workspace ID. */
export interface WorkspaceTasksState {
  byWorkspaceId: Record<string, WorkspaceTasksWorkspaceState>;
}

/** Selector-derived task progress counts (not stored in Redux). */
export interface WorkspaceTaskProgress {
  total: number;
  completed: number;
  inProgress: number;
}

