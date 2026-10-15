import type { SagaGenerator } from 'typed-redux-saga';
import type { TasksReadClient } from '../../../../lib/client/lifecycle-read-client-types';
import type { TaskStatus, WorkspaceTask, WorkspaceTaskStats } from '$shared/types';
import type { Collection } from '@themislib/themis/utils/collections/collection-utils';

/** Per-workspace canonical task state. */
export interface WorkspaceTasksWorkspaceState {
  /** Canonical task facts keyed by task note ID (insertion-ordered). */
  tasks: Collection<WorkspaceTask, 'id'>;
  /**
   * Workspace-wide task progress rollup emitted by `task.list` (PROTOCOL §5.4).
   * Stored verbatim — selectors expose it directly without re-derivation.
   */
  stats: WorkspaceTaskStats;
  loading: boolean;
  error: string | null;
  /** True once tasks have been loaded at least once for this workspace. */
  initialized: boolean;
  /** Unique visible consumer leases; duplicate acquire/release is harmless. */
  demandIds: string[];
  /** An event or failed read requires revalidation on the next demand. */
  stale: boolean;
  revision: number;
  /** Revision captured when the current read was admitted. */
  readRevision: number;
}

/** Root workspace-tasks state, keyed by workspace ID. */
export interface WorkspaceTasksState {
  explicitStatusViews: Collection<ExplicitTaskStatusView, 'viewId'>;
  explicitStatusOperations: Collection<ExplicitTaskStatusOperation, 'requestId'>;
  revokedStatusViews: Record<string, true>;
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

/** Captured principal/backend authority and root/connection lifetime; never inferred from active UI. */
export type ExplicitTaskStatusIdentity = {
  workspaceId: string;
  noteId: string;
  viewId: string;
  consumerId: string;
  authority: string;
  context: string;
};
export type ExplicitTaskStatusRequest = ExplicitTaskStatusIdentity & {
  requestId: string;
  expectedVersion: number;
};
export type ExplicitTaskStatusView = ExplicitTaskStatusIdentity & {
  /** Accepted note revision at this lease; rejected stale payloads cannot retire it. */
  noteRevision: number;
};
export type ExplicitTaskStatusOperation = ExplicitTaskStatusRequest & {
  requestedStatus: TaskStatus;
  status: 'queued' | 'running' | 'confirmed' | 'failed' | 'conflict' | 'unknown';
  echoedStatus?: TaskStatus;
  echoedRev?: number;
  error?: string;
};

export type WorkspaceTasksReadDependencies = {
  tasks: Pick<TasksReadClient, 'list'>;
  selectWorkspaceTasksShouldLoad: { effect(workspaceId: string): SagaGenerator<boolean> };
  admittedContext?: { effect(workspaceId: string): SagaGenerator<string | null> };
  /** Source retains its shared bounded scheduler; explicit hosts provide their admitted context. */
  runRead?: (
    workspaceId: string,
    read: (workspaceId: string) => SagaGenerator<void>,
  ) => SagaGenerator<void>;
  /** Omit where the existing lifecycle reconnect watcher already owns task refresh. */
  selectDemandedTaskWorkspaceIds?: { effect(): SagaGenerator<string[]> };
};
