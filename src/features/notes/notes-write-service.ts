/**
 * Notes write service — the sanctioned post-saga note-mutation mechanism.
 *
 * Components call these functions from event handlers instead of dispatching the
 * (now dead) saga-trigger actions. Each operation: (1) applies an optional
 * optimistic store update for instant UI feedback, (2) awaits the matching
 * `appClient.notes.*` mutation (which forwards to intentd and never throws —
 * it returns a `MutationResult`), and (3) reconciles: on success the live
 * `note:*` subscribe→refetch loop converges the store; on failure the optimistic
 * change is rolled back (or the workspace is refetched).
 *
 * Content saves are debounced HERE (keyed by noteId) so the mechanism — not the
 * component — owns the timing the removed saga used to provide. Pass
 * `{ immediate: true }` (or call `flushNoteContent`) to bypass the debounce on
 * teardown so no edit is lost.
 *
 * This module is dependency-light: it imports only the AppClient seam, the
 * configured store, slice actions, and selectors (per src/store AGENTS.md).
 */
import { appClient } from "$lib/client";
import type { NoteMetadataPatch } from "$lib/client";
import { ContentType, NoteVisibility } from "$shared/types";
import type { CreateNoteRequest, Note } from "$shared/types";
import { NoteId, WorkspaceId } from "$shared/types/branded-ids";
import { store as appStore } from "$store/renderer/store";
import {
  addOptimisticNote,
  applyLocalNoteUpdate,
  applyNoteCreated,
  applyNoteDeleted,
  loadWorkspaceNotesSucceeded,
  removeOptimisticNote,
} from "$store/renderer/slices/workspace-notes/workspace-notes-slice";
import {
  selectAllNotes,
  selectNoteById,
} from "$store/renderer/slices/workspace-notes/workspace-notes-selectors";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("NotesWriteService");

/** Debounce window for content saves (the removed saga debounced ~1s). */
export const NOTE_CONTENT_SAVE_DEBOUNCE_MS = 800;

interface PendingContent {
  workspaceId: string;
  content: string;
}

const contentTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingContent = new Map<string, PendingContent>();

