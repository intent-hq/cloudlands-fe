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
import { appClient } from '$lib/client';
import type { CreatePrerequisiteOptions } from '$lib/client';
import { notify } from '$lib/components/patterns/notify';
import type { TaskStatus } from '$shared/types';
import { store as appStore } from '$store/renderer/store';
import {
  applyLocalNoteUpdate,
  applyTaskStatusChanged as applyNoteTaskStatusChanged,
} from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import { applyTaskStatusChanged as applyWorkspaceTaskStatusChanged } from '$store/renderer/slices/workspace-tasks/workspace-tasks-slice';
import { selectNoteById } from '$store/renderer/slices/workspace-notes/workspace-notes-selectors';
import { selectWorkspaceTasks } from '$store/renderer/slices/workspace-tasks/workspace-tasks-selectors';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';

import { createTaskStatusWriteOwner } from './task-status-write-owner';

const logger = createLogger('TasksWriteService');

/** Dispatch the optimistic status into both the notes and tasks slices. */
function applyStatus(workspaceId: string, noteId: string, status: TaskStatus): void {
  appStore.dispatch(applyNoteTaskStatusChanged(workspaceId, noteId, status));
  appStore.dispatch(applyWorkspaceTaskStatusChanged(workspaceId, noteId, status));
}

// Compatibility facade for source Svelte consumers until the renderer cutover.
// The dependency-injected owner also serves the explicit React saga binding.
const statusWriter = createTaskStatusWriteOwner({
  readNote: (workspaceId, noteId) => selectNoteById.select(appStore.state, workspaceId, noteId),
  readTask: (workspaceId, noteId) =>
    selectWorkspaceTasks.select(appStore.state, workspaceId).find((task) => task.id === noteId),
  applyStatus,
  applyRev: (workspaceId, noteId, rev) => {
    appStore.dispatch(applyLocalNoteUpdate(workspaceId, noteId, { rev }));
  },
  updateNoteStatus: (...args) => appClient.tasks.updateNoteStatus(...args),
  onConflict: () => {
    logger.warn('Task mutation conflicted; reloaded the latest version');
    notify.warning(m.tasks_write_conflict_title(), {
      description: m.tasks_write_conflict_description(),
    });
  },
  onFailure: (error) => {
    logger.error('Failed to update task status', error);
    notify.error(m.notes_writeService_updateFailed_error());
  },
});

export const updateTaskNoteStatus = statusWriter.update;

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
    logger.error('Failed to create prerequisite task', result.error);
    return undefined;
  }
  return result.id;
}
