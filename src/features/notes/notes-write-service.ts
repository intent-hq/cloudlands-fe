/**
 * Notes write service — the sanctioned post-saga note-mutation mechanism.
 *
 * Components call these functions from event handlers. Create remains a small
 * direct adapter; title and delete dispatch saga-owned async actions so the
 * notes-write saga performs the mutation and settles the caller's promise.
 *
 * Title and delete mutations are saga-backed adapters. The notes-write saga owns
 * their optimistic updates, rollback, conflict reconciliation, and the same
 * per-note queue used by content saves, so every conditional write observes the
 * revision advanced by the preceding mutation.
 *
 * Dependency-light per src/store AGENTS.md: imports only the AppClient seam,
 * the configured store, slice actions/empty-state, collection-utils, and the
 * logger. State reads use the raw `appStore.state.workspaceNotes` shape via
 * the `readWorkspaceNotes` helper below.
 */
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { appClient } from '$lib/client';
import { ContentType, NoteVisibility } from '$shared/types';
import type { CreateNoteRequest, Note } from '$shared/types';
import { NoteId, WorkspaceId } from '$shared/types/branded-ids';
import { store as appStore } from '$store/renderer/store';
import {
  addOptimisticNote,
  emptyWorkspaceNotesState,
  loadWorkspaceNotesSucceeded,
  removeOptimisticNote,
  updateNoteTitle as updateNoteTitleRequested,
  deleteNote as deleteNoteRequested,
} from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('NotesWriteService');

function genTempNoteId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof c?.randomUUID === 'function') return `optimistic-${c.randomUUID()}`;
  return `optimistic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Read state directly via raw slice shape (NOT via the workspace-notes-selectors
// module) — once registered in `middleware.ts`, statically importing a
// `*-selectors.ts` module would evaluate `store.createSelector` while the store
// module is still mid-initialization through the middleware chain. See
// `git-read-service.ts` / `files-write-service.ts` for the same pattern.
function readWorkspaceNotes(workspaceId: string): Note[] {
  const ws = appStore.state.workspaceNotes.byWorkspaceId[workspaceId] ?? emptyWorkspaceNotesState;
  return getItems(ws.notes);
}

/** Create a note with optimistic insert; reconciles to the canonical id on success. */
export async function createNote(
  workspaceId: string,
  data: Omit<CreateNoteRequest, 'workspaceId'>,
): Promise<string | undefined> {
  const tempId = genTempNoteId();
  const now = new Date().toISOString();
  const optimistic: Note = {
    id: NoteId(tempId),
    workspaceId: WorkspaceId(workspaceId),
    title: data.title,
    content: data.content,
    contentType: data.contentType ?? ContentType.Markdown,
    tags: data.tags ?? [],
    isPinned: false,
    isArchived: false,
    visibility: data.visibility ?? NoteVisibility.Workspace,
    ...(data.parentId !== undefined ? { parentId: data.parentId } : {}),
    createdAt: now,
    updatedAt: now,
  };

  const before = new Set(readWorkspaceNotes(workspaceId).map((n) => String(n.id)));
  appStore.dispatch(addOptimisticNote(workspaceId, optimistic));

  const result = await appClient.notes.create({ workspaceId: WorkspaceId(workspaceId), ...data });
  if (!result.success) {
    appStore.dispatch(removeOptimisticNote(workspaceId, tempId));
    logger.error('Failed to create note', result.error);
    return undefined;
  }

  try {
    const notes = await appClient.notes.list(workspaceId);
    appStore.dispatch(loadWorkspaceNotesSucceeded([workspaceId], { [workspaceId]: notes }));
    const created = notes.find((n) => !before.has(String(n.id)));
    if (created) {
      appStore.dispatch(addOptimisticNote(workspaceId, created));
      return String(created.id);
    }
  } catch (error) {
    // The create succeeded but the reconcile refetch threw. Keep the optimistic
    // note rather than dropping it — the live note:* subscribe→refetch loop will
    // converge it to the canonical id — so the user's note is neither orphaned nor duplicated.
    logger.error('Failed to refetch notes after creating a note', error);
  }
  return undefined;
}

/** Update a note's title through the notes-write saga. */
export async function updateNoteTitle(
  workspaceId: string,
  noteId: string,
  title: string,
): Promise<void> {
  await appStore.dispatch(updateNoteTitleRequested(workspaceId, noteId, title)).promise;
}

/** Delete a note through the notes-write saga. */
export async function deleteNote(workspaceId: string, noteId: string): Promise<void> {
  await appStore.dispatch(deleteNoteRequested(workspaceId, noteId)).promise;
}
