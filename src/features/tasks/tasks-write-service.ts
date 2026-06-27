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
import type { CreatePrerequisiteOptions, MutationResult } from "$lib/client";
import { toast } from "$lib/components/ui/toast";
import type { TaskStatus, WorkspaceTask } from "$shared/types";
import { store as appStore } from "$store/renderer/store";
import {
  applyLocalNoteUpdate,
  applyTaskStatusChanged as applyNoteTaskStatusChanged,
} from "$store/renderer/slices/workspace-notes/workspace-notes-slice";
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
 * Read the current optimistic-concurrency revision (§11.4-D) for a task note from
 * the notes slice, falling back to the tasks slice. `undefined` when unknown —
 * callers then omit `expectedVersion` and last-writer-wins applies, as today.
 */
function readCurrentRev(workspaceId: string, noteId: string): number | undefined {
  const fromNote = selectNoteById.select(appStore.state, workspaceId, noteId)?.rev;
  if (fromNote !== undefined) return fromNote;
  return selectWorkspaceTasks.select(appStore.state, workspaceId).find((t) => t.id === noteId)?.rev;
}

/**
 * Handle an optimistic-concurrency conflict (§11.4-D): the daemon rejected the
 * status change because the task note changed on the server. Reload-to-latest —
 * apply the authoritative `conflict.current` status into both slices and advance
 * the threaded `rev` on the note — and surface a non-destructive prompt. Returns
 * `true` when a conflict was handled so the caller skips the rollback path.
 */
function reconcileTaskConflict(
  workspaceId: string,
  noteId: string,
  result: MutationResult,
): boolean {
  if (!result.conflict) return false;
  const current = result.conflict.current as WorkspaceTask | undefined;
  if (current && typeof current === "object") {
    if (current.status) applyStatus(workspaceId, noteId, current.status);
    if (typeof current.rev === "number") {
      appStore.dispatch(applyLocalNoteUpdate(workspaceId, noteId, { rev: current.rev }));
    }
  }
  logger.warn("Task mutation conflicted; reloaded the latest version", { noteId });
  toast.warning("This task changed on the server", {
    description: "Your change was not applied; reloaded the latest version.",
  });
  return true;
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
  // Forward the current known `rev` as `expectedVersion` (§11.4-D) when it is
  // known; omit it entirely otherwise so behavior is unchanged (last-writer-wins).
  const rev = readCurrentRev(workspaceId, noteId);
  applyStatus(workspaceId, noteId, status);

  const result =
    rev !== undefined
      ? await appClient.tasks.updateNoteStatus(noteId, status, rev)
      : await appClient.tasks.updateNoteStatus(noteId, status);
  if (!result.success) {
    if (reconcileTaskConflict(workspaceId, noteId, result)) return;
    if (previous !== undefined) applyStatus(workspaceId, noteId, previous);
    logger.error("Failed to update task status", result.error);
  }
}

/**
 * Create a prerequisite task note for `dependentNoteId` via the seam
 * (`task.createPrerequisite`) and return the new task note's canonical id, which
 * the §7.9 WorkspaceTask result surfaces on the MutationResult. Returns undefined
 * when the mutation fails or the daemon returns no id. No optimistic store
 * mutation is applied — the caller builds the inline link from the returned id,
 * and the live `task:*`/`note:*` subscribe→refetch loop converges the new note
 * into the store.
 */
export async function createPrerequisiteTask(
  dependentNoteId: string,
  title: string,
  options?: CreatePrerequisiteOptions,
): Promise<string | undefined> {
  const result = await appClient.tasks.createPrerequisite(dependentNoteId, title, options);
  if (!result.success) {
    logger.error("Failed to create prerequisite task", result.error);
    return undefined;
  }
  return result.id;
}