function genTempNoteId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof c?.randomUUID === "function") return `optimistic-${c.randomUUID()}`;
  return `optimistic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function refetchWorkspaceNotes(workspaceId: string): Promise<void> {
  try {
    const notes = await appClient.notes.list(workspaceId);
    appStore.dispatch(loadWorkspaceNotesSucceeded([workspaceId], { [workspaceId]: notes }));
  } catch (error) {
    logger.error("Failed to refetch notes after a mutation error", error);
  }
}

/** Create a note with optimistic insert; reconciles to the canonical id on success. */
export async function createNote(
  workspaceId: string,
  data: Omit<CreateNoteRequest, "workspaceId">,
): Promise<void> {
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

  const before = new Set(
    selectAllNotes.select(appStore.state, workspaceId).map((n) => String(n.id)),
  );
  appStore.dispatch(addOptimisticNote(workspaceId, optimistic));

  const result = await appClient.notes.create({ workspaceId: WorkspaceId(workspaceId), ...data });
  if (!result.success) {
    appStore.dispatch(removeOptimisticNote(workspaceId, tempId));
    logger.error("Failed to create note", result.error);
    return;
  }

  try {
    const notes = await appClient.notes.list(workspaceId);
    appStore.dispatch(loadWorkspaceNotesSucceeded([workspaceId], { [workspaceId]: notes }));
    const created = notes.find((n) => !before.has(String(n.id)));
    if (created) appStore.dispatch(addOptimisticNote(workspaceId, created));
  } catch (error) {
    // The create succeeded but the reconcile refetch threw. Keep the optimistic
    // note rather than dropping it — the live note:* subscribe→refetch loop will
    // converge it to the canonical id — so the user's note is neither orphaned nor duplicated.
    logger.error("Failed to refetch notes after creating a note", error);
  }
}

/** Update note content optimistically; the network save is debounced per note. */
export function updateNoteContent(
  workspaceId: string,
  noteId: string,
  content: string,
  options?: { immediate?: boolean },
): void {
  appStore.dispatch(applyLocalNoteUpdate(workspaceId, noteId, { content }));
  pendingContent.set(noteId, { workspaceId, content });

  const existing = contentTimers.get(noteId);
  if (existing) clearTimeout(existing);

  if (options?.immediate) {
    contentTimers.delete(noteId);
    void flushContent(noteId);
    return;
  }
  contentTimers.set(
    noteId,
    setTimeout(() => {
      contentTimers.delete(noteId);
      void flushContent(noteId);
    }, NOTE_CONTENT_SAVE_DEBOUNCE_MS),
  );
}

async function flushContent(noteId: string): Promise<void> {
  const pending = pendingContent.get(noteId);
  if (!pending) return;
  pendingContent.delete(noteId);
  const timer = contentTimers.get(noteId);
  if (timer) {
    clearTimeout(timer);
    contentTimers.delete(noteId);
  }
  // Forward the current known `rev` as `expectedVersion` (§11.4-D) when it is
  // known; omit it entirely otherwise so behavior is unchanged (last-writer-wins).
  const rev = selectNoteById.select(appStore.state, pending.workspaceId, noteId)?.rev;
  const result =
    rev !== undefined
      ? await appClient.notes.setContent(noteId, pending.content, rev)
      : await appClient.notes.setContent(noteId, pending.content);
  if (!result.success) {
    logger.error("Failed to save note content", result.error);
    await refetchWorkspaceNotes(pending.workspaceId);
  }
}

/** Flush a pending debounced content save immediately (e.g. on editor teardown). */
export function flushNoteContent(noteId: string): void {
  if (pendingContent.has(noteId)) void flushContent(noteId);
}

/** Update a note's title optimistically; rolls back to the prior title on failure. */
export async function updateNoteTitle(
  workspaceId: string,
  noteId: string,
  title: string,
): Promise<void> {
  const existing = selectNoteById.select(appStore.state, workspaceId, noteId);
  const previous = existing?.title;
  const rev = existing?.rev;
  appStore.dispatch(applyLocalNoteUpdate(workspaceId, noteId, { title }));

  const result =
    rev !== undefined
      ? await appClient.notes.updateMetadata(noteId, { title }, rev)
      : await appClient.notes.updateMetadata(noteId, { title });
  if (!result.success) {
    if (previous !== undefined) {
      appStore.dispatch(applyLocalNoteUpdate(workspaceId, noteId, { title: previous }));
    }
    logger.error("Failed to update note title", result.error);
  }
}

/** Update a note's title/tags metadata optimistically; rolls back the touched fields on failure. */
export async function updateNoteMetadata(
  workspaceId: string,
  noteId: string,
  metadata: NoteMetadataPatch,
): Promise<void> {
  const existing = selectNoteById.select(appStore.state, workspaceId, noteId);
  const rollback: NoteMetadataPatch = {};
  if (metadata.title !== undefined) rollback.title = existing?.title ?? "";
  if (metadata.tags !== undefined) rollback.tags = existing?.tags ?? [];
  const rev = existing?.rev;
  appStore.dispatch(applyLocalNoteUpdate(workspaceId, noteId, metadata));

  const result =
    rev !== undefined
      ? await appClient.notes.updateMetadata(noteId, metadata, rev)
      : await appClient.notes.updateMetadata(noteId, metadata);
  if (!result.success) {
    appStore.dispatch(applyLocalNoteUpdate(workspaceId, noteId, rollback));
    logger.error("Failed to update note metadata", result.error);
  }
}

/** Delete a note optimistically; restores it from a snapshot on failure. */
export async function deleteNote(workspaceId: string, noteId: string): Promise<void> {
  const snapshot = selectNoteById.select(appStore.state, workspaceId, noteId);
  const rev = snapshot?.rev;
  appStore.dispatch(applyNoteDeleted(workspaceId, noteId));

  const result =
    rev !== undefined
      ? await appClient.notes.delete(noteId, rev)
      : await appClient.notes.delete(noteId);
  if (!result.success) {
    if (snapshot) appStore.dispatch(applyNoteCreated(workspaceId, snapshot));
    logger.error("Failed to delete note", result.error);
  }
}
