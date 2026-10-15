import type { Note, TaskStatus, WorkspaceTask } from '../../shared/types';
import type { MutationResult } from '../../lib/client/client-types';
import type { TaskStatusClient } from '../../lib/client/live/backend-task-status-types';
import type { WorkspaceNotesState } from '../../store/renderer/slices/workspace-notes/workspace-notes-types';
import type {
  ExplicitTaskStatusIdentity,
  WorkspaceTasksState,
} from '../../store/renderer/slices/workspace-tasks/workspace-tasks-types';
import type { taskStatusReceiptAccepted } from '../../store/renderer/slices/workspace-notes/workspace-notes-slice';
import type {
  explicitTaskStatusViewAdmitted,
  explicitTaskStatusQueued,
  explicitTaskStatusStarted,
  explicitTaskStatusSettled,
} from '../../store/renderer/slices/workspace-tasks/workspace-tasks-slice';

type LegacyTaskStatusWriteDependencies = {
  readNote(workspaceId: string, noteId: string): Note | undefined;
  readTask(workspaceId: string, noteId: string): WorkspaceTask | undefined;
  applyStatus(workspaceId: string, noteId: string, status: TaskStatus): void;
  applyRev(workspaceId: string, noteId: string, rev: number): void;
  updateNoteStatus(
    noteId: string,
    status: TaskStatus,
    expectedVersion?: number,
  ): Promise<MutationResult>;
  onConflict(): void;
  onFailure(error?: string): void;
};

type ExplicitTaskStatusHost = {
  getState(): { workspaceNotes: WorkspaceNotesState; workspaceTasks: WorkspaceTasksState };
  dispatch(
    action: ReturnType<
      | typeof explicitTaskStatusViewAdmitted
      | typeof explicitTaskStatusQueued
      | typeof explicitTaskStatusStarted
      | typeof explicitTaskStatusSettled
      | typeof taskStatusReceiptAccepted
    >,
  ): unknown;
  /** Captured principal/backend/root readiness; the owner additionally checks canonical view, eligibility, revision. */
  isCurrent(identity: ExplicitTaskStatusIdentity): boolean;
  client: Pick<TaskStatusClient, 'update'>;
  /** Revalidate through existing canonical read owners; never resend this mutation. */
  requestRefresh(workspaceId: string, noteId: string): void;
};

export type TaskStatusWriteDependencies =
  | (LegacyTaskStatusWriteDependencies & { explicit?: ExplicitTaskStatusHost })
  | { explicit: ExplicitTaskStatusHost };
