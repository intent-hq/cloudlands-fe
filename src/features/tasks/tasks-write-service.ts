/**
 * Tasks write service — the sanctioned post-saga task-mutation mechanism.
 *
 * Components call these functions from event handlers instead of dispatching the
 * (now dead) saga-trigger actions. Each operation: (1) applies an optimistic
 * store update for instant UI feedback, (2) awaits the matching
 * `appClient.tasks.*` mutation (which forwards to intentd and never throws — it
 * returns a `MutationResult`), and (3) reconciles: on success the live
 * `task:*`/`note:*` subscribe→refetch loop converges the store; on failure the
 * optimistic change is rolled back.
 *
 * Tasks are note-scoped (a task is a note carrying `metadata.task`), so a task
 * status change is mirrored into BOTH the notes slice (note metadata) and the
 * tasks slice (canonical `WorkspaceTask`) so the checkbox UI and the sidebar
 * progress update together.
 *
 * This module is dependency-light: it imports only the AppClient seam, the
 * configured store, slice actions, and selectors (per src/store AGENTS.md).
 */
import { appClient } from "$lib/client";
import type { TaskStatus } from "$shared/types";
import { store as appStore } from "$store/renderer/store";
import { applyTaskStatusChanged as applyNoteTaskStatusChanged } from "$store/renderer/slices/workspace-notes/workspace-notes-slice";
import { applyTaskStatusChanged as applyWorkspaceTaskStatusChanged } from "$store/renderer/slices/workspace-tasks/workspace-tasks-slice";
import { selectNoteById } from "$store/renderer/slices/workspace-notes/workspace-notes-selectors";
import { selectWorkspaceTasks } from "$store/renderer/slices/workspace-tasks/workspace-tasks-selectors";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("TasksWriteService");

/** Dispatch the optimistic status into both the notes and tasks slices. */
function applyStatus(workspaceId: string, noteId: string, status: TaskStatus): void {
  appStore.dispatch(applyNoteTaskStatusChanged(workspaceId, noteId, status));
  appStore.dispatch(applyWorkspaceTaskStatusChanged(workspaceId, noteId, status));
}

/** Read the current task-note status from the notes slice, falling back to the tasks slice. */
function readCurrentStatus(workspaceId: string, noteId: string): TaskStatus | undefined {
  const fromNote = selectNoteById.select(appStore.state, workspaceId, noteId)?.metadata?.task?.status;
  if (fromNote !== undefined) return fromNote;
  return selectWorkspaceTasks.select(appStore.state, workspaceId).find((t) => t.id === noteId)?.status;
}

/**
 * Update a task note's metadata status optimistically; rolls back both slices to
 * the prior status on failure. Mirrors the removed `updateTaskStatus` saga.
 */
export async function updateTaskNoteStatus(
  workspaceId: string,
  noteId: string,
  status: TaskStatus,
): Promise<void> {
  const previous = readCurrentStatus(workspaceId, noteId);
  applyStatus(workspaceId, noteId, status);

  const result = await appClient.tasks.updateNoteStatus(noteId, status);
  if (!result.success) {
    if (previous !== undefined) applyStatus(workspaceId, noteId, previous);
    logger.error("Failed to update task status", result.error);
  }
}
